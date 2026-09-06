/*
 * DT World local backup exporter.
 *
 * This file is deliberately independent from the JSONBin provider.  It only
 * reads browser storage and creates a portable snapshot for the staged D1
 * migration.  Credentials are never included in a snapshot.
 */
(function (root) {
  'use strict';

  const SCHEMA = 'dt-world-sync-backup';
  const VERSION = 1;
  const SOURCES = new Set(['pc', 'smartphone', 'jsonbin', 'unknown']);
  const PRIVATE_DATA_KEY_PATTERNS = [
    /^sd_gaman_data$/i,
    /^dt_secret_diary_entries$/i,
    /^dt_vault_(data|folders)$/i
  ];
  const CREDENTIAL_KEY_PATTERNS = [
    /^shared_jsonbin_api_key$/i,
    /(?:^|[_-])(api|access|master)[_-]?key(?:$|[_-])/i,
    /(?:^|[_-])(?:jb|gh)[_-](?:key|pat)(?:$|[_-])/i,
    /(?:^|[_-])(?:pin[_-]?hash|password|passphrase|auth[_-]?token|secret[_-]?key)(?:$|[_-])/i
  ];

  function isObject(value) {
    return value !== null && typeof value === 'object';
  }

  function normalizeSource(source) {
    const value = String(source || 'unknown').trim().toLowerCase();
    return SOURCES.has(value) ? value : 'unknown';
  }

  function isCredentialKey(key) {
    const value = String(key || '');
    return CREDENTIAL_KEY_PATTERNS.some(pattern => pattern.test(value));
  }

  function isPrivateDataKey(key) {
    const value = String(key || '');
    return PRIVATE_DATA_KEY_PATTERNS.some(pattern => pattern.test(value));
  }

  function encodeStorageValue(raw) {
    if (typeof raw !== 'string') {
      return { encoding: 'text', raw: String(raw ?? '') };
    }

    try {
      JSON.parse(raw);
      return { encoding: 'json', raw };
    } catch (_) {
      return { encoding: 'text', raw };
    }
  }

  function collectLocalStorage(storage, { includeSensitive = true } = {}) {
    const values = {};
    const errors = [];
    let redactedLocalStorageKeys = 0;
    let skippedSensitiveLocalStorageKeys = 0;

    if (!storage || typeof storage.key !== 'function') {
      return { values, errors: ['localStorage_unavailable'], redactedLocalStorageKeys, skippedSensitiveLocalStorageKeys };
    }

    let length = 0;
    try {
      length = Number(storage.length) || 0;
    } catch (_) {
      errors.push('localStorage_length_unavailable');
    }

    for (let index = 0; index < length; index += 1) {
      let key;
      try {
        key = storage.key(index);
      } catch (_) {
        errors.push('localStorage_key_unavailable');
        continue;
      }
      if (!key) continue;

      if (isCredentialKey(key)) {
        redactedLocalStorageKeys += 1;
        continue;
      }
      if (!includeSensitive && isPrivateDataKey(key)) {
        skippedSensitiveLocalStorageKeys += 1;
        continue;
      }

      try {
        const raw = storage.getItem(key);
        if (raw !== null) values[key] = encodeStorageValue(raw);
      } catch (_) {
        errors.push('localStorage_read_failed');
      }
    }

    return { values, errors, redactedLocalStorageKeys, skippedSensitiveLocalStorageKeys };
  }

  function bytesToBase64(bytes) {
    if (typeof root.btoa !== 'function') throw new Error('base64_encoder_unavailable');
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return root.btoa(binary);
  }

  async function serializeIndexedValue(value, seen = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'undefined') return { $type: 'undefined' };
    if (typeof value === 'bigint') return { $type: 'bigint', value: String(value) };
    if (typeof value === 'function') return { $type: 'function' };

    if (typeof Date !== 'undefined' && value instanceof Date) {
      return { $type: 'date', value: value.toISOString() };
    }
    if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
      return { $type: 'arraybuffer', value: bytesToBase64(new Uint8Array(value)) };
    }
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) {
      return {
        $type: 'typedarray',
        name: value.constructor && value.constructor.name ? value.constructor.name : 'TypedArray',
        value: bytesToBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
      };
    }
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
      const buffer = await value.arrayBuffer();
      return { $type: 'blob', type: value.type || '', size: value.size, value: bytesToBase64(new Uint8Array(buffer)) };
    }

    if (seen.has(value)) return { $type: 'circular' };
    seen.add(value);

    if (Array.isArray(value)) {
      const result = [];
      for (const item of value) result.push(await serializeIndexedValue(item, seen));
      seen.delete(value);
      return result;
    }

    if (typeof Map !== 'undefined' && value instanceof Map) {
      const entries = [];
      for (const [key, item] of value.entries()) {
        entries.push([await serializeIndexedValue(key, seen), await serializeIndexedValue(item, seen)]);
      }
      seen.delete(value);
      return { $type: 'map', entries };
    }

    if (typeof Set !== 'undefined' && value instanceof Set) {
      const values = [];
      for (const item of value.values()) values.push(await serializeIndexedValue(item, seen));
      seen.delete(value);
      return { $type: 'set', values };
    }

    const result = {};
    for (const key of Object.keys(value)) result[key] = await serializeIndexedValue(value[key], seen);
    seen.delete(value);
    return result;
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('indexeddb_request_failed'));
    });
  }

  function openDatabase(indexedDB, name) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('indexeddb_open_failed'));
    });
  }

  async function collectIndexedDB(indexedDB) {
    if (!indexedDB || typeof indexedDB.databases !== 'function') {
      return { supported: false, databases: [], errors: ['indexedDB_enumeration_unavailable'] };
    }

    let databaseInfos;
    try {
      databaseInfos = await indexedDB.databases();
    } catch (_) {
      return { supported: false, databases: [], errors: ['indexedDB_enumeration_failed'] };
    }

    const databases = [];
    const errors = [];
    for (const info of databaseInfos || []) {
      const name = info && info.name;
      if (!name) continue;
      let db;
      try {
        db = await openDatabase(indexedDB, name);
        const storeNames = Array.from(db.objectStoreNames || []);
        const stores = [];
        for (const storeName of storeNames) {
          try {
            const transaction = db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const records = await requestResult(store.getAll());
            const keys = typeof store.getAllKeys === 'function' ? await requestResult(store.getAllKeys()) : [];
            const serialized = [];
            for (let index = 0; index < records.length; index += 1) {
              serialized.push({
                key: await serializeIndexedValue(keys[index]),
                value: await serializeIndexedValue(records[index])
              });
            }
            stores.push({ name: storeName, keyPath: store.keyPath ?? null, records: serialized });
          } catch (_) {
            errors.push('indexedDB_store_read_failed');
          }
        }
        databases.push({ name, version: Number(info.version) || db.version || 0, stores });
      } catch (_) {
        errors.push('indexedDB_database_read_failed');
      } finally {
        if (db && typeof db.close === 'function') db.close();
      }
    }

    return { supported: true, databases, errors };
  }

  function buildSnapshot({
    source = 'unknown',
    includeSensitive = true,
    capturedAt = new Date().toISOString(),
    localStorage,
    indexedDB = { supported: false, databases: [], errors: [] }
  } = {}) {
    const local = collectLocalStorage(localStorage, { includeSensitive });
    const snapshot = {
      schema: SCHEMA,
      version: VERSION,
      source: normalizeSource(source),
      capturedAt,
      localStorage: local.values,
      indexedDB,
      summary: {
        localStorageKeys: Object.keys(local.values).length,
        indexedDBDatabases: Array.isArray(indexedDB.databases) ? indexedDB.databases.length : 0,
        indexedDBRecords: Array.isArray(indexedDB.databases)
          ? indexedDB.databases.reduce((total, database) => total + (database.stores || []).reduce((count, store) => count + (store.records || []).length, 0), 0)
          : 0,
        redactedLocalStorageKeys: local.redactedLocalStorageKeys,
        skippedSensitiveLocalStorageKeys: local.skippedSensitiveLocalStorageKeys,
        readWarnings: [...local.errors, ...(indexedDB.errors || [])]
      }
    };
    return snapshot;
  }

  function validateSnapshot(value) {
    const errors = [];
    if (!isObject(value)) errors.push('snapshot must be an object');
    if (!isObject(value)) return { ok: false, errors, summary: {} };
    if (value.schema !== SCHEMA) errors.push('schema is invalid');
    if (value.version !== VERSION) errors.push('version is unsupported');
    if (!SOURCES.has(value.source)) errors.push('source is invalid');
    if (typeof value.capturedAt !== 'string' || Number.isNaN(Date.parse(value.capturedAt))) errors.push('capturedAt is invalid');
    if (!isObject(value.localStorage)) errors.push('localStorage is missing');
    if (!isObject(value.indexedDB)) errors.push('indexedDB is missing');

    if (isObject(value.localStorage)) {
      for (const [key, entry] of Object.entries(value.localStorage)) {
        if (isCredentialKey(key)) errors.push('credential-like localStorage key is present');
        if (!isObject(entry) || !['json', 'text'].includes(entry.encoding) || typeof entry.raw !== 'string') {
          errors.push(`localStorage entry is invalid for ${key}`);
        }
      }
    }
    if (isObject(value.indexedDB) && !Array.isArray(value.indexedDB.databases)) errors.push('indexedDB.databases is invalid');

    // Do not scan application payloads recursively: a user's record may
    // legitimately contain a field named "password". Storage/config keys are
    // filtered at collection time and are the only keys treated as secrets.

    return {
      ok: errors.length === 0,
      errors,
      summary: isObject(value.summary) ? value.summary : {
        localStorageKeys: isObject(value.localStorage) ? Object.keys(value.localStorage).length : 0,
        indexedDBDatabases: isObject(value.indexedDB) && Array.isArray(value.indexedDB.databases) ? value.indexedDB.databases.length : 0
      }
    };
  }

  async function exportLocalSnapshot(options = {}) {
    const localStorage = options.localStorage || root.localStorage;
    const indexedDB = options.indexedDB || root.indexedDB;
    const indexedDump = options.indexedDump || await collectIndexedDB(indexedDB);
    const snapshot = buildSnapshot({ ...options, localStorage, indexedDB: indexedDump });
    const validation = validateSnapshot(snapshot);
    if (!validation.ok) throw new Error('local backup snapshot validation failed');
    const BlobCtor = root.Blob || (typeof Blob !== 'undefined' ? Blob : null);
    if (!BlobCtor) throw new Error('Blob API is unavailable');
    return new BlobCtor([JSON.stringify(snapshot, null, 2)], { type: 'application/json;charset=utf-8' });
  }

  function downloadSnapshot(snapshot, filename = `dt-world-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`) {
    const BlobCtor = root.Blob || (typeof Blob !== 'undefined' ? Blob : null);
    if (!BlobCtor || typeof root.URL === 'undefined' || typeof document === 'undefined') throw new Error('download APIs are unavailable');
    const blob = snapshot instanceof BlobCtor ? snapshot : new BlobCtor([JSON.stringify(snapshot, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = root.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    root.setTimeout(() => root.URL.revokeObjectURL(url), 0);
  }

  root.DTSyncBackup = {
    schema: SCHEMA,
    version: VERSION,
    buildSnapshot,
    collectIndexedDB,
    validateSnapshot,
    exportLocalSnapshot,
    downloadSnapshot
  };
})(typeof window !== 'undefined' ? window : globalThis);

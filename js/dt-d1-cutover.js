/* Safe, opt-in application of a staged migration candidate.
 *
 * This module never removes a live application storage key, clears an
 * application object store, changes a JSONBin ID, or writes to the raw
 * migration snapshots. Existing values are captured before the candidate is
 * applied so a cutover remains recoverable.
 *
 * 2026-10-23 quota safeguard: large library data can coexist with old
 * migration/recovery copies until localStorage is full.  Generated runtime
 * copies and, only after a durable IndexedDB copy succeeds, oversized local
 * recovery copies are moved to dt_d1_backup_v1.  No live app value is deleted
 * to make room; if the overflow store cannot accept the copy, the apply stops.
 */
(function (root) {
  'use strict';

  const BACKUP_PREFIX = 'dt_d1_pre_cutover_backup_';
  const RUNTIME_BACKUP_PREFIX = 'dt_d1_runtime_backup_';
  const BACKUP_DB_NAME = 'dt_d1_backup_v1';
  const BACKUP_STORE_NAME = 'snapshots';
  const MAX_CANDIDATE_AGE_MS = 24 * 60 * 60 * 1000;
  const CREDENTIAL_KEY = /^(?:dt_sync_gateway_key|shared_jsonbin_api_key)$/i;
  const D1_METADATA_KEY = /^dt_d1_(?:sync_state|sync_conflict|pre_cutover_backup)_/i;
  const CONNECTION_KEY = /(?:^|_)(?:bin_id|blob|blob_id|sync_blob|sync_key|device_id|import_backup|recovery_v\d+)$/i;
  const TOOL_PATTERNS = [
    ['manga', /^ms_/i], ['novel', /^ns_/i], ['movie', /^mt_/i],
    ['feeding', /^dt_feeding_log_/i], ['timetable', /^dt_subject_progress/i],
    ['diary', /^(?:sd_gaman|dt_secret_diary)/i], ['task_calendar', /^dt_task_cal_/i],
    ['calendar', /^dt_chrono_grid_/i], ['report_card', /^sd_academic_/i],
    ['deadline', /^dt_deadline_/i], ['tasklist', /^dt_tasks_/i],
    ['payment', /^dt_pay_/i], ['vocal_range', /^dt_vocal_range_/i],
    ['library', /^dt_library_/i], ['attendance', /^dt_attendance_/i],
    ['weight_log', /^(?:dt_weight_log_|bio_weight_pet_v8$)/i],
    ['shift_clock', /^dt_shift_clock_/i], ['taskmanage', /^dt_taskmanage_/i],
    ['math_memo', /^dt_(?:0723_)?math_memo_/i], ['ritual_grid', /^dt_ritual_grid_/i],
    ['oshi', /^dt_oshi_/i], ['habit_heatmap', /^dt_heatmap_v\d+$/i],
    ['biome_archive', /^dt_biome_archive_/i]
  ];
  const SPECIAL_KEYS = [
    [/^novel-shelf:[^:]+$/i, 'novel'], [/^km_novel_v\d+$/i, 'novel'],
    [/^km_kanban_v\d+(?:_updated_at)?$/i, 'taskmanage'],
    [/^focus_lab_data_v2_\/.+$/i, 'focus_lab'], [/^focus-lab:v1:\/.+$/i, 'focus_lab'],
    [/^sd_desires_data$/i, 'diary']
  ];
  const INDEXED_DB_TOOLS = new Map([
    ['secretdiarydb', 'diary'], ['sd_report_db', 'report_card'], ['dt_oshi_db', 'oshi']
  ]);
  const KNOWN_DATABASES = new Map([
    ['diary', ['secretdiarydb']],
    ['report_card', ['sd_report_db']],
    ['oshi', ['dt_oshi_db']]
  ]);

  function indexedDBRecordKey(record) {
    return record && Object.prototype.hasOwnProperty.call(record, 'key') ? record.key : null;
  }

  function isIndexedDBMetadataRecord(appKey, databaseName, storeName, record) {
    const key = String(indexedDBRecordKey(record) ?? '');
    if (appKey === 'diary' && String(storeName || '').toLowerCase() === 'settings') {
      return key === 'sd_gaman_sync_key' || /(?:^|_)(?:bin_id|blob|blob_id|sync_key|device_id|api_key)$/i.test(key);
    }
    if (appKey === 'report_card' && String(storeName || '').toLowerCase() === 'settings') {
      return key === 'sync_config' || key === 'sd_academic_sync_key' || /(?:^|_)(?:bin_id|blob|blob_id|sync_key|device_id|api_key)$/i.test(key);
    }
    if (appKey === 'oshi') {
      return /(?:^|_)(?:bin_id|blob|blob_id|sync_key|device_id|api_key)$/i.test(key);
    }
    return false;
  }

  function isObject(value) { return value !== null && typeof value === 'object'; }

  function stableStringify(value) {
    if (value === undefined) return 'null';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  function classifyLocalKey(key) {
    const value = String(key || '');
    const special = SPECIAL_KEYS.find(([pattern]) => pattern.test(value));
    if (special) return special[1];
    const tool = TOOL_PATTERNS.find(([, pattern]) => pattern.test(value));
    if (!tool || CREDENTIAL_KEY.test(value) || D1_METADATA_KEY.test(value) || CONNECTION_KEY.test(value)) return null;
    return tool[0];
  }

  function classifyDatabase(name) {
    return INDEXED_DB_TOOLS.get(String(name || '').toLowerCase()) || null;
  }

  function isCandidateFresh(candidate, now = new Date()) {
    const createdAt = Date.parse(String(candidate?.createdAt || ''));
    const nowAt = now instanceof Date ? now.getTime() : Date.parse(String(now || ''));
    if (!Number.isFinite(createdAt) || !Number.isFinite(nowAt) || createdAt > nowAt) return false;
    return nowAt - createdAt <= MAX_CANDIDATE_AGE_MS;
  }

  function bytesToBase64(bytes) {
    if (typeof root.btoa !== 'function') throw new Error('base64_encoder_unavailable');
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return root.btoa(binary);
  }

  function base64ToBytes(value) {
    if (typeof root.atob !== 'function') throw new Error('base64_decoder_unavailable');
    const binary = root.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  async function serialize(value, seen = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'undefined') return { $type: 'undefined' };
    if (typeof value === 'bigint') return { $type: 'bigint', value: String(value) };
    if (typeof Date !== 'undefined' && value instanceof Date) return { $type: 'date', value: value.toISOString() };
    if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return { $type: 'arraybuffer', value: bytesToBase64(new Uint8Array(value)) };
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) {
      return { $type: 'typedarray', name: value.constructor?.name || 'TypedArray', value: bytesToBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
    }
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
      return { $type: 'blob', type: value.type || '', size: value.size, value: bytesToBase64(new Uint8Array(await value.arrayBuffer())) };
    }
    if (seen.has(value)) return { $type: 'circular' };
    seen.add(value);
    if (Array.isArray(value)) {
      const result = [];
      for (const item of value) result.push(await serialize(item, seen));
      seen.delete(value);
      return result;
    }
    if (typeof Map !== 'undefined' && value instanceof Map) {
      const entries = [];
      for (const [key, item] of value.entries()) entries.push([await serialize(key, seen), await serialize(item, seen)]);
      seen.delete(value);
      return { $type: 'map', entries };
    }
    if (typeof Set !== 'undefined' && value instanceof Set) {
      const values = [];
      for (const item of value.values()) values.push(await serialize(item, seen));
      seen.delete(value);
      return { $type: 'set', values };
    }
    const result = {};
    for (const key of Object.keys(value)) result[key] = await serialize(value[key], seen);
    seen.delete(value);
    return result;
  }

  function deserialize(value) {
    if (!isObject(value)) return value;
    if (value.$type === 'undefined') return undefined;
    if (value.$type === 'bigint') return BigInt(value.value);
    if (value.$type === 'date') return new Date(value.value);
    if (value.$type === 'arraybuffer') return base64ToBytes(value.value).buffer;
    if (value.$type === 'typedarray') {
      const bytes = base64ToBytes(value.value);
      const Ctor = root[value.name] || Uint8Array;
      try { return new Ctor(bytes.buffer); } catch (_) { return bytes; }
    }
    if (value.$type === 'blob' && typeof Blob !== 'undefined') return new Blob([base64ToBytes(value.value)], { type: value.type || '' });
    if (value.$type === 'map') return new Map((value.entries || []).map(([key, item]) => [deserialize(key), deserialize(item)]));
    if (value.$type === 'set') return new Set((value.values || []).map(deserialize));
    if (Array.isArray(value)) return value.map(deserialize);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deserialize(item)]));
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('indexeddb_request_failed'));
    });
  }

  function transactionResult(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('indexeddb_transaction_failed'));
      transaction.onabort = () => reject(transaction.error || new Error('indexeddb_transaction_aborted'));
    });
  }

  function hasObjectStore(db, storeName) {
    if (!db?.objectStoreNames) return false;
    if (typeof db.objectStoreNames.contains === 'function') return db.objectStoreNames.contains(storeName);
    return Array.from(db.objectStoreNames).includes(storeName);
  }

  function openBackupDatabase(indexedDB) {
    if (!indexedDB || typeof indexedDB.open !== 'function') throw new Error('indexeddb_unavailable');
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(BACKUP_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!hasObjectStore(db, BACKUP_STORE_NAME)) db.createObjectStore(BACKUP_STORE_NAME, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('indexeddb_backup_open_failed'));
    });
  }

  async function putOverflowBackup(indexedDB, record) {
    const db = await openBackupDatabase(indexedDB);
    try {
      const transaction = db.transaction(BACKUP_STORE_NAME, 'readwrite');
      const complete = transactionResult(transaction);
      const request = transaction.objectStore(BACKUP_STORE_NAME).put(record);
      await requestResult(request);
      await complete;
      return record.key;
    } finally {
      db.close();
    }
  }

  async function listOverflowBackups(indexedDB) {
    const db = await openBackupDatabase(indexedDB);
    try {
      const transaction = db.transaction(BACKUP_STORE_NAME, 'readonly');
      const complete = transactionResult(transaction);
      const request = transaction.objectStore(BACKUP_STORE_NAME).getAll();
      const records = await requestResult(request);
      await complete;
      return Array.isArray(records) ? records : [];
    } finally {
      db.close();
    }
  }

  async function deleteOverflowBackup(indexedDB, key) {
    const db = await openBackupDatabase(indexedDB);
    try {
      const transaction = db.transaction(BACKUP_STORE_NAME, 'readwrite');
      const complete = transactionResult(transaction);
      const request = transaction.objectStore(BACKUP_STORE_NAME).delete(key);
      await requestResult(request);
      await complete;
    } finally {
      db.close();
    }
  }

  function overflowBackupRecord(key, raw, kind) {
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (_) {}
    return {
      key,
      kind,
      appKey: typeof parsed?.appKey === 'string' ? parsed.appKey : '',
      createdAt: typeof parsed?.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
      serialized: raw
    };
  }

  async function hasOverflowBackup(indexedDB, key) {
    if (!indexedDB || typeof indexedDB.open !== 'function') return false;
    const records = await listOverflowBackups(indexedDB);
    return records.some(record => record?.key === key);
  }

  async function openDatabase(indexedDB, name, store) {
    if (!indexedDB || typeof indexedDB.open !== 'function') throw new Error('indexeddb_unavailable');
    let db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onupgradeneeded = () => {};
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('indexeddb_open_failed'));
    });
    if (!db.objectStoreNames.contains(store.name)) {
      const nextVersion = (Number(db.version) || 0) + 1;
      db.close();
      db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(name, nextVersion);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(store.name)) {
            const options = store.keyPath ? { keyPath: store.keyPath } : undefined;
            request.result.createObjectStore(store.name, options);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('indexeddb_upgrade_failed'));
      });
    }
    return db;
  }

  function openExistingDatabase(indexedDB, name) {
    if (!indexedDB || typeof indexedDB.open !== 'function') throw new Error('indexeddb_unavailable');
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('indexeddb_open_failed'));
    });
  }

  function openDatabaseIfPresent(indexedDB, name) {
    if (!indexedDB || typeof indexedDB.open !== 'function') throw new Error('indexeddb_unavailable');
    return new Promise((resolve, reject) => {
      let createdDuringProbe = false;
      const request = indexedDB.open(name);
      request.onupgradeneeded = () => {
        createdDuringProbe = true;
        try { request.transaction?.abort(); } catch (_) {}
      };
      request.onsuccess = () => {
        if (createdDuringProbe) {
          request.result.close();
          resolve(null);
          return;
        }
        resolve(request.result);
      };
      request.onerror = () => {
        if (createdDuringProbe || request.error?.name === 'AbortError') {
          resolve(null);
          return;
        }
        reject(request.error || new Error('indexeddb_open_failed'));
      };
    });
  }

  async function readStore(db, storeName) {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const values = await requestResult(store.getAll());
    const keys = typeof store.getAllKeys === 'function' ? await requestResult(store.getAllKeys()) : [];
    const records = [];
    for (let index = 0; index < values.length; index += 1) {
      records.push({ key: await serialize(keys[index]), value: await serialize(values[index]) });
    }
    return { keyPath: store.keyPath ?? null, records };
  }

  async function collectIndexedDBEntries(indexedDB, appKey, options = {}) {
    const entries = [];
    if (!indexedDB || typeof indexedDB.open !== 'function') return entries;
    const requestedNames = options?.databaseNames instanceof Set
      ? options.databaseNames
      : Array.isArray(options?.databaseNames)
        ? new Set(options.databaseNames)
        : null;
    let names = null;
    if (typeof indexedDB.databases === 'function') {
      try {
        names = (await indexedDB.databases() || [])
          .map(info => info?.name)
          .filter(name => classifyDatabase(name) === appKey && name
            && (!requestedNames || requestedNames.has(name)));
      } catch (_) {
        names = null;
      }
    }
    const candidates = new Map();
    const candidateNames = new Set();
    for (const name of names || []) {
      candidates.set(name, false);
      candidateNames.add(String(name).toLowerCase());
    }
    // Some mobile implementations expose databases() but omit databases
    // created by an installed PWA (or return an empty list). Add only the
    // small, app-specific allowlist as non-creating probes in that case.
    for (const name of (requestedNames || KNOWN_DATABASES.get(appKey) || [])) {
      if (requestedNames && !requestedNames.has(name)) continue;
      if (!candidateNames.has(String(name).toLowerCase())) {
        candidates.set(name, true);
        candidateNames.add(String(name).toLowerCase());
      }
    }
    for (const [name, probeOnly] of candidates) {
      const db = probeOnly
        ? await openDatabaseIfPresent(indexedDB, name)
        : await openExistingDatabase(indexedDB, name);
      if (!db) continue;
      const storeNames = Array.from(db.objectStoreNames || []);
      for (const storeName of storeNames) {
        const dump = await readStore(db, storeName);
        for (const record of dump.records.filter(item => !isIndexedDBMetadataRecord(appKey, name, storeName, item))) entries.push({
          recordKey: `indexedDB:${name}/${storeName}/${stableStringify(record.key)}`,
          kind: 'indexedDB',
          database: { name, version: db.version },
          store: { name: storeName, keyPath: dump.keyPath },
          entry: record
        });
      }
      db.close();
    }
    return entries;
  }

  function collectLocalStorageEntries(storage, appKey) {
    const entries = [];
    if (!storage || typeof storage.key !== 'function') return entries;
    for (let index = 0; index < Number(storage.length) || 0; index += 1) {
      const key = storage.key(index);
      if (classifyLocalKey(key) !== appKey) continue;
      const raw = storage.getItem(key);
      if (raw === null) continue;
      let encoding = 'text';
      try { JSON.parse(raw); encoding = 'json'; } catch (_) {}
      entries.push({ recordKey: `localStorage:${key}`, kind: 'localStorage', entry: { encoding, raw } });
    }
    return entries;
  }

  async function captureBackupPayload(storage, appKey, candidateEntries, indexedDB, schema, reason = null) {
    const local = [];
    for (const candidate of candidateEntries.filter(entry => entry.kind === 'localStorage')) {
      const key = candidate.recordKey.slice('localStorage:'.length);
      const raw = storage.getItem(key);
      local.push({ key, exists: raw !== null, raw });
    }
    const indexed = [];
    const dbNames = new Set(candidateEntries.filter(entry => entry.kind === 'indexedDB').map(entry => entry.database.name));
    let knownDatabases = null;
    if (typeof indexedDB?.databases === 'function') {
      try {
        knownDatabases = new Set((await indexedDB.databases() || []).map(info => info?.name).filter(Boolean));
      } catch (_) {
        knownDatabases = null;
      }
    }
    for (const name of dbNames) {
      const stores = new Set(candidateEntries.filter(entry => entry.kind === 'indexedDB' && entry.database.name === name).map(entry => entry.store.name));
      if (knownDatabases && !knownDatabases.has(name)) {
        indexed.push({ database: { name, version: 0 }, stores: [], exists: false });
        continue;
      }
      const db = knownDatabases ? await openExistingDatabase(indexedDB, name) : await openDatabaseIfPresent(indexedDB, name);
      if (!db) {
        for (const storeName of stores) indexed.push({ database: { name, version: 0 }, store: { name: storeName }, exists: false });
        continue;
      }
      for (const storeName of stores) {
        if (!db.objectStoreNames.contains(storeName)) {
          indexed.push({ database: { name, version: db.version }, store: { name: storeName }, exists: false });
          continue;
        }
        indexed.push({ database: { name, version: db.version }, store: { name: storeName }, dump: await readStore(db, storeName), exists: true });
      }
      db.close();
    }
    const payload = { schema, version: 1, appKey, createdAt: new Date().toISOString(), local, indexed };
    if (reason) payload.reason = reason;
    return payload;
  }

  async function saveSafetyBackup(storage, appKey, candidateEntries, indexedDB) {
    const backupKey = `${BACKUP_PREFIX}${appKey}`;
    if (storage.getItem(backupKey) !== null) return backupKey;
    if (await hasOverflowBackup(indexedDB, backupKey)) return backupKey;
    const payload = await captureBackupPayload(storage, appKey, candidateEntries, indexedDB, 'dt-world-d1-pre-cutover-backup');
    const serialized = JSON.stringify(payload);
    try {
      storage.setItem(backupKey, serialized);
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      await putOverflowBackup(indexedDB, overflowBackupRecord(backupKey, serialized, 'pre_cutover'));
    }
    return backupKey;
  }

  function isQuotaError(error) {
    return error?.name === 'QuotaExceededError'
      || error?.code === 22
      || error?.code === 1014
      || /quota/i.test(String(error?.message || ''));
  }

  function runtimeBackupItems(storage, appKey) {
    const prefix = `${RUNTIME_BACKUP_PREFIX}${appKey}_`;
    const items = [];
    for (let index = 0; index < Number(storage.length) || 0; index += 1) {
      const key = storage.key(index);
      if (!key || !key.startsWith(prefix)) continue;
      let createdAt = '';
      try { createdAt = JSON.parse(storage.getItem(key) || '{}').createdAt || ''; } catch (_) {}
      items.push({ key, createdAt });
    }
    items.sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)) || left.key.localeCompare(right.key));
    return items;
  }

  function allRuntimeBackupItems(storage) {
    const items = [];
    for (let index = 0; index < Number(storage.length) || 0; index += 1) {
      const key = storage.key(index);
      if (!key || !key.startsWith(RUNTIME_BACKUP_PREFIX)) continue;
      const suffix = key.slice(RUNTIME_BACKUP_PREFIX.length);
      const separator = suffix.lastIndexOf('_');
      if (separator <= 0) continue;
      let createdAt = '';
      try { createdAt = JSON.parse(storage.getItem(key) || '{}').createdAt || ''; } catch (_) {}
      items.push({
        key,
        appKey: suffix.slice(0, separator),
        createdAt
      });
    }
    items.sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)) || left.key.localeCompare(right.key));
    return items;
  }

  function runtimeBackupCleanupItems(storage, appKey) {
    const sameApp = runtimeBackupItems(storage, appKey);
    const all = allRuntimeBackupItems(storage);
    const latestKeyByApp = new Map();
    for (const item of all) latestKeyByApp.set(item.appKey, item.key);
    const olderOtherApps = all.filter(item => item.appKey !== appKey && latestKeyByApp.get(item.appKey) !== item.key);
    const newestOtherApps = all.filter(item => item.appKey !== appKey && latestKeyByApp.get(item.appKey) === item.key);
    return [...sameApp, ...olderOtherApps, ...newestOtherApps];
  }

  function writeRuntimeBackup(storage, appKey, backupKey, serialized) {
    try {
      storage.setItem(backupKey, serialized);
      return;
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      // A runtime backup is a generated safety copy, not live application
      // data. Remove only generated copies until the new copy fits. The
      // current local data, pre-cutover backups, and connection metadata stay.
      let lastError = error;
      for (const item of runtimeBackupCleanupItems(storage, appKey)) {
        storage.removeItem(item.key);
        try {
          storage.setItem(backupKey, serialized);
          return;
        } catch (retryError) {
          if (!isQuotaError(retryError)) throw retryError;
          lastError = retryError;
        }
      }
      throw lastError;
    }
  }

  async function writeLocalStorageEntry(storage, appKey, key, raw, indexedDB) {
    try {
      storage.setItem(key, raw);
      return;
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      // The live value is never removed before a successful replacement.
      // Reclaim only generated runtime copies, then retry the incoming D1
      // value. Pre-cutover backups and live data remain intact.
      let lastError = error;
      for (const item of runtimeBackupCleanupItems(storage, appKey)) {
        storage.removeItem(item.key);
        try {
          storage.setItem(key, raw);
          return;
        } catch (retryError) {
          if (!isQuotaError(retryError)) throw retryError;
          lastError = retryError;
        }
      }
      return spillLocalBackupsUntilFits(storage, appKey, key, raw, indexedDB, lastError);
    }
  }

  function spillableBackupItems(storage, appKey) {
    const items = [];
    for (let index = 0; index < Number(storage.length) || 0; index += 1) {
      const key = storage.key(index);
      if (!key || (!key.startsWith(BACKUP_PREFIX) && !key.startsWith('dt_d1_recovery_backup_'))) continue;
      const raw = storage.getItem(key);
      if (raw === null) continue;
      let storedAppKey = '';
      try { storedAppKey = JSON.parse(raw)?.appKey || ''; } catch (_) {}
      items.push({
        key,
        raw,
        sameApp: storedAppKey === appKey || key === `${BACKUP_PREFIX}${appKey}`
      });
    }
    return items.sort((left, right) => Number(right.sameApp) - Number(left.sameApp) || left.key.localeCompare(right.key));
  }

  async function spillLocalBackup(indexedDB, storage, item) {
    await putOverflowBackup(indexedDB, overflowBackupRecord(
      item.key,
      item.raw,
      item.key.startsWith(BACKUP_PREFIX) ? 'pre_cutover' : 'recovery'
    ));
    // The copy is durable before the localStorage key is removed. If this
    // removal fails, keeping both copies is safer than forcing the apply.
    try { storage.removeItem(item.key); } catch (_) {}
  }

  async function spillLocalBackupsUntilFits(storage, appKey, key, raw, indexedDB, lastError) {
    if (!indexedDB) throw lastError;
    let error = lastError;
    for (const item of spillableBackupItems(storage, appKey)) {
      await spillLocalBackup(indexedDB, storage, item);
      try {
        storage.setItem(key, raw);
        return;
      } catch (retryError) {
        if (!isQuotaError(retryError)) throw retryError;
        error = retryError;
      }
    }
    throw error;
  }

  async function trimOverflowRuntimeBackups(indexedDB, appKey) {
    if (!indexedDB) return;
    const records = (await listOverflowBackups(indexedDB))
      .filter(record => record?.kind === 'runtime' && record.appKey === appKey)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)) || String(right.key).localeCompare(String(left.key)));
    for (const record of records.slice(2)) await deleteOverflowBackup(indexedDB, record.key);
  }

  async function saveRuntimeBackup(storage, appKey, indexedDB, reason = 'remote-apply') {
    const currentEntries = [
      ...collectLocalStorageEntries(storage, appKey),
      ...await collectIndexedDBEntries(indexedDB, appKey)
    ];
    const backupKey = `${RUNTIME_BACKUP_PREFIX}${appKey}_${Date.now()}`;
    const payload = await captureBackupPayload(
      storage, appKey, currentEntries, indexedDB, 'dt-world-d1-runtime-backup', reason
    );
    const serialized = JSON.stringify(payload);
    try {
      writeRuntimeBackup(storage, appKey, backupKey, serialized);
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      if (!indexedDB) throw error;
      await putOverflowBackup(indexedDB, overflowBackupRecord(backupKey, serialized, 'runtime'));
      await trimOverflowRuntimeBackups(indexedDB, appKey);
      return backupKey;
    }

    const keys = runtimeBackupItems(storage, appKey).reverse();
    for (const item of keys.slice(2)) storage.removeItem(item.key);
    return backupKey;
  }

  async function applyIndexedEntry(indexedDB, entry) {
    const db = await openDatabase(indexedDB, entry.database.name, entry.store);
    const transaction = db.transaction(entry.store.name, 'readwrite');
    const store = transaction.objectStore(entry.store.name);
    const value = deserialize(entry.entry.value);
    const key = deserialize(entry.entry.key);
    if (store.keyPath === null || store.keyPath === undefined || store.keyPath === '') store.put(value, key);
    else store.put(value);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('indexeddb_write_failed'));
      transaction.onabort = () => reject(transaction.error || new Error('indexeddb_write_aborted'));
    });
    db.close();
  }

  async function removeIndexedEntry(indexedDB, entry) {
    const db = await openDatabase(indexedDB, entry.database.name, entry.store);
    const transaction = db.transaction(entry.store.name, 'readwrite');
    const store = transaction.objectStore(entry.store.name);
    store.delete(deserialize(entry.entry.key));
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('indexeddb_delete_failed'));
      transaction.onabort = () => reject(transaction.error || new Error('indexeddb_delete_aborted'));
    });
    db.close();
  }

  async function applyCandidateApp(candidate, {
    appKey,
    storage = root.localStorage,
    indexedDB = root.indexedDB,
    onlyIfEmpty = false,
    skipSafetyBackup = false
  } = {}) {
    if (!candidate || candidate.status !== 'ready' || !Array.isArray(candidate.entries) || !candidate.entries.length) {
      throw new Error('candidate_not_ready');
    }
    if (!appKey || !storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') throw new Error('storage_unavailable');
    const entries = candidate.entries.filter(entry => entry && (entry.kind === 'localStorage' || entry.kind === 'indexedDB'));
    if (entries.length !== candidate.entries.length || !entries.length) throw new Error('candidate_invalid');
    if (onlyIfEmpty) {
      const existingLocal = collectLocalStorageEntries(storage, appKey);
      const existingIndexed = await collectIndexedDBEntries(indexedDB, appKey);
      if (existingLocal.length || existingIndexed.length) throw new Error('local_data_exists');
    }
    // Live D1 pulls already create a full runtime backup immediately before
    // entering this function. Do not serialize the same large application a
    // second time: on storage-constrained PWAs that duplicate write is what
    // turns a safe pull into an apply_failed result. Recovery/cutover callers
    // keep the normal pre-cutover backup path.
    const backupKey = skipSafetyBackup
      ? null
      : await saveSafetyBackup(storage, appKey, entries, indexedDB);
    let localApplied = 0;
    let indexedApplied = 0;
    for (const entry of entries) {
      if (entry.kind === 'localStorage') {
        const key = entry.recordKey.startsWith('localStorage:') ? entry.recordKey.slice('localStorage:'.length) : '';
        if (!key || typeof entry.entry?.raw !== 'string' || CREDENTIAL_KEY.test(key) || CONNECTION_KEY.test(key)) throw new Error('candidate_invalid');
        if (entry.deletedAt) storage.removeItem(key);
        else await writeLocalStorageEntry(storage, appKey, key, entry.entry.raw, indexedDB);
        localApplied += 1;
      } else {
        if (!indexedDB) throw new Error('indexeddb_unavailable');
        if (entry.deletedAt) await removeIndexedEntry(indexedDB, entry);
        else await applyIndexedEntry(indexedDB, entry);
        indexedApplied += 1;
      }
    }
    return { ok: true, appKey, backupKey, localApplied, indexedApplied, recordCount: entries.length };
  }

  root.DTSyncCutover = {
    BACKUP_PREFIX,
    RUNTIME_BACKUP_PREFIX,
    BACKUP_DB_NAME,
    BACKUP_STORE_NAME,
    MAX_CANDIDATE_AGE_MS,
    isCandidateFresh,
    stableStringify,
    serialize,
    deserialize,
    classifyLocalKey,
    classifyDatabase,
    collectLocalStorageEntries,
    collectIndexedDBEntries,
    isIndexedDBMetadataRecord,
    listOverflowBackups,
    saveRuntimeBackup,
    applyCandidateApp
  };
})(typeof window !== 'undefined' ? window : globalThis);

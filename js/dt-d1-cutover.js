/* Safe, opt-in application of a staged migration candidate.
 *
 * This module never removes a storage key, clears an object store, changes a
 * JSONBin ID, or writes to the raw migration snapshots.  Existing values are
 * captured before the candidate is applied so a cutover remains recoverable.
 */
(function (root) {
  'use strict';

  const BACKUP_PREFIX = 'dt_d1_pre_cutover_backup_';
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

  async function collectIndexedDBEntries(indexedDB, appKey) {
    const entries = [];
    if (!indexedDB || typeof indexedDB.databases !== 'function') return entries;
    const infos = await indexedDB.databases();
    for (const info of infos || []) {
      const name = info?.name;
      if (classifyDatabase(name) !== appKey || !name) continue;
      const db = await openExistingDatabase(indexedDB, name);
      const storeNames = Array.from(db.objectStoreNames || []);
      for (const storeName of storeNames) {
        const dump = await readStore(db, storeName);
        for (const record of dump.records) entries.push({
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

  async function saveSafetyBackup(storage, appKey, candidateEntries, indexedDB) {
    const backupKey = `${BACKUP_PREFIX}${appKey}`;
    if (storage.getItem(backupKey) !== null) return backupKey;
    const local = [];
    for (const candidate of candidateEntries.filter(entry => entry.kind === 'localStorage')) {
      const key = candidate.recordKey.slice('localStorage:'.length);
      const raw = storage.getItem(key);
      local.push({ key, exists: raw !== null, raw });
    }
    const indexed = [];
    const dbNames = new Set(candidateEntries.filter(entry => entry.kind === 'indexedDB').map(entry => entry.database.name));
    const knownDatabases = typeof indexedDB?.databases === 'function'
      ? new Set((await indexedDB.databases() || []).map(info => info?.name).filter(Boolean))
      : null;
    for (const name of dbNames) {
      const stores = new Set(candidateEntries.filter(entry => entry.kind === 'indexedDB' && entry.database.name === name).map(entry => entry.store.name));
      if (knownDatabases && !knownDatabases.has(name)) {
        indexed.push({ database: { name, version: 0 }, stores: [], exists: false });
        continue;
      }
      const db = await openExistingDatabase(indexedDB, name);
      for (const storeName of stores) {
        if (!db.objectStoreNames.contains(storeName)) {
          indexed.push({ database: { name, version: db.version }, store: { name: storeName }, exists: false });
          continue;
        }
        indexed.push({ database: { name, version: db.version }, store: { name: storeName }, dump: await readStore(db, storeName), exists: true });
      }
      db.close();
    }
    const payload = { schema: 'dt-world-d1-pre-cutover-backup', version: 1, appKey, createdAt: new Date().toISOString(), local, indexed };
    storage.setItem(backupKey, JSON.stringify(payload));
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

  async function applyCandidateApp(candidate, { appKey, storage = root.localStorage, indexedDB = root.indexedDB, onlyIfEmpty = false } = {}) {
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
    const backupKey = await saveSafetyBackup(storage, appKey, entries, indexedDB);
    let localApplied = 0;
    let indexedApplied = 0;
    for (const entry of entries) {
      if (entry.kind === 'localStorage') {
        const key = entry.recordKey.startsWith('localStorage:') ? entry.recordKey.slice('localStorage:'.length) : '';
        if (!key || typeof entry.entry?.raw !== 'string' || CREDENTIAL_KEY.test(key) || CONNECTION_KEY.test(key)) throw new Error('candidate_invalid');
        storage.setItem(key, entry.entry.raw);
        localApplied += 1;
      } else {
        if (!indexedDB) throw new Error('indexeddb_unavailable');
        await applyIndexedEntry(indexedDB, entry);
        indexedApplied += 1;
      }
    }
    return { ok: true, appKey, backupKey, localApplied, indexedApplied, recordCount: entries.length };
  }

  root.DTSyncCutover = {
    BACKUP_PREFIX,
    stableStringify,
    serialize,
    deserialize,
    classifyLocalKey,
    classifyDatabase,
    collectLocalStorageEntries,
    collectIndexedDBEntries,
    applyCandidateApp
  };
})(typeof window !== 'undefined' ? window : globalThis);

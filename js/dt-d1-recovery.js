/* Local, non-destructive recovery for data captured immediately before a D1 cutover. */
(function (root) {
  'use strict';

  const PRE_CUTOVER_PREFIX = 'dt_d1_pre_cutover_backup_';
  const RECOVERY_PREFIX = 'dt_d1_recovery_backup_';
  const HOLD_PREFIX = 'dt_d1_recovery_hold_';
  const SCHEMA = 'dt-world-d1-pre-cutover-backup';
  const RECOVERY_SCHEMA = 'dt-world-d1-recovery-backup';

  function isObject(value) {
    return value !== null && typeof value === 'object';
  }

  function parsePreCutoverBackup(raw, expectedAppKey = '') {
    let value;
    try { value = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return null; }
    if (!isObject(value) || value.schema !== SCHEMA || value.version !== 1
      || typeof value.appKey !== 'string' || !value.appKey
      || (expectedAppKey && value.appKey !== expectedAppKey)
      || typeof value.createdAt !== 'string'
      || !Array.isArray(value.local) || !Array.isArray(value.indexed)) return null;
    const local = value.local.filter(item => item && typeof item.key === 'string'
      && typeof item.exists === 'boolean'
      && (item.raw === null || typeof item.raw === 'string'));
    const indexed = value.indexed.filter(item => item && isObject(item.database)
      && typeof item.database.name === 'string' && item.database.name
      && isObject(item.store) && typeof item.store.name === 'string' && item.store.name
      && typeof item.exists === 'boolean'
      && (item.dump === undefined || item.dump === null || isObject(item.dump)));
    if (local.length !== value.local.length || indexed.length !== value.indexed.length) return null;
    return { ...value, local, indexed };
  }

  function listPreCutoverBackups(storage = root.localStorage) {
    if (!storage || typeof storage.key !== 'function') return [];
    const backups = [];
    for (let index = 0; index < Number(storage.length) || 0; index += 1) {
      const backupKey = storage.key(index);
      if (typeof backupKey !== 'string' || !backupKey.startsWith(PRE_CUTOVER_PREFIX)) continue;
      const backup = parsePreCutoverBackup(storage.getItem(backupKey));
      if (!backup) continue;
      const localCount = backup.local.filter(item => item.exists && typeof item.raw === 'string').length;
      const indexedCount = backup.indexed.reduce((total, item) => total + (
        item.exists && Array.isArray(item.dump?.records) ? item.dump.records.length : 0
      ), 0);
      backups.push({
        backupKey,
        appKey: backup.appKey,
        createdAt: backup.createdAt,
        localCount,
        indexedCount,
        totalCount: localCount + indexedCount,
        backup
      });
    }
    return backups.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  }

  function backupEntries(backup) {
    const entries = [];
    for (const item of backup.local || []) {
      if (!item?.exists || typeof item.key !== 'string' || typeof item.raw !== 'string') continue;
      let encoding = 'text';
      try { JSON.parse(item.raw); encoding = 'json'; } catch (_) {}
      entries.push({
        recordKey: `localStorage:${item.key}`,
        kind: 'localStorage',
        entry: { encoding, raw: item.raw }
      });
    }
    for (const item of backup.indexed || []) {
      if (!item?.exists || !item.database?.name || !item.store?.name || !Array.isArray(item.dump?.records)) continue;
      for (const record of item.dump.records) {
        if (!record || !Object.prototype.hasOwnProperty.call(record, 'key')
          || !Object.prototype.hasOwnProperty.call(record, 'value')) continue;
        const stableKey = typeof root.DTSyncCutover?.stableStringify === 'function'
          ? root.DTSyncCutover.stableStringify(record.key)
          : JSON.stringify(record.key);
        entries.push({
          recordKey: `indexedDB:${item.database.name}/${item.store.name}/${stableKey}`,
          kind: 'indexedDB',
          database: { name: item.database.name, version: Number(item.database.version) || 0 },
          store: { name: item.store.name, keyPath: item.dump.keyPath ?? null },
          entry: { key: record.key, value: record.value }
        });
      }
    }
    return entries;
  }

  function recoveryError(code, cause) {
    const error = new Error(code);
    error.code = code;
    if (cause && typeof cause === 'object' && cause.name) error.causeName = cause.name;
    return error;
  }

  function indexedDatabaseNames(backup) {
    return [...new Set((backup?.indexed || [])
      .filter(item => item?.exists && Array.isArray(item.dump?.records))
      .map(item => item.database?.name)
      .filter(Boolean))];
  }

  async function saveRecoveryBackup(storage, appKey, entries, now = new Date()) {
    const timestamp = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
    const suffix = String(Date.parse(timestamp));
    let backupKey = `${RECOVERY_PREFIX}${appKey}_${suffix}`;
    let counter = 1;
    while (storage.getItem(backupKey) !== null) backupKey = `${RECOVERY_PREFIX}${appKey}_${suffix}_${counter++}`;
    const payload = {
      schema: RECOVERY_SCHEMA,
      version: 1,
      appKey,
      createdAt: timestamp,
      entries: Array.isArray(entries) ? entries : []
    };
    storage.setItem(backupKey, JSON.stringify(payload));
    return backupKey;
  }

  async function restorePreCutoverBackup(backupInput, {
    appKey,
    storage = root.localStorage,
    indexedDB = root.indexedDB,
    cutover = root.DTSyncCutover,
    now = new Date()
  } = {}) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') throw recoveryError('storage_unavailable');
    if (!cutover || typeof cutover.applyCandidateApp !== 'function'
      || typeof cutover.collectLocalStorageEntries !== 'function') throw recoveryError('cutover_module_unavailable');
    const backup = parsePreCutoverBackup(backupInput, appKey);
    if (!backup) throw recoveryError('invalid_pre_cutover_backup');
    const entries = backupEntries(backup);
    if (!entries.length) throw recoveryError('backup_empty');

    let current;
    try {
      current = cutover.collectLocalStorageEntries(storage, appKey);
    } catch (error) {
      throw recoveryError('recovery_current_localstorage_failed', error);
    }
    // A localStorage-only backup does not need an IndexedDB probe. This is
    // important for installed mobile PWAs, where probing unrelated databases
    // can fail even though the app's localStorage is healthy.
    const databaseNames = indexedDatabaseNames(backup);
    if (databaseNames.length && typeof cutover.collectIndexedDBEntries === 'function') {
      try {
        const indexed = await cutover.collectIndexedDBEntries(indexedDB, appKey, { databaseNames });
        current.push(...indexed);
      } catch (error) {
        throw recoveryError('recovery_current_indexeddb_failed', error);
      }
    }
    let recoveryBackupKey;
    try {
      recoveryBackupKey = await saveRecoveryBackup(storage, appKey, current, now);
    } catch (error) {
      throw recoveryError('recovery_safety_backup_failed', error);
    }
    const sourceBackupKey = `${PRE_CUTOVER_PREFIX}${appKey}`;
    // Set the hold before writing any app data. Mutation observers may schedule
    // a runtime sync, but the runtime will see this marker and refuse to pull
    // the stale live value back over the restored data.
    try {
      storage.setItem(`${HOLD_PREFIX}${appKey}`, JSON.stringify({
        schema: 'dt-world-d1-recovery-hold',
        version: 1,
        appKey,
        createdAt: new Date(now).toISOString(),
        sourceBackupKey,
        recoveryBackupKey,
        reason: 'restored_pre_cutover'
      }));
    } catch (error) {
      throw recoveryError('recovery_hold_save_failed', error);
    }
    let applied;
    try {
      applied = await cutover.applyCandidateApp(
        { status: 'ready', entries },
        { appKey, storage, indexedDB }
      );
    } catch (error) {
      throw recoveryError('recovery_apply_failed', error);
    }
    return { ...applied, ok: true, appKey, sourceBackupKey, recoveryBackupKey, restoredFrom: backup.createdAt };
  }

  function isRecoveryHeld(storage = root.localStorage, appKey = '') {
    return Boolean(appKey && storage?.getItem(`${HOLD_PREFIX}${appKey}`));
  }

  function clearRecoveryHold(storage = root.localStorage, appKey = '') {
    if (!appKey || typeof storage?.removeItem !== 'function') return false;
    storage.removeItem(`${HOLD_PREFIX}${appKey}`);
    return true;
  }

  root.DTD1Recovery = {
    PRE_CUTOVER_PREFIX,
    RECOVERY_PREFIX,
    HOLD_PREFIX,
    parsePreCutoverBackup,
    listPreCutoverBackups,
    backupEntries,
    saveRecoveryBackup,
    restorePreCutoverBackup,
    isRecoveryHeld,
    clearRecoveryHold
  };
})(typeof window !== 'undefined' ? window : globalThis);

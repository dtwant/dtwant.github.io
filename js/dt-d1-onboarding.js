/* Safe live-D1 bootstrap for a new browser or PWA installation.
 *
 * This module deliberately does not use a migration candidate.  It reads the
 * current live records and applies them only when the target application has
 * no app-owned local data.  JSONBin IDs, raw snapshots, and existing local
 * values are never removed by this flow.
 */
(function (root) {
  'use strict';

  const SAFE_APP_KEYS = [
    'manga', 'novel', 'movie', 'feeding', 'timetable', 'diary',
    'task_calendar', 'calendar', 'report_card', 'deadline', 'tasklist',
    'payment', 'vocal_range', 'library', 'attendance', 'weight_log',
    'shift_clock', 'taskmanage', 'math_memo', 'ritual_grid', 'oshi',
    'habit_heatmap', 'biome_archive', 'focus_lab'
  ];

  function remoteRecordToCandidateEntry(record) {
    // A tombstone is intentionally not materialized on a new device.  The
    // live runtime treats it as a conflict instead of resurrecting data that
    // was deleted on another device.
    if (record?.deletedAt) return null;
    const payload = record?.payload;
    if (!record || typeof record.recordKey !== 'string' || !payload || payload.schema !== 'dt-world-d1-record' || payload.version !== 1) return null;
    if (payload.kind === 'localStorage'
      && typeof payload.key === 'string'
      && payload.entry
      && ['json', 'text'].includes(payload.entry.encoding)
      && typeof payload.entry.raw === 'string') {
      return {
        recordKey: record.recordKey,
        kind: 'localStorage',
        entry: { encoding: payload.entry.encoding, raw: payload.entry.raw }
      };
    }
    if (payload.kind === 'indexedDB'
      && payload.database && typeof payload.database.name === 'string'
      && payload.store && typeof payload.store.name === 'string'
      && payload.entry && Object.prototype.hasOwnProperty.call(payload.entry, 'key')) {
      return {
        recordKey: record.recordKey,
        kind: 'indexedDB',
        database: { name: payload.database.name, version: Number(payload.database.version) || 0 },
        store: { name: payload.store.name, keyPath: payload.store.keyPath ?? null },
        entry: { key: payload.entry.key, value: payload.entry.value }
      };
    }
    return null;
  }

  function validateSnapshot(snapshot, appKey) {
    return Boolean(snapshot
      && snapshot.schema === 'dt-world-sync-records'
      && snapshot.version === 1
      && snapshot.appKey === appKey
      && Array.isArray(snapshot.records));
  }

  async function localAppData(appKey, storage, indexedDB, cutover) {
    const localStorageEntries = cutover?.collectLocalStorageEntries
      ? cutover.collectLocalStorageEntries(storage, appKey)
      : [];
    const indexedDBEntries = cutover?.collectIndexedDBEntries
      ? await cutover.collectIndexedDBEntries(indexedDB, appKey)
      : [];
    return { localStorageEntries, indexedDBEntries };
  }

  async function bootstrapAppFromLive({
    appKey,
    snapshot,
    storage = root.localStorage,
    indexedDB = root.indexedDB,
    cutover = root.DTSyncCutover,
    setProvider
  } = {}) {
    if (!SAFE_APP_KEYS.includes(appKey)) return { status: 'skipped', reason: 'app_not_allowed' };
    if (!validateSnapshot(snapshot, appKey)) return { status: 'failed', reason: 'invalid_remote' };
    const entries = snapshot.records.map(remoteRecordToCandidateEntry);
    if (!entries.length || entries.some(entry => !entry)) return { status: 'skipped', reason: 'empty_remote' };
    if (!cutover?.applyCandidateApp) return { status: 'failed', reason: 'cutover_unavailable' };

    const local = await localAppData(appKey, storage, indexedDB, cutover);
    if (local.localStorageEntries.length || local.indexedDBEntries.length) {
      return { status: 'skipped', reason: 'local_data' };
    }

    try {
      const applied = await cutover.applyCandidateApp(
        { status: 'ready', entries },
        { appKey, storage, indexedDB, onlyIfEmpty: true }
      );
      if (typeof setProvider === 'function') setProvider('d1');
      else storage.setItem(`dt_sync_provider_${appKey}`, 'd1');
      return { status: 'enabled', appKey, recordCount: entries.length, backupKey: applied?.backupKey || null };
    } catch (error) {
      return { status: 'failed', reason: error?.message || 'apply_failed' };
    }
  }

  root.DTSyncOnboarding = {
    SAFE_APP_KEYS,
    remoteRecordToCandidateEntry,
    validateSnapshot,
    bootstrapAppFromLive
  };
})(typeof window !== 'undefined' ? window : globalThis);

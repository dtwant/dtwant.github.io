/* Opt-in D1 live synchronizer for migrated tools.
 *
 * D1 is used as the live transport only after a tool explicitly opts in.
 * Every record keeps the last successful local/remote baseline. Remote-only
 * changes are pulled, local-only changes are pushed, and when both changed
 * the value with the newer updatedAt wins. Equal or unavailable timestamps
 * remain reviewable conflicts.
 */
(function (root) {
  'use strict';

  const PATHS = [
    [/\/0723\/manga(?:\/|$)/, 'manga'], [/\/0723\/novel(?:\/|$)/, 'novel'],
    [/\/0723\/movie(?:\/|$)/, 'movie'], [/\/0723\/feeding(?:\/|$)/, 'feeding'],
    [/\/project-x\/timetable(?:\/|$)/, 'timetable'], [/\/0723\/diary(?:\/|$)/, 'diary'],
    [/\/0723\/action_log(?:\/|$)/, 'task_calendar'], [/\/0723\/calendar(?:\/|$)/, 'calendar'],
    [/\/0723\/report-card(?:\/|$)/, 'report_card'], [/\/lab\/deadline(?:\/|$)/, 'deadline'],
    [/(?:^|\/)tasks(?:\/|$)/, 'tasklist'], [/\/0723\/payment(?:\/|$)/, 'payment'],
    [/\/0723\/vocal-range(?:\/|$)/, 'vocal_range'], [/\/library(?:\/|$)/, 'library'],
    [/\/lab\/attendance(?:\/|$)/, 'attendance'], [/\/0723\/(?:weight_log|weight-log)(?:\/|$)/, 'weight_log'],
    [/\/0723\/shift-clock(?:\/|$)/, 'shift_clock'], [/\/0723\/taskmanage(?:\/|$)/, 'taskmanage'],
    [/\/0723\/math-memo(?:\/|$)/, 'math_memo'], [/\/0723\/ritual-grid(?:\/|$)/, 'ritual_grid'],
    [/\/0723\/oshi(?:\/|$)/, 'oshi'], [/\/lab\/heatmap(?:\/|$)/, 'habit_heatmap'],
    [/(?:^|\/)biome(?:-dashboard)?(?:\/|$)/, 'biome_archive']
  ];
  const LIVE_APP_KEYS = [
    'manga', 'novel', 'movie', 'feeding', 'timetable', 'diary',
    'task_calendar', 'calendar', 'report_card', 'deadline', 'tasklist',
    'payment', 'vocal_range', 'library', 'attendance', 'weight_log',
    'shift_clock', 'taskmanage', 'math_memo', 'ritual_grid', 'oshi',
    'habit_heatmap', 'biome_archive'
  ];
  const STATE_PREFIX = 'dt_d1_sync_state_';
  const CONFLICT_PREFIX = 'dt_d1_sync_conflict_';
  const LOCAL_UPDATED_PREFIX = 'dt_d1_local_updated_';
  const RUNTIME_METADATA_KEY = /^dt_d1_(?:sync_state|sync_conflict|pre_cutover_backup|local_updated)_/i;
  let suppressLocalTracking = false;

  function appKeyFromPath(pathname) {
    return PATHS.find(([pattern]) => pattern.test(String(pathname || '')))?.[1] || null;
  }

  function stableStringify(value) {
    if (value === undefined) return 'null';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  async function sha256(value) {
    if (!root.crypto?.subtle) return stableStringify(value);
    const encoder = root.TextEncoder ? new root.TextEncoder() : new TextEncoder();
    const digest = await root.crypto.subtle.digest('SHA-256', encoder.encode(stableStringify(value)));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function timestampMs(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizedTimestamp(value) {
    const parsed = timestampMs(value);
    if (parsed === null) return null;
    return typeof value === 'string' ? value : new Date(parsed).toISOString();
  }

  function latestWins(local, remote) {
    const localAt = timestampMs(local?.updatedAt);
    const remoteAt = timestampMs(remote?.updatedAt);
    if (localAt === null || remoteAt === null) return null;
    if (localAt > remoteAt) {
      return {
        action: 'push',
        expectedRevision: Number.isInteger(remote?.revision) ? remote.revision : null,
        reason: 'local_newer'
      };
    }
    if (remoteAt > localAt) return { action: 'pull', reason: 'remote_newer' };
    return { action: 'conflict', reason: 'same_timestamp' };
  }

  function classifyRecord({ local, remote, previous }) {
    const localHash = local?.hash ?? null;
    const remoteHash = remote?.hash ?? null;
    if (localHash !== null && remoteHash !== null && localHash === remoteHash) return { action: 'unchanged' };

    if (!previous) {
      if (localHash === null && remoteHash !== null) return { action: 'pull' };
      if (localHash !== null && remoteHash === null) return { action: 'push', expectedRevision: null };
      const latest = latestWins(local, remote);
      if (latest) return latest;
      return { action: 'conflict', reason: 'baseline_missing' };
    }

    if (localHash === null && remoteHash !== null) return { action: 'conflict', reason: 'local_missing' };
    if (localHash !== null && remoteHash === null) return { action: 'conflict', reason: 'remote_missing' };
    if (localHash === null && remoteHash === null) return { action: 'unchanged' };

    const localChanged = localHash !== (previous.localHash ?? null);
    const remoteChanged = remoteHash !== (previous.remoteHash ?? null);
    if (!localChanged && remoteChanged) return { action: 'pull' };
    if (localChanged && !remoteChanged) {
      return {
        action: 'push',
        expectedRevision: Number.isInteger(remote?.revision) ? remote.revision : null
      };
    }
    if (localChanged && remoteChanged) {
      const latest = latestWins(local, remote);
      if (latest) return latest;
      return { action: 'conflict', reason: 'both_changed' };
    }
    return { action: 'conflict', reason: 'baseline_mismatch' };
  }

  function explicitResolutionDecision({ local, remote, previous }) {
    const resolutionAt = timestampMs(remote?.resolutionAt);
    const previousRevision = previous?.remoteRevision;
    if (resolutionAt === null || !Number.isInteger(remote?.revision) || !Number.isInteger(previousRevision)) return null;
    if (remote.revision <= previousRevision) return null;
    const localAt = timestampMs(local?.updatedAt);
    if (localAt !== null && localAt > resolutionAt) return null;
    return { action: 'pull', reason: 'explicit_resolution' };
  }

  function readSyncState(storage, appKey) {
    try {
      const parsed = JSON.parse(storage.getItem(`${STATE_PREFIX}${appKey}`) || '');
      if (parsed?.version === 1 && parsed.records && typeof parsed.records === 'object') return parsed;
    } catch (_) { /* invalid metadata is treated as no baseline */ }
    return { version: 1, appKey, records: {} };
  }

  function writeSyncState(storage, appKey, records) {
    try {
      storage.setItem(`${STATE_PREFIX}${appKey}`, JSON.stringify({
        schema: 'dt-world-d1-sync-state', version: 1, appKey, records,
        updatedAt: new Date().toISOString()
      }));
    } catch (_) { /* sync remains safe if metadata storage is unavailable */ }
  }

  function readLocalUpdatedAt(storage, appKey, recordKey, payload) {
    try {
      const parsed = JSON.parse(storage.getItem(`${LOCAL_UPDATED_PREFIX}${appKey}`) || '');
      const stored = normalizedTimestamp(parsed?.[recordKey]);
      if (stored) return stored;
    } catch (_) { /* fall through to a timestamp embedded in the payload */ }
    if (payload?.kind === 'localStorage' && payload.entry?.encoding === 'json' && typeof payload.entry.raw === 'string') {
      try {
        const value = JSON.parse(payload.entry.raw);
        const timestamps = [];
        const visit = (current, seen = new Set()) => {
          if (!current || typeof current !== 'object' || seen.has(current)) return;
          seen.add(current);
          for (const [key, value] of Object.entries(current)) {
            if (/^(?:updatedAt|updated_at|modifiedAt|modified_at)$/i.test(key)) {
              const timestamp = normalizedTimestamp(value);
              if (timestamp) timestamps.push(timestamp);
            } else {
              visit(value, seen);
            }
          }
        };
        visit(value);
        timestamps.sort((left, right) => timestampMs(right) - timestampMs(left));
        return timestamps[0] || null;
      } catch (_) { /* invalid payload is handled by the normal hash path */ }
    }
    if (payload?.kind === 'indexedDB') {
      const timestamps = [];
      const visit = (current, seen = new Set()) => {
        if (!current || typeof current !== 'object' || seen.has(current)) return;
        seen.add(current);
        for (const [key, value] of Object.entries(current)) {
          if (/^(?:updatedAt|updated_at|modifiedAt|modified_at)$/i.test(key)) {
            const timestamp = normalizedTimestamp(value);
            if (timestamp) timestamps.push(timestamp);
          } else {
            visit(value, seen);
          }
        }
      };
      visit(payload.entry?.value);
      timestamps.sort((left, right) => timestampMs(right) - timestampMs(left));
      return timestamps[0] || null;
    }
    return null;
  }

  function writeLocalUpdatedAt(storage, appKey, recordKey, updatedAt) {
    const timestamp = normalizedTimestamp(updatedAt);
    if (!timestamp) return;
    const key = `${LOCAL_UPDATED_PREFIX}${appKey}`;
    let parsed = {};
    try {
      const current = JSON.parse(storage.getItem(key) || '{}');
      if (current && typeof current === 'object' && !Array.isArray(current)) parsed = current;
    } catch (_) { /* replace malformed metadata with the new timestamp */ }
    parsed[recordKey] = timestamp;
    try { storage.setItem(key, JSON.stringify(parsed)); } catch (_) {}
  }

  function trackLocalStorageMutation(storage, key, updatedAt, originalSetItem) {
    if (suppressLocalTracking || !storage || RUNTIME_METADATA_KEY.test(String(key || ''))) return;
    const appKey = root.DTSyncCutover?.classifyLocalKey?.(key);
    if (!appKey || storage.getItem(`dt_sync_provider_${appKey}`) !== 'd1') return;
    const metadataKey = `${LOCAL_UPDATED_PREFIX}${appKey}`;
    let parsed = {};
    try {
      const current = JSON.parse(storage.getItem(metadataKey) || '{}');
      if (current && typeof current === 'object' && !Array.isArray(current)) parsed = current;
    } catch (_) {}
    parsed[`localStorage:${key}`] = normalizedTimestamp(updatedAt) || new Date().toISOString();
    try { originalSetItem.call(storage, metadataKey, JSON.stringify(parsed)); } catch (_) {}
  }

  function writeConflictState(storage, appKey, conflicts) {
    const key = `${CONFLICT_PREFIX}${appKey}`;
    if (!conflicts.length) {
      try { storage.removeItem(key); } catch (_) {}
      return;
    }
    try {
      storage.setItem(key, JSON.stringify({
        schema: 'dt-world-d1-conflict-state', version: 1, appKey,
        conflicts, updatedAt: new Date().toISOString()
      }));
    } catch (_) { /* local and D1 payloads are still left untouched */ }
  }

  function config(appKey, storage) {
    const provider = storage.getItem(`dt_sync_provider_${appKey}`);
    const baseUrl = storage.getItem('dt_sync_gateway_url') || '';
    const syncKey = storage.getItem('dt_sync_gateway_key') || '';
    if (provider !== 'd1' || !/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(baseUrl) || syncKey.length < 32) return null;
    return { baseUrl, syncKey, deviceId: storage.getItem('dt_sync_device_id') || 'browser' };
  }

  function enabledAppKeys(storage = root.localStorage) {
    if (!storage) return [];
    return LIVE_APP_KEYS.filter(appKey => config(appKey, storage));
  }

  function localEntries(storage, appKey) {
    if (root.DTSyncCutover?.collectLocalStorageEntries) return root.DTSyncCutover.collectLocalStorageEntries(storage, appKey);
    return [];
  }

  function wrapperForLocal(entry) {
    return {
      schema: 'dt-world-d1-record', version: 1, kind: 'localStorage',
      key: entry.recordKey.slice('localStorage:'.length), entry: entry.entry
    };
  }

  function wrapperForIndexedDB(entry) {
    return {
      schema: 'dt-world-d1-record', version: 1, kind: 'indexedDB',
      database: entry.database, store: entry.store, entry: entry.entry
    };
  }

  function preCutoverPayload(storage, appKey, recordKey) {
    try {
      const backup = JSON.parse(storage.getItem(`dt_d1_pre_cutover_backup_${appKey}`) || '');
      if (backup?.schema !== 'dt-world-d1-pre-cutover-backup' || backup.version !== 1) return null;
      if (recordKey.startsWith('localStorage:')) {
        const key = recordKey.slice('localStorage:'.length);
        const saved = (backup.local || []).find(item => item?.key === key && item.exists && typeof item.raw === 'string');
        if (!saved) return null;
        let encoding = 'text';
        try { JSON.parse(saved.raw); encoding = 'json'; } catch (_) {}
        return wrapperForLocal({ recordKey, entry: { encoding, raw: saved.raw } });
      }
      if (!recordKey.startsWith('indexedDB:')) return null;
      for (const saved of backup.indexed || []) {
        if (!saved?.exists || !saved.database?.name || !saved.store?.name || !saved.dump?.records) continue;
        const prefix = `indexedDB:${saved.database.name}/${saved.store.name}/`;
        const record = saved.dump.records.find(item => `${prefix}${stableStringify(item.key)}` === recordKey);
        if (record) {
          return wrapperForIndexedDB({
            database: saved.database,
            store: { name: saved.store.name, keyPath: saved.dump.keyPath ?? null },
            entry: record
          });
        }
      }
    } catch (_) { /* invalid or unavailable backup is not a baseline */ }
    return null;
  }

  function candidateEntryForRemote(record) {
    // D1 keeps deletions as tombstones.  Never turn one back into a live local
    // value; the record must be reviewed as a conflict instead.
    if (record?.deletedAt) return null;
    const payload = record?.payload;
    if (!record || typeof record.recordKey !== 'string' || !payload || payload.schema !== 'dt-world-d1-record' || payload.version !== 1) return null;
    if (payload.kind === 'localStorage' && typeof payload.key === 'string' && payload.entry && ['json', 'text'].includes(payload.entry.encoding) && typeof payload.entry.raw === 'string') {
      return { recordKey: record.recordKey, kind: 'localStorage', entry: { encoding: payload.entry.encoding, raw: payload.entry.raw } };
    }
    if (payload.kind === 'indexedDB' && payload.database?.name && payload.store?.name && payload.entry && Object.prototype.hasOwnProperty.call(payload.entry, 'key')) {
      return {
        recordKey: record.recordKey, kind: 'indexedDB',
        database: payload.database, store: payload.store,
        entry: { key: payload.entry.key, value: payload.entry.value }
      };
    }
    return null;
  }

  async function collectCurrent(storage, appKey) {
    const current = new Map(localEntries(storage, appKey).map(entry => ({
      recordKey: entry.recordKey, entry, payload: wrapperForLocal(entry)
    })).map(value => [value.recordKey, value]));
    if (root.DTSyncCutover?.collectIndexedDBEntries) {
      const indexed = await root.DTSyncCutover.collectIndexedDBEntries(root.indexedDB, appKey);
      for (const entry of indexed) current.set(entry.recordKey, { recordKey: entry.recordKey, entry, payload: wrapperForIndexedDB(entry) });
    }
    return current;
  }

  async function syncApp(appKey, storage = root.localStorage) {
    const settings = config(appKey, storage);
    if (!settings || !root.DTSyncGatewayClient?.createLive) return { ok: false, reason: 'not_enabled' };
    const client = root.DTSyncGatewayClient.createLive({ baseUrl: settings.baseUrl, syncKey: settings.syncKey, timeoutMs: 7000, retries: 1 });
    const remoteResult = await client.getSnapshot(appKey);
    if (!remoteResult.ok) return remoteResult;

    const remote = new Map((remoteResult.data.records || []).map(record => [record.recordKey, record]));
    const current = await collectCurrent(storage, appKey);
    const previous = readSyncState(storage, appKey);
    const recordKeys = new Set([...remote.keys(), ...current.keys(), ...Object.keys(previous.records || {})]);
    const pullEntries = [];
    const pullUpdatedAt = new Map();
    const pushChanges = [];
    const conflicts = [];
    const nextRecords = { ...(previous.records || {}) };

    for (const recordKey of recordKeys) {
      const local = current.get(recordKey);
      const remoteRecord = remote.get(recordKey);
      const localDescriptor = local ? {
        hash: await sha256(local.payload),
        updatedAt: readLocalUpdatedAt(storage, appKey, recordKey, local.payload)
      } : null;
      const remoteDescriptor = remoteRecord ? {
        hash: remoteRecord.payloadHash || await sha256(remoteRecord.payload),
        revision: remoteRecord.revision,
        updatedAt: normalizedTimestamp(remoteRecord.updatedAt),
        resolutionAt: normalizedTimestamp(remoteRecord.resolutionAt),
        resolutionSource: remoteRecord.resolutionSource || null
      } : null;
      let previousRecord = previous.records?.[recordKey] || null;
      if (!previousRecord) {
        const cutoverPayload = preCutoverPayload(storage, appKey, recordKey);
        if (cutoverPayload && localDescriptor && localDescriptor.hash === await sha256(cutoverPayload)) {
          // The cutover backup proves this device has not changed this record
          // since migration. D1 may therefore be pulled without guessing.
          previousRecord = { localHash: localDescriptor.hash, remoteHash: localDescriptor.hash };
        }
      }
      const decision = explicitResolutionDecision({ local: localDescriptor, remote: remoteDescriptor, previous: previousRecord })
        || classifyRecord({ local: localDescriptor, remote: remoteDescriptor, previous: previousRecord });

      if (decision.action === 'conflict') {
        conflicts.push({ recordKey, reason: decision.reason });
        continue;
      }
      if (decision.action === 'pull') {
        const entry = candidateEntryForRemote(remoteRecord);
        if (!entry) {
          conflicts.push({ recordKey, reason: 'invalid_remote_record' });
          continue;
        }
        pullEntries.push(entry);
        if (remoteDescriptor.updatedAt) pullUpdatedAt.set(recordKey, remoteDescriptor.updatedAt);
        nextRecords[recordKey] = {
          localHash: remoteDescriptor.hash,
          remoteHash: remoteDescriptor.hash,
          remoteRevision: remoteDescriptor.revision
        };
        continue;
      }
      if (decision.action === 'push') {
        if (!local) {
          conflicts.push({ recordKey, reason: 'local_record_missing' });
          continue;
        }
        const updatedAt = localDescriptor.updatedAt || new Date().toISOString();
        pushChanges.push({
          recordKey, payload: local.payload, updatedAt,
          expectedRevision: decision.expectedRevision,
          // The D1 schema intentionally accepts only the source categories
          // used by the migration envelope. The device id is already carried
          // separately in the request and must not be put in this field.
          source: 'unknown'
        });
        continue;
      }
      if (local && remoteRecord && localDescriptor && remoteDescriptor) {
        nextRecords[recordKey] = {
          localHash: localDescriptor.hash,
          remoteHash: remoteDescriptor.hash,
          remoteRevision: remoteDescriptor.revision
        };
      }
    }

    const applyRemoteEntries = async (entries) => {
      if (!entries.length) return true;
      try {
        suppressLocalTracking = true;
        await root.DTSyncCutover.applyCandidateApp(
          { status: 'ready', entries },
          { appKey, storage, indexedDB: root.indexedDB }
        );
        return true;
      } catch (_) {
        return false;
      } finally {
        suppressLocalTracking = false;
      }
    };

    if (!await applyRemoteEntries(pullEntries)) {
      return { ok: false, reason: 'apply_failed' };
    }
    for (const [recordKey, updatedAt] of pullUpdatedAt) writeLocalUpdatedAt(storage, appKey, recordKey, updatedAt);

    const pushResults = [];
    for (let offset = 0; offset < pushChanges.length; offset += 100) {
      const result = await client.pushChanges(appKey, pushChanges.slice(offset, offset + 100), {
        deviceId: settings.deviceId, clientVersion: 'dt-d1-runtime-v2'
      });
      if (!result.ok) return result;
      pushResults.push(result.data || {});
    }

    const pushResultByKey = new Map();
    for (const batch of pushResults) {
      for (const result of Array.isArray(batch.results) ? batch.results : []) pushResultByKey.set(result.recordKey, result);
    }
    const stalePullEntries = [];
    const stalePullUpdatedAt = new Map();
    let pushedCount = 0;
    for (const change of pushChanges) {
      const result = pushResultByKey.get(change.recordKey);
      if (!result || result.status === 'conflict') {
        conflicts.push({ recordKey: change.recordKey, reason: 'remote_revision_conflict' });
        continue;
      }
      if (result.status === 'stale') {
        const entry = candidateEntryForRemote({
          recordKey: result.recordKey || change.recordKey,
          payload: result.payload,
          payloadHash: result.payloadHash,
          revision: result.revision,
          updatedAt: result.updatedAt,
          deletedAt: result.deletedAt
        });
        if (!entry) {
          conflicts.push({ recordKey: change.recordKey, reason: 'stale_remote_record_invalid' });
          continue;
        }
        const currentNow = await collectCurrent(storage, appKey);
        const currentEntry = currentNow.get(change.recordKey);
        if (!currentEntry || await sha256(currentEntry.payload) !== await sha256(change.payload)) {
          conflicts.push({ recordKey: change.recordKey, reason: 'local_changed_during_sync' });
          continue;
        }
        stalePullEntries.push(entry);
        if (result.updatedAt) stalePullUpdatedAt.set(change.recordKey, normalizedTimestamp(result.updatedAt));
        nextRecords[change.recordKey] = {
          localHash: result.payloadHash || await sha256(result.payload),
          remoteHash: result.payloadHash || await sha256(result.payload),
          remoteRevision: result.revision
        };
        continue;
      }
      const revision = Number.isInteger(result.revision)
        ? result.revision
        : (Number.isInteger(change.expectedRevision) ? change.expectedRevision + 1 : 1);
      const hash = await sha256(change.payload);
      nextRecords[change.recordKey] = { localHash: hash, remoteHash: hash, remoteRevision: revision };
      pushedCount += 1;
    }

    if (!await applyRemoteEntries(stalePullEntries)) {
      return { ok: false, reason: 'apply_failed' };
    }
    for (const [recordKey, updatedAt] of stalePullUpdatedAt) writeLocalUpdatedAt(storage, appKey, recordKey, updatedAt);

    writeSyncState(storage, appKey, nextRecords);
    writeConflictState(storage, appKey, conflicts);
    const pulledCount = pullEntries.length + stalePullEntries.length;
    const changed = pulledCount + pushedCount;
    if (conflicts.length) return { ok: true, status: 'conflict', changed, pulled: pulledCount, pushed: pushedCount, conflicts };
    if (pulledCount && pushedCount) return { ok: true, status: 'synced', changed, pulled: pulledCount, pushed: pushedCount };
    if (pulledCount) return { ok: true, status: 'pulled', changed: pulledCount, pulled: pulledCount, pushed: 0 };
    if (pushedCount) return { ok: true, status: 'pushed', changed: pushedCount, pulled: 0, pushed: pushedCount };
    return { ok: true, status: 'unchanged', changed: 0, pulled: 0, pushed: 0 };
  }

  function readConflictState(storage, appKey) {
    try {
      const parsed = JSON.parse(storage.getItem(`${CONFLICT_PREFIX}${appKey}`) || '');
      if (parsed?.version === 1 && Array.isArray(parsed.conflicts)) return parsed;
    } catch (_) { /* invalid metadata is treated as no pending conflict list */ }
    return { version: 1, appKey, conflicts: [] };
  }

  async function resolveConflicts(appKey, source, storage = root.localStorage) {
    const settings = config(appKey, storage);
    if (!settings || !root.DTSyncGatewayClient?.createLive) return { ok: false, reason: 'not_enabled' };
    if (!['pc', 'smartphone'].includes(source)) return { ok: false, reason: 'invalid_resolution_source' };
    const pending = readConflictState(storage, appKey).conflicts;
    if (!pending.length) return { ok: true, status: 'unchanged', changed: 0, conflicts: [] };

    const client = root.DTSyncGatewayClient.createLive({ baseUrl: settings.baseUrl, syncKey: settings.syncKey, timeoutMs: 7000, retries: 1 });
    const remoteResult = await client.getSnapshot(appKey);
    if (!remoteResult.ok) return remoteResult;
    const remote = new Map((remoteResult.data.records || []).map(record => [record.recordKey, record]));
    const current = await collectCurrent(storage, appKey);
    const records = [];
    const unresolved = [];
    const sourceSnapshotKeys = [];
    for (const conflict of pending) {
      const local = current.get(conflict.recordKey);
      const remoteRecord = remote.get(conflict.recordKey);
      if (!remoteRecord || remoteRecord.deletedAt || !Number.isInteger(remoteRecord.revision)) {
        unresolved.push(conflict);
        continue;
      }
      // Report Card is an IndexedDB application.  The Sync Settings page may
      // not be able to read the exact PWA database (especially on mobile), so
      // explicit PC/smartphone resolution must use the immutable migration
      // snapshot selected by the user instead of accidentally resolving with
      // a partial database dump from the current browser.
      if (appKey === 'report_card') {
        sourceSnapshotKeys.push(conflict.recordKey);
        continue;
      }
      if (!local) {
        sourceSnapshotKeys.push(conflict.recordKey);
        continue;
      }
      records.push({ recordKey: conflict.recordKey, payload: local.payload, expectedRevision: remoteRecord.revision });
    }
    if (!records.length && !sourceSnapshotKeys.length) return { ok: true, status: 'conflict', changed: 0, conflicts: pending };

    const responseByKey = new Map();
    if (records.length) {
      const resolution = await client.resolveRecords(appKey, records, { source });
      if (!resolution.ok) return resolution;
      for (const result of resolution.data?.results || []) responseByKey.set(result.recordKey, result);
    }
    if (sourceSnapshotKeys.length) {
      if (typeof client.resolveFromSourceSnapshot !== 'function') {
        unresolved.push(...sourceSnapshotKeys.map(recordKey => ({ recordKey, reason: 'local_record_missing' })));
      } else {
        const sourceResolution = await client.resolveFromSourceSnapshot(appKey, source, sourceSnapshotKeys);
        if (!sourceResolution.ok) return sourceResolution;
        for (const result of sourceResolution.data?.results || []) responseByKey.set(result.recordKey, result);
      }
    }
    const resolvedKeys = new Set();
    for (const record of records) {
      if (responseByKey.get(record.recordKey)?.status === 'resolved') resolvedKeys.add(record.recordKey);
      else unresolved.push(pending.find(conflict => conflict.recordKey === record.recordKey) || { recordKey: record.recordKey, reason: 'resolution_conflict' });
    }
    for (const recordKey of sourceSnapshotKeys) {
      if (responseByKey.get(recordKey)?.status === 'resolved') {
        resolvedKeys.add(recordKey);
      } else {
        const response = responseByKey.get(recordKey);
        const reason = response?.status === 'unavailable' ? 'source_snapshot_unavailable' : 'resolution_conflict';
        unresolved.push(pending.find(conflict => conflict.recordKey === recordKey) || { recordKey, reason });
      }
    }

    if (resolvedKeys.size) {
      const after = await collectCurrent(storage, appKey);
      for (const record of records) {
        if (!resolvedKeys.has(record.recordKey)) continue;
        const currentAfter = after.get(record.recordKey);
        if (!currentAfter || await sha256(currentAfter.payload) !== await sha256(record.payload)) {
          unresolved.push({ recordKey: record.recordKey, reason: 'local_changed_during_resolution' });
          resolvedKeys.delete(record.recordKey);
        }
      }
    }

    const previous = readSyncState(storage, appKey);
    const nextRecords = { ...(previous.records || {}) };
    for (const record of records) {
      if (!resolvedKeys.has(record.recordKey)) continue;
      const result = responseByKey.get(record.recordKey);
      const hash = await sha256(record.payload);
      nextRecords[record.recordKey] = {
        localHash: hash,
        remoteHash: result.payloadHash || hash,
        remoteRevision: result.revision
      };
    }
    for (const recordKey of sourceSnapshotKeys) {
      if (!resolvedKeys.has(recordKey)) continue;
      const result = responseByKey.get(recordKey);
      if (!result?.payloadHash || !Number.isInteger(result.revision)) continue;
      nextRecords[recordKey] = {
        localHash: null,
        remoteHash: result.payloadHash,
        remoteRevision: result.revision
      };
    }
    writeSyncState(storage, appKey, nextRecords);
    writeConflictState(storage, appKey, unresolved);
    const changed = resolvedKeys.size;
    if (unresolved.length) return { ok: true, status: 'conflict', changed, conflicts: unresolved };
    return { ok: true, status: 'resolved', changed, conflicts: [] };
  }

  async function syncEnabledApps(storage = root.localStorage) {
    const results = [];
    for (const appKey of enabledAppKeys(storage)) {
      let result;
      try {
        result = await syncApp(appKey, storage);
      } catch (_) {
        result = { ok: false, reason: 'network' };
      }
      results.push({ appKey, ...result });
      dispatchStatus(appKey, result);
      schedulePageReloadAfterPull(appKey, result);
    }
    return results;
  }

  function shouldBlockLegacyJsonBin(requestUrl, appKey, storage = root.localStorage) {
    return /^https:\/\/api\.jsonbin\.(?:io|org)\//i.test(String(requestUrl || ''))
      && storage?.getItem(`dt_sync_provider_${appKey}`) === 'd1';
  }

  function shouldScheduleStorageKey(key) {
    return !RUNTIME_METADATA_KEY.test(String(key || ''));
  }

  function installLegacyJsonBinGuard(appKey) {
    if (typeof root.fetch !== 'function' || root.fetch.__dtD1LegacyJsonBinGuard) return;
    const originalFetch = root.fetch.bind(root);
    const guardedFetch = function (input, options) {
      const requestUrl = typeof input === 'string' ? input : input?.url || '';
      if (shouldBlockLegacyJsonBin(requestUrl, appKey)) {
        return Promise.reject(new Error('d1_provider_active'));
      }
      return originalFetch(input, options);
    };
    Object.defineProperty(guardedFetch, '__dtD1LegacyJsonBinGuard', { value: true });
    try { root.fetch = guardedFetch; } catch (_) { /* browsers with a read-only fetch keep the runtime safe */ }
  }

  function dispatchStatus(appKey, result) {
    if (typeof root.dispatchEvent !== 'function' || typeof root.CustomEvent !== 'function') return;
    root.dispatchEvent(new root.CustomEvent('dt-d1-sync-status', { detail: { appKey, ...result } }));
  }

  function shouldReloadAfterPull(appKey, result, pathname = root.location?.pathname) {
    const pulled = Number(result?.pulled);
    return result?.ok === true
      && Number.isFinite(pulled)
      && pulled > 0
      && appKeyFromPath(pathname) === appKey;
  }

  let pageReloadScheduled = false;
  function schedulePageReloadAfterPull(appKey, result) {
    if (pageReloadScheduled || !shouldReloadAfterPull(appKey, result)) return;
    if (typeof root.setTimeout !== 'function' || typeof root.location?.reload !== 'function') return;
    pageReloadScheduled = true;
    root.setTimeout(() => {
      try { root.location.reload(); } catch (_) { pageReloadScheduled = false; }
    }, 0);
  }

  function start() {
    const appKey = appKeyFromPath(root.location?.pathname);
    if (!root.localStorage) return;
    if (appKey && appKey !== 'focus_lab') installLegacyJsonBinGuard(appKey);
    let timer = null;
    let running = false;
    const schedule = () => {
      if (timer) root.clearTimeout(timer);
      timer = root.setTimeout(run, 1200);
    };
    async function run() {
      if (running || !enabledAppKeys(root.localStorage).length) return [];
      running = true;
      try {
        return await syncEnabledApps(root.localStorage);
      } catch (_) {
        // A single tool must not prevent the remaining tools from syncing.
        return [];
      } finally {
        running = false;
      }
    }
    const storagePrototype = root.Storage?.prototype;
    if (storagePrototype && !storagePrototype.__dtD1RuntimePatched) {
      const originalSetItem = storagePrototype.setItem;
      storagePrototype.setItem = function (key, value) {
        const result = originalSetItem.call(this, key, value);
        if (this === root.localStorage) {
          trackLocalStorageMutation(this, key, new Date().toISOString(), originalSetItem);
          if (shouldScheduleStorageKey(key)) schedule();
        }
        return result;
      };
      Object.defineProperty(storagePrototype, '__dtD1RuntimePatched', { value: true });
    }
    root.setTimeout(run, 2500);
    root.setInterval(run, 60000);
    root.document?.addEventListener?.('visibilitychange', () => {
      if (root.document.visibilityState === 'visible') run();
    });
    root.DTD1Runtime = {
      appKey,
      syncNow: run,
      syncAll: run,
      syncApp: key => syncApp(key, root.localStorage),
      resolveConflicts: (key, source) => resolveConflicts(key, source, root.localStorage),
      pendingConflicts: key => readConflictState(root.localStorage, key).conflicts,
      enabledAppKeys: () => enabledAppKeys(root.localStorage),
      isEnabled: key => root.localStorage?.getItem(`dt_sync_provider_${key}`) === 'd1'
    };
  }

  root.DTSyncRuntimeCore = { stableStringify, classifyRecord, explicitResolutionDecision, enabledAppKeys, shouldBlockLegacyJsonBin, shouldScheduleStorageKey, shouldReloadAfterPull };
  root.DTD1Runtime = root.DTD1Runtime || { appKeyFromPath, syncApp, syncEnabledApps, classifyRecord, resolveConflicts, pendingConflicts: (key, storage = root.localStorage) => readConflictState(storage, key).conflicts, enabledAppKeys };
  const initialAppKey = appKeyFromPath(root.location?.pathname);
  if (initialAppKey && initialAppKey !== 'focus_lab' && root.localStorage) installLegacyJsonBinGuard(initialAppKey);
  if (typeof root.addEventListener === 'function') {
    if (root.document?.readyState === 'loading') root.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})(typeof window !== 'undefined' ? window : globalThis);

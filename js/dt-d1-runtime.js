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
  const FORCE_PULL_PREFIX = 'dt_d1_force_pull_';
  const RUNTIME_STARTED_KEY = '__dtD1RuntimeStarted';
  const RUNTIME_METADATA_KEY = /^(?:dt_d1_(?:sync_state|sync_conflict|pre_cutover_backup|local_updated|force_pull)_|dt_sync_provider_|dt_sync_gateway_(?:url|key)$|dt_sync_device_id$)/i;
  const LIFECYCLE_SYNC_EVENTS = new Set(['pageshow', 'focus', 'visibilitychange']);
  let suppressLocalTracking = false;
  const patchedStorageInstances = new WeakSet();
  const patchedStoragePrototypes = new WeakSet();

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

  function readForcePullState(storage, appKey) {
    try {
      const parsed = JSON.parse(storage.getItem(`${FORCE_PULL_PREFIX}${appKey}`) || '');
      if (parsed?.version === 1 && parsed.records && typeof parsed.records === 'object') return parsed;
    } catch (_) { /* invalid metadata is treated as no forced pull */ }
    return { version: 1, appKey, records: {} };
  }

  function writeForcePullState(storage, appKey, records) {
    const key = `${FORCE_PULL_PREFIX}${appKey}`;
    const validRecords = Object.fromEntries(Object.entries(records || {}).filter(([, revision]) => Number.isInteger(revision)));
    try {
      if (!Object.keys(validRecords).length) {
        storage.removeItem(key);
        return;
      }
      storage.setItem(key, JSON.stringify({
        schema: 'dt-world-d1-force-pull', version: 1, appKey, records: validRecords,
        updatedAt: new Date().toISOString()
      }));
    } catch (_) { /* a forced pull is retried on the next run */ }
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

  // Normal tool pages run only their own app. Sync Settings is the explicit
  // all-tools entry point and invokes the same runtime without an app key.
  function automaticAppKeys(appKey, storage = root.localStorage) {
    if (!appKey) return [];
    return config(appKey, storage) ? [appKey] : [];
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

  function preCutoverRecordWasAbsent(storage, appKey, recordKey) {
    try {
      const backup = JSON.parse(storage.getItem(`dt_d1_pre_cutover_backup_${appKey}`) || '');
      if (backup?.schema !== 'dt-world-d1-pre-cutover-backup' || backup.version !== 1) return false;
      if (recordKey.startsWith('localStorage:')) {
        const key = recordKey.slice('localStorage:'.length);
        const saved = (backup.local || []).find(item => item?.key === key);
        return Boolean(saved && saved.exists === false);
      }
      if (!recordKey.startsWith('indexedDB:')) return false;
      for (const saved of backup.indexed || []) {
        if (saved?.exists !== false || !saved.database?.name || !saved.store?.name) continue;
        const prefix = `indexedDB:${saved.database.name}/${saved.store.name}/`;
        if (recordKey.startsWith(prefix)) return true;
      }
    } catch (_) { /* invalid or unavailable backup is not a cutover marker */ }
    return false;
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
    const forcePull = readForcePullState(storage, appKey);
    const remainingForcePull = { ...(forcePull.records || {}) };
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
        if (cutoverPayload) {
          const cutoverHash = await sha256(cutoverPayload);
          if (localDescriptor?.hash === cutoverHash) {
            // The cutover backup proves this device has not changed this
            // record since migration. D1 may therefore be pulled safely.
            previousRecord = { localHash: cutoverHash, remoteHash: cutoverHash };
          } else if (remoteDescriptor?.hash) {
            // A different local value was written after migration. Treat the
            // promoted D1 value as the baseline so this device's edit can be
            // pushed instead of being mistaken for an unresolved first sync.
            previousRecord = { localHash: remoteDescriptor.hash, remoteHash: remoteDescriptor.hash, remoteRevision: remoteDescriptor.revision };
          }
        } else if (localDescriptor && remoteDescriptor?.hash && preCutoverRecordWasAbsent(storage, appKey, recordKey)) {
          // The safe cutover backup records missing local records explicitly.
          // If this device was empty at cutover, then a now-present local
          // record came from the promoted candidate. Use that D1 value as the
          // baseline so an edit made afterwards can be pushed even when the
          // tool has no embedded updatedAt field.
          previousRecord = {
            localHash: remoteDescriptor.hash,
            remoteHash: remoteDescriptor.hash,
            remoteRevision: remoteDescriptor.revision
          };
        }
      }
      const resolvedDecision = explicitResolutionDecision({ local: localDescriptor, remote: remoteDescriptor, previous: previousRecord });
      if (!resolvedDecision && localDescriptor && previousRecord && localDescriptor.updatedAt === null
        && localDescriptor.hash !== (previousRecord.localHash ?? null)) {
        // Some PWAs do not expose an application timestamp. A hash change
        // after the last baseline is still a definite local edit; stamp it at
        // observation time so a simultaneous remote edit can be resolved by
        // the requested latest-wins rule.
        localDescriptor.updatedAt = new Date().toISOString();
        writeLocalUpdatedAt(storage, appKey, recordKey, localDescriptor.updatedAt);
      }
      const forcedRevision = remainingForcePull[recordKey];
      const decision = Number.isInteger(forcedRevision)
        && remoteRecord
        && Number.isInteger(remoteRecord.revision)
        && remoteRecord.revision >= forcedRevision
        ? { action: 'pull', reason: 'forced_resolution' }
        : resolvedDecision
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
        delete remainingForcePull[recordKey];
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
    writeForcePullState(storage, appKey, remainingForcePull);
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
    const unresolved = [];
    const sourceSnapshotKeys = [];
    for (const conflict of pending) {
      const remoteRecord = remote.get(conflict.recordKey);
      if (!remoteRecord || remoteRecord.deletedAt || !Number.isInteger(remoteRecord.revision)) {
        unresolved.push(conflict);
        continue;
      }
      // The Sync Settings page cannot safely read the other device's current
      // storage.  Always resolve from the immutable PC/smartphone migration
      // snapshot so selecting "PC" really means PC on either device.  This
      // also prevents a phone-side local value from silently winning when the
      // user explicitly chose the PC source.
      sourceSnapshotKeys.push(conflict.recordKey);
    }
    if (!sourceSnapshotKeys.length) return { ok: true, status: 'conflict', changed: 0, conflicts: pending };

    const responseByKey = new Map();
    if (typeof client.resolveFromSourceSnapshot !== 'function') {
      unresolved.push(...sourceSnapshotKeys.map(recordKey => ({ recordKey, reason: 'source_snapshot_unavailable' })));
    } else {
      const sourceResolution = await client.resolveFromSourceSnapshot(appKey, source, sourceSnapshotKeys);
      if (!sourceResolution.ok) return sourceResolution;
      for (const result of sourceResolution.data?.results || []) responseByKey.set(result.recordKey, result);
    }
    const resolvedKeys = new Set();
    for (const recordKey of sourceSnapshotKeys) {
      if (responseByKey.get(recordKey)?.status === 'resolved') {
        resolvedKeys.add(recordKey);
      } else {
        const response = responseByKey.get(recordKey);
        const reason = response?.status === 'unavailable'
          ? (response.reason === 'source_snapshot_missing' ? 'source_snapshot_missing' : 'source_snapshot_unavailable')
          : 'resolution_conflict';
        unresolved.push(pending.find(conflict => conflict.recordKey === recordKey) || { recordKey, reason });
      }
    }

    const previous = readSyncState(storage, appKey);
    const nextRecords = { ...(previous.records || {}) };
    const forcePull = readForcePullState(storage, appKey);
    const nextForcePull = { ...(forcePull.records || {}) };
    for (const recordKey of sourceSnapshotKeys) {
      if (!resolvedKeys.has(recordKey)) continue;
      const result = responseByKey.get(recordKey);
      if (!result?.payloadHash || !Number.isInteger(result.revision)) continue;
      nextRecords[recordKey] = {
        localHash: null,
        remoteHash: result.payloadHash,
        remoteRevision: result.revision
      };
      nextForcePull[recordKey] = result.revision;
    }
    writeSyncState(storage, appKey, nextRecords);
    writeForcePullState(storage, appKey, nextForcePull);
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
        result = await syncAppNow(appKey, storage);
      } catch (error) {
        result = normalizeRuntimeError(error);
      }
      results.push({ appKey, ...result });
    }
    return results;
  }

  function shouldBlockLegacyJsonBin(requestUrl, appKey, storage = root.localStorage) {
    return /^https:\/\/api\.jsonbin\.(?:io|org)\//i.test(String(requestUrl || ''))
      && isLegacySyncDisabled(appKey, storage);
  }

  function isLegacySyncDisabled(appKey, storage = root.localStorage) {
    // The provider switch is the cutover boundary. A half-configured D1 tool
    // must remain local rather than silently falling back to a legacy cloud
    // write that was not reviewed during migration.
    return Boolean(appKey) && storage?.getItem(`dt_sync_provider_${appKey}`) === 'd1';
  }

  function legacyLocalRecord(appKey, storage) {
    try {
      const entries = root.DTSyncCutover?.collectLocalStorageEntries?.(storage, appKey) || [];
      for (const entry of entries) {
        if (entry?.entry?.encoding !== 'json' || typeof entry.entry.raw !== 'string') continue;
        const value = JSON.parse(entry.entry.raw);
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
      }
    } catch (_) { /* the compatibility response must remain harmless */ }
    return {};
  }

  function legacyJsonBinResponse(appKey, storage, options = {}) {
    const method = String(options?.method || 'GET').toUpperCase();
    const localRecord = legacyLocalRecord(appKey, storage);
    const binIdKey = root.PWAConfigSync?.APP_KEYS_MAP?.[appKey];
    const binId = binIdKey ? storage?.getItem(binIdKey) || '' : '';
    const body = method === 'POST'
      ? { metadata: { id: binId }, record: localRecord }
      : { record: localRecord };
    const serialized = JSON.stringify(body);
    return {
      ok: true,
      status: 200,
      headers: { get: name => String(name).toLowerCase() === 'content-type' ? 'application/json' : null },
      json: async () => JSON.parse(serialized),
      text: async () => serialized
    };
  }

  function shouldScheduleStorageKey(key) {
    return !RUNTIME_METADATA_KEY.test(String(key || ''));
  }

  function shouldSyncOnLifecycle(eventName, visibilityState = 'visible') {
    return LIFECYCLE_SYNC_EVENTS.has(String(eventName || ''))
      && String(visibilityState || 'visible') !== 'hidden';
  }

  function installLegacyJsonBinGuard(appKey) {
    if (typeof root.fetch !== 'function' || root.fetch.__dtD1LegacyJsonBinGuard) return;
    const originalFetch = root.fetch.bind(root);
    const guardedFetch = function (input, options) {
      const requestUrl = typeof input === 'string' ? input : input?.url || '';
      if (shouldBlockLegacyJsonBin(requestUrl, appKey)) {
        // Legacy tools still contain JSONBin code. Return a local-only,
        // successful compatibility response so their old error badges do not
        // mask D1. The actual cross-device operation is syncAppNow.
        return Promise.resolve(legacyJsonBinResponse(appKey, root.localStorage, options));
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

  function normalizeRuntimeError(error) {
    const candidate = typeof error?.reason === 'string' ? error.reason
      : typeof error?.code === 'string' ? error.code
        : typeof error?.message === 'string' ? error.message : '';
    const reason = /^[a-z][a-z0-9_-]{1,63}$/.test(candidate) ? candidate : 'runtime_error';
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : null;
    return { ok: false, reason, statusCode };
  }

  const appRunLocks = new Map();
  async function syncAppNow(appKey, storage = root.localStorage) {
    if (appRunLocks.has(appKey)) return appRunLocks.get(appKey);
    const task = (async () => {
      dispatchStatus(appKey, { ok: true, status: 'syncing', changed: 0, pulled: 0, pushed: 0 });
      let result;
      try {
        result = await syncApp(appKey, storage);
      } catch (error) {
        result = normalizeRuntimeError(error);
      }
      dispatchStatus(appKey, result);
      schedulePageReloadAfterPull(appKey, result);
      return result;
    })();
    appRunLocks.set(appKey, task);
    try { return await task; } finally { appRunLocks.delete(appKey); }
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

  function installIndexedDBMutationTracking(schedule) {
    const prototype = root.IDBObjectStore?.prototype;
    if (!prototype || prototype.__dtD1MutationTracked) return;
    for (const method of ['add', 'put', 'delete', 'clear']) {
      if (typeof prototype[method] !== 'function') continue;
      const original = prototype[method];
      const wrapped = function (...args) {
        const request = original.apply(this, args);
        if (!suppressLocalTracking) schedule();
        return request;
      };
      try { prototype[method] = wrapped; } catch (_) { /* a locked prototype is still safe */ }
    }
    try { Object.defineProperty(prototype, '__dtD1MutationTracked', { value: true }); } catch (_) {}
  }

  function storagePrototypeFor(storage = root.localStorage) {
    // A standalone PWA/WebView can expose its Storage object from a different
    // realm, where window.Storage.prototype is not the prototype actually used
    // by localStorage. Prefer the instance prototype and fall back to the
    // window constructor for ordinary browsers and test doubles.
    try {
      const instancePrototype = storage && Object.getPrototypeOf(storage);
      if (instancePrototype && typeof instancePrototype.setItem === 'function') return instancePrototype;
    } catch (_) { /* fall through to the window constructor */ }
    const constructorPrototype = root.Storage?.prototype;
    return constructorPrototype && typeof constructorPrototype.setItem === 'function'
      ? constructorPrototype
      : null;
  }

  function installStorageMutationTracking(storage, schedule) {
    if (!storage || typeof storage.setItem !== 'function') return false;
    if (patchedStorageInstances.has(storage)) return true;

    const originalInstanceSetItem = storage.setItem;
    const wrapSetItem = (originalSetItem) => function (key, value) {
      const result = originalSetItem.call(this, key, value);
      if (this === storage) {
        trackLocalStorageMutation(this, key, new Date().toISOString(), originalSetItem);
        if (shouldScheduleStorageKey(key)) schedule();
      }
      return result;
    };

    // Installed PWAs/WebViews can expose a Storage instance whose prototype
    // is from a separate realm, or whose prototype is not writable. Prefer an
    // instance-local wrapper so one locked prototype cannot abort runtime
    // startup for the entire tool.
    try {
      Object.defineProperty(storage, 'setItem', {
        configurable: true,
        enumerable: false,
        writable: true,
        value: wrapSetItem(originalInstanceSetItem)
      });
      patchedStorageInstances.add(storage);
      return true;
    } catch (_) { /* use the prototype fallback below */ }

    const prototype = storagePrototypeFor(storage);
    if (!prototype || patchedStoragePrototypes.has(prototype) || typeof prototype.setItem !== 'function') return false;
    const originalPrototypeSetItem = prototype.setItem;
    const wrapped = wrapSetItem(originalPrototypeSetItem);
    try {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'setItem');
      if (descriptor && descriptor.configurable === false && descriptor.writable === false) return false;
      Object.defineProperty(prototype, 'setItem', {
        ...(descriptor || {}),
        configurable: descriptor?.configurable ?? true,
        writable: true,
        value: wrapped
      });
      patchedStoragePrototypes.add(prototype);
      return true;
    } catch (_) {
      try {
        prototype.setItem = wrapped;
        patchedStoragePrototypes.add(prototype);
        return true;
      } catch (_) {
        return false;
      }
    }
  }

  function start() {
    const appKey = appKeyFromPath(root.location?.pathname);
    if (!root.localStorage) return;
    if (root[RUNTIME_STARTED_KEY]) return root.DTD1Runtime;
    root[RUNTIME_STARTED_KEY] = true;
    if (appKey && appKey !== 'focus_lab') installLegacyJsonBinGuard(appKey);
    let timer = null;
    let running = false;
    const schedule = () => {
      if (timer || typeof root.setTimeout !== 'function') return;
      timer = root.setTimeout(run, 1200);
    };
    async function run() {
      timer = null;
      const keys = appKey
        ? automaticAppKeys(appKey, root.localStorage)
        : enabledAppKeys(root.localStorage);
      if (running || !keys.length) return [];
      running = true;
      try {
        const results = [];
        for (const key of keys) {
          let result;
          try {
            result = await syncAppNow(key, root.localStorage);
          } catch (error) {
            result = normalizeRuntimeError(error);
          }
          results.push({ appKey: key, ...result });
        }
        return results;
      } catch (error) {
        // A single tool must not prevent the remaining tools from syncing.
        // Keep the actual safe error code so the UI can tell a storage failure
        // from a network or Access failure.
        return [{ appKey: appKey || 'unknown', ...normalizeRuntimeError(error) }];
      } finally {
        running = false;
      }
    }
    installStorageMutationTracking(root.localStorage, schedule);
    installIndexedDBMutationTracking(schedule);
    root.setTimeout(run, 2500);
    // A normal tool page keeps its one app fresh while it is open. Sync
    // Settings is an explicit control surface, so it must not generate a
    // 23-tool request burst every few seconds in the background.
    if (appKey && typeof root.setInterval === 'function') root.setInterval(run, 15000);
    const lifecycleSync = (event) => {
      const visibilityState = root.document?.visibilityState || 'visible';
      if (shouldSyncOnLifecycle(event?.type, visibilityState)) schedule();
    };
    root.document?.addEventListener?.('visibilitychange', lifecycleSync);
    root.addEventListener?.('pageshow', lifecycleSync);
    root.addEventListener?.('focus', lifecycleSync);
    root.DTD1Runtime = {
      appKey,
      syncNow: run,
      syncAll: run,
      syncApp: key => syncApp(key, root.localStorage),
      syncAppNow: key => syncAppNow(key, root.localStorage),
      resolveConflicts: (key, source) => resolveConflicts(key, source, root.localStorage),
      pendingConflicts: key => readConflictState(root.localStorage, key).conflicts,
      enabledAppKeys: () => enabledAppKeys(root.localStorage),
      isLegacySyncDisabled: key => isLegacySyncDisabled(key, root.localStorage),
      isEnabled: key => root.localStorage?.getItem(`dt_sync_provider_${key}`) === 'd1'
    };
  }

  root.DTSyncRuntimeCore = { appKeyFromPath, stableStringify, classifyRecord, explicitResolutionDecision, normalizeRuntimeError, enabledAppKeys, automaticAppKeys, isLegacySyncDisabled, shouldBlockLegacyJsonBin, shouldScheduleStorageKey, shouldSyncOnLifecycle, shouldReloadAfterPull };
  root.DTD1Runtime = root.DTD1Runtime || { appKeyFromPath, syncApp, syncEnabledApps, classifyRecord, resolveConflicts, pendingConflicts: (key, storage = root.localStorage) => readConflictState(storage, key).conflicts, enabledAppKeys };
  // Legacy shortcodes remain responsible for rendering their UI, but their
  // JSONBin routines must stop at the provider cutover boundary.
  root.DTD1LegacySync = {
    isDisabled: (appKey) => isLegacySyncDisabled(appKey, root.localStorage)
  };
  const initialAppKey = appKeyFromPath(root.location?.pathname);
  if (initialAppKey && initialAppKey !== 'focus_lab' && root.localStorage) installLegacyJsonBinGuard(initialAppKey);
  if (typeof root.addEventListener === 'function') {
    if (root.document?.readyState === 'loading') root.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})(typeof window !== 'undefined' ? window : globalThis);

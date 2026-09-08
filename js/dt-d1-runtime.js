/* Opt-in D1 live synchronizer for migrated tools.
 *
 * D1 is used as the live transport only after a tool explicitly opts in.
 * Every record keeps the last successful local/remote baseline. That makes
 * the direction of a change observable: pull remote-only changes, push
 * local-only changes, and preserve both sides when both changed.
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
  const STATE_PREFIX = 'dt_d1_sync_state_';
  const CONFLICT_PREFIX = 'dt_d1_sync_conflict_';
  const RUNTIME_METADATA_KEY = /^dt_d1_(?:sync_state|sync_conflict|pre_cutover_backup)_/i;

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

  function classifyRecord({ local, remote, previous }) {
    const localHash = local?.hash ?? null;
    const remoteHash = remote?.hash ?? null;
    if (localHash !== null && remoteHash !== null && localHash === remoteHash) return { action: 'unchanged' };

    if (!previous) {
      if (localHash === null && remoteHash !== null) return { action: 'pull' };
      if (localHash !== null && remoteHash === null) return { action: 'push', expectedRevision: null };
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
    if (localChanged && remoteChanged) return { action: 'conflict', reason: 'both_changed' };
    return { action: 'conflict', reason: 'baseline_mismatch' };
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
    const pushChanges = [];
    const conflicts = [];
    const nextRecords = { ...(previous.records || {}) };

    for (const recordKey of recordKeys) {
      const local = current.get(recordKey);
      const remoteRecord = remote.get(recordKey);
      const localDescriptor = local ? { hash: await sha256(local.payload) } : null;
      const remoteDescriptor = remoteRecord ? {
        hash: remoteRecord.payloadHash || await sha256(remoteRecord.payload),
        revision: remoteRecord.revision
      } : null;
      const decision = classifyRecord({ local: localDescriptor, remote: remoteDescriptor, previous: previous.records?.[recordKey] || null });

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
        pushChanges.push({
          recordKey, payload: local.payload, updatedAt: new Date().toISOString(),
          expectedRevision: decision.expectedRevision,
          source: `device:${settings.deviceId}`
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

    if (pullEntries.length) {
      try {
        await root.DTSyncCutover.applyCandidateApp(
          { status: 'ready', entries: pullEntries },
          { appKey, storage, indexedDB: root.indexedDB }
        );
      } catch (_) {
        return { ok: false, reason: 'apply_failed' };
      }
    }

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
    for (const change of pushChanges) {
      const result = pushResultByKey.get(change.recordKey);
      if (!result || result.status === 'conflict') {
        conflicts.push({ recordKey: change.recordKey, reason: 'remote_revision_conflict' });
        continue;
      }
      const revision = Number.isInteger(result.revision)
        ? result.revision
        : (Number.isInteger(change.expectedRevision) ? change.expectedRevision + 1 : 1);
      const hash = await sha256(change.payload);
      nextRecords[change.recordKey] = { localHash: hash, remoteHash: hash, remoteRevision: revision };
    }

    writeSyncState(storage, appKey, nextRecords);
    writeConflictState(storage, appKey, conflicts);
    const changed = pullEntries.length + pushChanges.length;
    if (conflicts.length) return { ok: true, status: 'conflict', changed, conflicts };
    if (pullEntries.length && pushChanges.length) return { ok: true, status: 'synced', changed };
    if (pullEntries.length) return { ok: true, status: 'pulled', changed: pullEntries.length };
    if (pushChanges.length) return { ok: true, status: 'pushed', changed: pushChanges.length };
    return { ok: true, status: 'unchanged', changed: 0 };
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

  function start() {
    const appKey = appKeyFromPath(root.location?.pathname);
    if (!appKey || appKey === 'focus_lab' || !root.localStorage) return;
    installLegacyJsonBinGuard(appKey);
    let timer = null;
    let running = false;
    const schedule = () => {
      if (timer) root.clearTimeout(timer);
      timer = root.setTimeout(run, 1200);
    };
    async function run() {
      if (running || !config(appKey, root.localStorage)) return;
      running = true;
      try {
        dispatchStatus(appKey, await syncApp(appKey));
      } catch (_) {
        dispatchStatus(appKey, { ok: false, reason: 'network' });
      } finally {
        running = false;
      }
    }
    const storagePrototype = root.Storage?.prototype;
    if (storagePrototype && !storagePrototype.__dtD1RuntimePatched) {
      const originalSetItem = storagePrototype.setItem;
      storagePrototype.setItem = function (key, value) {
        const result = originalSetItem.call(this, key, value);
        if (this === root.localStorage && shouldScheduleStorageKey(key)) schedule();
        return result;
      };
      Object.defineProperty(storagePrototype, '__dtD1RuntimePatched', { value: true });
    }
    root.setTimeout(run, 2500);
    root.setInterval(run, 15000);
    root.document?.addEventListener?.('visibilitychange', () => {
      if (root.document.visibilityState === 'visible') run();
    });
    root.DTD1Runtime = {
      appKey,
      syncNow: run,
      isEnabled: key => root.localStorage?.getItem(`dt_sync_provider_${key}`) === 'd1'
    };
  }

  root.DTSyncRuntimeCore = { stableStringify, classifyRecord, shouldBlockLegacyJsonBin, shouldScheduleStorageKey };
  root.DTD1Runtime = root.DTD1Runtime || { appKeyFromPath, syncApp, classifyRecord };
  if (typeof root.addEventListener === 'function') {
    if (root.document?.readyState === 'loading') root.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})(typeof window !== 'undefined' ? window : globalThis);

/* Opt-in D1 mirror for migrated tools.
 *
 * The existing JSONBin code remains untouched.  This runtime only activates
 * after Sync Settings has successfully applied a candidate and set the
 * per-tool provider flag to "d1".  It mirrors local changes to D1 and never
 * clears or silently overwrites a different local value.
 */
(function (root) {
  'use strict';

  const PATHS = [
    [/\/0723\/manga(?:\/|$)/, 'manga'], [/\/0723\/novel(?:\/|$)/, 'novel'],
    [/\/0723\/movie(?:\/|$)/, 'movie'], [/\/0723\/feeding(?:\/|$)/, 'feeding'],
    [/\/project-x\/timetable(?:\/|$)/, 'timetable'], [/\/0723\/diary(?:\/|$)/, 'diary'],
    [/\/0723\/action_log(?:\/|$)/, 'task_calendar'], [/\/0723\/calendar(?:\/|$)/, 'calendar'],
    [/\/0723\/report-card(?:\/|$)/, 'report_card'], [/\/lab\/deadline(?:\/|$)/, 'deadline'],
    [/\/(?:tasks)(?:\/|$)/, 'tasklist'], [/\/0723\/payment(?:\/|$)/, 'payment'],
    [/\/0723\/vocal-range(?:\/|$)/, 'vocal_range'], [/\/library(?:\/|$)/, 'library'],
    [/\/lab\/attendance(?:\/|$)/, 'attendance'], [/\/0723\/(?:weight_log|weight-log)(?:\/|$)/, 'weight_log'],
    [/\/0723\/shift-clock(?:\/|$)/, 'shift_clock'], [/\/0723\/taskmanage(?:\/|$)/, 'taskmanage'],
    [/\/0723\/math-memo(?:\/|$)/, 'math_memo'], [/\/0723\/ritual-grid(?:\/|$)/, 'ritual_grid'],
    [/\/0723\/oshi(?:\/|$)/, 'oshi'], [/\/lab\/heatmap(?:\/|$)/, 'habit_heatmap'],
    [/\/(?:biome|biome-dashboard)(?:\/|$)/, 'biome_archive']
  ];

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
    const digest = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableStringify(value)));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
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
    return { schema: 'dt-world-d1-record', version: 1, kind: 'localStorage', key: entry.recordKey.slice('localStorage:'.length), entry: entry.entry };
  }

  function candidateEntryForRemote(record) {
    const payload = record?.payload;
    if (!payload || payload.schema !== 'dt-world-d1-record') return null;
    if (payload.kind === 'localStorage' && typeof payload.key === 'string' && payload.entry && typeof payload.entry.raw === 'string') {
      return { recordKey: record.recordKey, kind: 'localStorage', entry: payload.entry };
    }
    if (payload.kind === 'indexedDB' && payload.database && payload.store && payload.entry) {
      return { recordKey: record.recordKey, kind: 'indexedDB', database: payload.database, store: payload.store, entry: payload.entry };
    }
    return null;
  }

  async function syncApp(appKey, storage = root.localStorage) {
    const settings = config(appKey, storage);
    if (!settings || !root.DTSyncGatewayClient?.createLive) return { ok: false, reason: 'not_enabled' };
    const client = root.DTSyncGatewayClient.createLive({ baseUrl: settings.baseUrl, syncKey: settings.syncKey, timeoutMs: 7000, retries: 1 });
    const remoteResult = await client.getSnapshot(appKey);
    if (!remoteResult.ok) return remoteResult;
    const remote = new Map((remoteResult.data.records || []).map(record => [record.recordKey, record]));
    const current = new Map(localEntries(storage, appKey).map(entry => [entry.recordKey, { entry, payload: wrapperForLocal(entry) }]));
    if (root.DTSyncCutover?.collectIndexedDBEntries) {
      const indexed = await root.DTSyncCutover.collectIndexedDBEntries(root.indexedDB, appKey);
      for (const entry of indexed) current.set(entry.recordKey, { entry, payload: { schema: 'dt-world-d1-record', version: 1, kind: 'indexedDB', database: entry.database, store: entry.store, entry: entry.entry } });
    }

    const changes = [];
    for (const [recordKey, record] of remote) {
      const local = current.get(recordKey);
      if (!local) {
        const candidateEntry = candidateEntryForRemote(record);
        if (candidateEntry) {
          try {
            await root.DTSyncCutover.applyCandidateApp({ status: 'ready', entries: [candidateEntry] }, { appKey, storage, indexedDB: root.indexedDB });
          } catch (_) {
            // A missing local value is recoverable; leave the remote record
            // untouched if this browser cannot apply it.
          }
        }
        continue;
      }
      if (await sha256(local.payload) === record.payloadHash) continue;
      changes.push({
        recordKey,
        payload: local.payload,
        updatedAt: new Date().toISOString(),
        expectedRevision: Number.isInteger(record.revision) ? record.revision : null,
        source: `device:${settings.deviceId}`
      });
    }
    for (const [recordKey, local] of current) {
      if (remote.has(recordKey)) continue;
      changes.push({
        recordKey,
        payload: local.payload,
        updatedAt: new Date().toISOString(),
        expectedRevision: null,
        source: `device:${settings.deviceId}`
      });
    }
    if (!changes.length) return { ok: true, status: 'unchanged', changed: 0 };
    const results = [];
    for (let offset = 0; offset < changes.length; offset += 100) {
      const result = await client.pushChanges(appKey, changes.slice(offset, offset + 100), {
        deviceId: settings.deviceId,
        clientVersion: 'dt-d1-runtime-v1'
      });
      if (!result.ok) return result;
      results.push(result.data);
    }
    return { ok: true, status: results.some(result => result?.status === 'conflict') ? 'conflict' : 'synced', changed: changes.length, results };
  }

  function start() {
    const appKey = appKeyFromPath(root.location?.pathname);
    if (!appKey || appKey === 'focus_lab' || !root.localStorage) return;
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
        const result = await syncApp(appKey);
        root.dispatchEvent?.(new CustomEvent('dt-d1-sync-status', { detail: { appKey, ...result } }));
      } catch (error) {
        root.dispatchEvent?.(new CustomEvent('dt-d1-sync-status', { detail: { appKey, ok: false, reason: 'network' } }));
      } finally {
        running = false;
      }
    }
    const storagePrototype = root.Storage?.prototype;
    if (storagePrototype && !storagePrototype.__dtD1RuntimePatched) {
      const originalSetItem = storagePrototype.setItem;
      storagePrototype.setItem = function (key, value) {
        const result = originalSetItem.call(this, key, value);
        if (this === root.localStorage) schedule();
        return result;
      };
      Object.defineProperty(storagePrototype, '__dtD1RuntimePatched', { value: true });
    }
    root.setTimeout(run, 2500);
    root.setInterval(run, 15000);
    root.DTD1Runtime = { appKey, syncNow: run };
  }

  root.DTD1Runtime = root.DTD1Runtime || { appKeyFromPath, syncApp };
  if (typeof root.addEventListener === 'function') {
    if (root.document?.readyState === 'loading') root.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})(typeof window !== 'undefined' ? window : globalThis);

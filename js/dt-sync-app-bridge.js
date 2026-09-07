/* Local-first bridge for a single app record stored in the D1 sync gateway. */
(function (root) {
  'use strict';

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  function create({
    appKey,
    storageKey,
    recordKey,
    providerKey,
    deviceKey,
    revisionKey,
    backupKey,
    gatewayUrl,
    syncKey,
    storage = root.localStorage,
    client,
    createClient,
    merge,
    preparePayload,
    now = () => new Date().toISOString(),
    onStatus = () => {},
    onApplied = () => {}
  } = {}) {
    let queuedTimer = null;
    let queuedPromise = null;
    let queuedDirty = false;

    function setStatus(kind, detail) {
      onStatus({ kind, detail });
    }

    function safeGet(key) {
      try { return storage.getItem(key); } catch (_) { return null; }
    }

    function safeSet(key, value) {
      try {
        storage.setItem(key, value);
        return true;
      } catch (_) {
        return false;
      }
    }

    function configured() {
      return safeGet(providerKey) === 'd1'
        && typeof gatewayUrl === 'string' && gatewayUrl.trim().length > 0
        && typeof syncKey === 'string' && syncKey.length >= 32;
    }

    function readLocal() {
      const raw = safeGet(storageKey);
      if (raw === null) return { raw: null, value: null };
      try {
        const value = JSON.parse(raw);
        return isObject(value) ? { raw, value } : { raw, value: null, invalid: true };
      } catch (_) {
        return { raw, value: null, invalid: true };
      }
    }

    function oneTimeBackup(raw) {
      if (safeGet(backupKey) !== null) return true;
      return safeSet(backupKey, JSON.stringify({
        schema: 'dt-world-pre-cutover-backup',
        version: 1,
        capturedAt: now(),
        storageKey,
        raw
      }));
    }

    function deviceId() {
      const existing = safeGet(deviceKey);
      if (existing && /^[A-Za-z0-9_-]{1,128}$/.test(existing)) return existing;
      const generated = typeof root.crypto?.randomUUID === 'function'
        ? root.crypto.randomUUID().replace(/-/g, '')
        : `device${Date.now().toString(36)}`;
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(generated)) return 'browser';
      safeSet(deviceKey, generated);
      return generated;
    }

    function liveClient() {
      if (client) return client;
      if (typeof createClient !== 'function') return null;
      try { return createClient({ baseUrl: gatewayUrl, syncKey }); } catch (_) { return null; }
    }

    function resultForRecord(data) {
      const records = data && Array.isArray(data.records) ? data.records : null;
      if (!records) return { invalid: true };
      const matching = records.filter((record) => record && record.recordKey === recordKey);
      if (matching.length === 0) return { record: null };
      if (matching.length !== 1) return { invalid: true };
      const record = matching[0];
      if (!isObject(record.payload) || record.deletedAt !== null || !Number.isInteger(record.revision) || record.revision < 1) {
        return { invalid: true };
      }
      return { record };
    }

    function notifyApplied(value) {
      try { onApplied(value); } catch (_) { /* UI callbacks cannot invalidate a committed write. */ }
    }

    function localChangedSince(raw) {
      return safeGet(storageKey) !== raw;
    }

    async function syncNow() {
      if (safeGet(providerKey) !== 'd1') return { ok: false, reason: 'local_only' };
      if (!configured()) return { ok: false, reason: 'not_configured' };

      const local = readLocal();
      if (local.invalid) return { ok: false, reason: 'invalid_local' };
      if (!oneTimeBackup(local.raw)) return { ok: false, reason: 'backup_failed' };

      const gateway = liveClient();
      if (!gateway) return { ok: false, reason: 'not_configured' };
      setStatus('working', '同期先を確認しています…');
      const snapshot = await gateway.getSnapshot(appKey);
      if (!snapshot || !snapshot.ok) return { ok: false, reason: snapshot?.reason || 'network' };
      const remote = resultForRecord(snapshot.data);
      if (remote.invalid) return { ok: false, reason: 'invalid_remote' };
      if (!remote.record && local.value === null) return { ok: false, reason: 'empty_remote' };

      const remoteValue = remote.record ? remote.record.payload : null;
      const merged = typeof merge === 'function' ? merge(local.value, remoteValue) : local.value;
      const payload = typeof preparePayload === 'function' ? preparePayload(merged) : merged;
      if (!isObject(merged) || !isObject(payload)) return { ok: false, reason: 'invalid_local' };

      if (remote.record && stableStringify(payload) === stableStringify(remote.record.payload)) {
        if (localChangedSince(local.raw)) {
          setStatus('local', '同期中のローカル変更を保持しました。再同期します…');
          return { ok: false, reason: 'local_changed' };
        }
        if (!safeSet(storageKey, JSON.stringify(merged)) || !safeSet(revisionKey, String(remote.record.revision))) {
          return { ok: false, reason: 'storage_error' };
        }
        notifyApplied(merged);
        setStatus('online', '同期済み');
        return { ok: true, status: 'unchanged', revision: remote.record.revision };
      }

      const expectedRevision = remote.record ? remote.record.revision : null;
      const pushed = await gateway.pushChanges(appKey, [{
        recordKey,
        payload,
        expectedRevision,
        updatedAt: now(),
        deletedAt: null,
        source: 'unknown'
      }], { deviceId: deviceId(), clientVersion: 'dt-world-live-sync-v1' });
      if (!pushed || !pushed.ok) return { ok: false, reason: pushed?.reason || 'network' };
      const change = pushed.data?.results?.find((entry) => entry && entry.recordKey === recordKey);
      if (!change || change.status === 'conflict' || pushed.data?.status === 'conflict') {
        setStatus('conflict', '競合を検出したため、ローカルデータは変更していません');
        return { ok: false, reason: 'conflict' };
      }
      if (!['created', 'updated', 'unchanged'].includes(change.status) || !Number.isInteger(change.revision) || change.revision < 1) {
        return { ok: false, reason: 'invalid_response' };
      }
      if (localChangedSince(local.raw)) {
        setStatus('local', '同期中のローカル変更を保持しました。再同期します…');
        return { ok: false, reason: 'local_changed' };
      }
      if (!safeSet(storageKey, JSON.stringify(merged)) || !safeSet(revisionKey, String(change.revision))) {
        return { ok: false, reason: 'storage_error' };
      }
      notifyApplied(merged);
      setStatus('online', '同期済み');
      return { ok: true, status: change.status, revision: change.revision };
    }

    function queueSync({ delayMs = 900 } = {}) {
      const delay = Number.isFinite(Number(delayMs)) ? Math.max(0, Number(delayMs)) : 900;
      if (queuedPromise) {
        if (!queuedTimer) queuedDirty = true;
        return queuedPromise;
      }
      queuedPromise = new Promise((resolve) => {
        const schedule = (run) => {
          if (typeof root.setTimeout === 'function') {
            queuedTimer = root.setTimeout(run, delay);
          } else {
            run();
          }
        };
        const run = async () => {
          queuedTimer = null;
          let result;
          try {
            result = await syncNow();
          } catch (_) {
            result = { ok: false, reason: 'network' };
          }
          if (queuedDirty) {
            queuedDirty = false;
            schedule(run);
            return;
          }
          queuedPromise = null;
          resolve(result);
        };
        schedule(run);
      });
      return queuedPromise;
    }

    function setProvider(provider) {
      if (provider !== 'local' && provider !== 'd1') return { ok: false, reason: 'invalid_provider' };
      if (!safeSet(providerKey, provider)) return { ok: false, reason: 'storage_error' };
      return { ok: true, provider };
    }

    return { syncNow, queueSync, setProvider };
  }

  root.DTSyncAppBridge = { create };
})(typeof window !== 'undefined' ? window : globalThis);

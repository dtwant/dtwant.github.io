/* Opt-in browser client for the Cloudflare Access-protected sync gateway. */
(function (root) {
  'use strict';

  const APP_KEY = /^[a-z][a-z0-9_-]{0,63}$/;

  function create({ baseUrl, fetchImpl = root.fetch, timeoutMs = 8000, retries = 1 } = {}) {
    const endpoint = String(baseUrl || '').replace(/\/+$/, '');
    if (!endpoint) throw new Error('sync gateway URL is required');
    if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');

    async function requestJson(path, options = {}) {
      let lastReason = 'network';
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = controller ? root.setTimeout(() => controller.abort(), timeoutMs) : null;
        try {
          const response = await fetchImpl(`${endpoint}${path}`, {
            ...options,
            credentials: 'include',
            signal: controller ? controller.signal : undefined,
            // Keep JSON in the body, but use a CORS-safelisted content type so
            // Cloudflare Access does not block a preflight OPTIONS request.
            headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'text/plain;charset=UTF-8' } : {}), ...(options.headers || {}) }
          });
          let data = null;
          try { data = await response.json(); } catch (_) { data = null; }
          if (response.ok) return { ok: true, data };
          lastReason = `http_${response.status}`;
          if (response.status < 500 || attempt >= retries) return { ok: false, reason: lastReason, data: null };
        } catch (error) {
          lastReason = error && error.name === 'AbortError' ? 'timeout' : 'network';
          if (attempt >= retries) return { ok: false, reason: lastReason, data: null };
        } finally {
          if (timer) root.clearTimeout(timer);
        }
      }
      return { ok: false, reason: lastReason, data: null };
    }

    async function getSnapshot(appKey) {
      if (!APP_KEY.test(String(appKey || ''))) return { ok: false, reason: 'invalid_app', data: null };
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const result = await requestJson(`/v1/apps/${encodeURIComponent(appKey)}/snapshot`);
        if (!result.ok) return result;
        if (!result.data || result.data.schema !== 'dt-world-sync-records' || !Array.isArray(result.data.records)) {
          return { ok: false, reason: 'invalid_remote', data: null };
        }
        if (result.data.records.length > 0) return result;
        if (attempt >= retries) return { ok: false, reason: 'empty_remote', data: null };
      }
      return { ok: false, reason: 'empty_remote', data: null };
    }

    async function pushChanges(appKey, changes, { deviceId = 'browser', clientVersion = 'gateway-client-v1' } = {}) {
      if (!APP_KEY.test(String(appKey || ''))) return { ok: false, reason: 'invalid_app', data: null };
      if (!Array.isArray(changes) || changes.length === 0) return { ok: false, reason: 'empty_changes' };
      return requestJson(`/v1/apps/${encodeURIComponent(appKey)}/changes`, {
        method: 'POST',
        body: JSON.stringify({ deviceId, clientVersion, changes })
      });
    }

    return {
      getSnapshot,
      getMigrationPreview() {
        return requestJson('/v1/migration/preview');
      },
      createMigrationCandidate() {
        return requestJson('/v1/migration/candidates', { method: 'POST', body: '{}' });
      },
      listMigrationCandidates() {
        return requestJson('/v1/migration/candidates');
      },
      promoteFocusLabCandidate(candidateId) {
        if (!candidateId) return Promise.resolve({ ok: false, reason: 'invalid_candidate', data: null });
        return requestJson(`/v1/migration/candidates/${encodeURIComponent(candidateId)}/promote-focus-lab`, { method: 'POST', body: '{}' });
      },
      getMigrationCandidateApp(candidateId, appKey) {
        if (!candidateId || !APP_KEY.test(String(appKey || ''))) {
          return Promise.resolve({ ok: false, reason: 'invalid_candidate_app', data: null });
        }
        return requestJson(`/v1/migration/candidates/${encodeURIComponent(candidateId)}/apps/${encodeURIComponent(appKey)}`);
      },
      promoteMigrationCandidateApp(candidateId, appKey) {
        if (!candidateId || !APP_KEY.test(String(appKey || ''))) {
          return Promise.resolve({ ok: false, reason: 'invalid_candidate_app', data: null });
        }
        return requestJson(`/v1/migration/candidates/${encodeURIComponent(candidateId)}/apps/${encodeURIComponent(appKey)}/promote`, { method: 'POST', body: '{}' });
      },
      pushChanges,
      importSnapshot(snapshot, appKey) {
        return requestJson('/v1/import/snapshot', { method: 'POST', body: JSON.stringify({ appKey, snapshot }) });
      },
      getConflicts(appKey = '') {
        const query = appKey ? `?app=${encodeURIComponent(appKey)}` : '';
        return requestJson(`/v1/conflicts${query}`);
      },
      resolveConflict(id, resolution) {
        return requestJson(`/v1/conflicts/${encodeURIComponent(id)}/resolve`, { method: 'POST', body: JSON.stringify(resolution) });
      }
    };
  }

  function createLive({ baseUrl, syncKey, fetchImpl = root.fetch, timeoutMs = 8000, retries = 1 } = {}) {
    const endpoint = String(baseUrl || '').replace(/\/+$/, '');
    const appSyncKey = String(syncKey || '');
    if (!endpoint) throw new Error('sync gateway URL is required');
    if (appSyncKey.length < 32) throw new Error('sync key is required');
    if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');

    async function requestJson(path, options = {}) {
      let lastReason = 'network';
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        let timer = null;
        const deadline = new Promise((_, reject) => {
          if (typeof root.setTimeout === 'function') {
            timer = root.setTimeout(() => {
              if (controller) controller.abort();
              const error = new Error('sync request timed out');
              error.name = 'AbortError';
              reject(error);
            }, timeoutMs);
          }
        });
        try {
          const request = (async () => {
            const response = await fetchImpl(`${endpoint}${path}`, {
              ...options,
              credentials: 'omit',
              signal: controller ? controller.signal : undefined,
              headers: {
                Accept: 'application/json',
                'X-DT-Sync-Key': appSyncKey,
                ...(options.body ? { 'Content-Type': 'text/plain;charset=UTF-8' } : {}),
                ...(options.headers || {})
              }
            });
            let data = null;
            try { data = await response.json(); } catch (_) { data = null; }
            return { response, data };
          })();
          // A fetch implementation may reject after the deadline has already
          // won the race. Consume that late rejection so timeout stays stable.
          request.catch(() => {});
          const { response, data } = await Promise.race([request, deadline]);
          if (response.ok) return { ok: true, data };
          lastReason = `http_${response.status}`;
          if (response.status < 500 || attempt >= retries) return { ok: false, reason: lastReason, data: null };
        } catch (error) {
          lastReason = error && error.name === 'AbortError' ? 'timeout' : 'network';
          if (attempt >= retries) return { ok: false, reason: lastReason, data: null };
        } finally {
          if (timer) root.clearTimeout(timer);
        }
      }
      return { ok: false, reason: lastReason, data: null };
    }

    async function getSnapshot(appKey) {
      if (!APP_KEY.test(String(appKey || ''))) return { ok: false, reason: 'invalid_app', data: null };
      const result = await requestJson(`/v1/apps/${encodeURIComponent(appKey)}/snapshot`);
      if (!result.ok) return result;
      if (!result.data || result.data.schema !== 'dt-world-sync-records' || result.data.appKey !== appKey || !Array.isArray(result.data.records)) {
        return { ok: false, reason: 'invalid_remote', data: null };
      }
      return result;
    }

    async function pushChanges(appKey, changes, { deviceId = 'browser', clientVersion = 'gateway-client-v1' } = {}) {
      if (!APP_KEY.test(String(appKey || ''))) return { ok: false, reason: 'invalid_app', data: null };
      if (!Array.isArray(changes) || changes.length === 0) return { ok: false, reason: 'empty_changes' };
      if (changes.some((change) => !Object.prototype.hasOwnProperty.call(change || {}, 'expectedRevision'))) {
        return { ok: false, reason: 'expected_revision_required' };
      }
      if (changes.some((change) => change.expectedRevision !== null
        && (!Number.isInteger(change.expectedRevision) || change.expectedRevision < 1 || change.expectedRevision > 2147483647))) {
        return { ok: false, reason: 'invalid_expected_revision' };
      }
      return requestJson(`/v1/apps/${encodeURIComponent(appKey)}/changes`, {
        method: 'POST',
        body: JSON.stringify({ deviceId, clientVersion, changes })
      });
    }

    async function resolveRecords(appKey, records, { source } = {}) {
      if (!APP_KEY.test(String(appKey || ''))) return { ok: false, reason: 'invalid_app', data: null };
      if (!Array.isArray(records) || records.length === 0) return { ok: false, reason: 'resolution_records_required', data: null };
      if (!['pc', 'smartphone'].includes(source)) return { ok: false, reason: 'invalid_resolution_source', data: null };
      if (records.some((record) => !record || !Object.prototype.hasOwnProperty.call(record, 'expectedRevision'))) {
        return { ok: false, reason: 'expected_revision_required', data: null };
      }
      return requestJson(`/v1/apps/${encodeURIComponent(appKey)}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ source, records })
      });
    }

    return { getSnapshot, pushChanges, resolveRecords };
  }

  root.DTSyncGatewayClient = { create, createLive };
})(typeof window !== 'undefined' ? window : globalThis);

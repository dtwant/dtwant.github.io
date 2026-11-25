// D1 sync for the private shelf, built on the shared sync Worker
// (GET /v1/apps/private_shelf/snapshot, POST /v1/apps/private_shelf/changes).
//
// Design notes (agreed 2026-11-25):
// - The shelf is a single record; conflicts are resolved by merging with
//   mergeBackup (per-book / per-event updatedAt union), never by letting one
//   device silently overwrite the other.
// - A device whose shelf is empty never performs the initial upload, so an
//   empty second device cannot seed an empty remote over the phone's data.
//   The first device with content (Kaneko's phone) creates the record.
// - Gateway URL / key come from the shared sync settings
//   (localStorage dt_sync_gateway_url / dt_sync_gateway_key), the same pair
//   the metadata fetch already uses.
import { mergeBackup, shelfHasContent, shelfStateFingerprint, shelfStatesEqual, SHELF_RECORD_KEY, SHELF_SYNC_APP_KEY, unwrapShelfState, wrapShelfState } from './core.js';

const ENABLED_KEY = 'dt_private_shelf_sync_v1';
const META_KEY = 'dt_private_shelf_sync_meta_v1';
const CLIENT_VERSION = 'private-shelf-sync-v1';

function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storageSet(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode: keep in-memory only */ } }

export function syncConfig() {
  const base = storageGet('dt_sync_gateway_url') || '';
  const key = storageGet('dt_sync_gateway_key') || '';
  const configured = /^https:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(base) && key.length >= 32;
  return { base: base.replace(/\/+$/, ''), key, configured };
}

export function syncEnabled() {
  return storageGet(ENABLED_KEY) !== 'off';
}

export function setSyncEnabled(on) {
  storageSet(ENABLED_KEY, on ? 'on' : 'off');
}

function deviceId() {
  let id = storageGet('dt_sync_device_id') || '';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    id = `ps-${crypto.randomUUID()}`;
    storageSet('dt_sync_device_id', id);
  }
  return id;
}

function readMeta() {
  try { return JSON.parse(storageGet(META_KEY) || 'null') || {}; } catch { return {}; }
}
function writeMeta(patch) {
  storageSet(META_KEY, JSON.stringify({ ...readMeta(), ...patch }));
}
export function syncMeta() { return readMeta(); }

async function requestJson(path, options = {}) {
  const { base, key } = syncConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${base}${path}`, {
      ...options,
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        'X-DT-Sync-Key': key,
        ...(options.body ? { 'Content-Type': 'text/plain;charset=UTF-8' } : {}),
      },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(response.status === 401 ? 'unauthorized' : `http_${response.status}`);
    return data;
  } finally { clearTimeout(timer); }
}

async function pullRemote() {
  const data = await requestJson(`/v1/apps/${SHELF_SYNC_APP_KEY}/snapshot`);
  if (!data || data.schema !== 'dt-world-sync-records' || !Array.isArray(data.records)) throw new Error('invalid_remote');
  const record = data.records.find(r => r.recordKey === SHELF_RECORD_KEY && !r.deletedAt);
  if (!record) return null;
  const state = unwrapShelfState(record.payload);
  if (!state) throw new Error('invalid_remote');
  return { state, revision: record.revision };
}

async function pushState(state, expectedRevision) {
  const data = await requestJson(`/v1/apps/${SHELF_SYNC_APP_KEY}/changes`, {
    method: 'POST',
    body: JSON.stringify({
      deviceId: deviceId(),
      clientVersion: CLIENT_VERSION,
      changes: [{
        recordKey: SHELF_RECORD_KEY,
        payload: wrapShelfState(state),
        expectedRevision,
        updatedAt: new Date().toISOString(),
        deletedAt: null,
        source: 'unknown',
      }],
    }),
  });
  const result = (data?.results || []).find(r => r.recordKey === SHELF_RECORD_KEY);
  if (!result) throw new Error('invalid_remote');
  return result;
}

// getState(): current local shelf state.
// applyRemote(state): persist a merged state locally (without re-rendering
// decisions; the caller re-renders after syncNow resolves true).
// onStatus(status, detail): 'off' | 'unconfigured' | 'syncing' | 'synced' | 'error'
export function createShelfSync({ getState, applyRemote, onStatus }) {
  let running = null;
  let pushTimer = null;
  let queuedPush = false;

  const report = (status, detail = {}) => { try { onStatus(status, detail); } catch { /* status UI is best-effort */ } };

  function currentStatus() {
    if (!syncEnabled()) return 'off';
    if (!syncConfig().configured) return 'unconfigured';
    return readMeta().lastStatus || 'synced';
  }

  async function syncNow() {
    if (!syncEnabled()) { report('off'); return false; }
    if (!syncConfig().configured) { report('unconfigured'); return false; }
    if (running) return running;
    running = (async () => {
      report('syncing');
      try {
        const local = getState();
        const remote = await pullRemote();
        if (!remote) {
          if (!shelfHasContent(local)) {
            writeMeta({ revision: null, fingerprint: shelfStateFingerprint(local), lastSyncAt: new Date().toISOString(), lastStatus: 'synced' });
            report('synced');
            return false;
          }
          const result = await pushState(local, null);
          if (result.status === 'conflict') throw new Error('conflict');
          writeMeta({ revision: result.revision ?? 1, fingerprint: shelfStateFingerprint(local), lastSyncAt: new Date().toISOString(), lastStatus: 'synced' });
          report('synced');
          return false;
        }
        const merged = mergeBackup(local, remote.state);
        let changedLocally = false;
        if (!shelfStatesEqual(merged, local)) {
          await applyRemote(merged);
          changedLocally = true;
        }
        let revision = remote.revision;
        if (!shelfStatesEqual(merged, remote.state)) {
          const result = await pushState(merged, remote.revision);
          if (result.status === 'conflict' || result.status === 'stale') throw new Error('conflict');
          revision = result.revision ?? remote.revision;
        }
        writeMeta({ revision, fingerprint: shelfStateFingerprint(merged), lastSyncAt: new Date().toISOString(), lastStatus: 'synced' });
        report('synced');
        return changedLocally;
      } catch (error) {
        writeMeta({ lastStatus: 'error' });
        report('error', { message: error?.message || 'sync_failed' });
        return false;
      } finally { running = null; }
    })();
    return running;
  }

  // Push after a local edit. Debounced; a revision conflict falls back to a
  // full pull-merge-push so no edit is lost.
  function schedulePush() {
    if (!syncEnabled() || !syncConfig().configured) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      if (running) { queuedPush = true; return; }
      const local = getState();
      const meta = readMeta();
      if (meta.fingerprint === shelfStateFingerprint(local)) return;
      report('syncing');
      try {
        const result = await pushState(local, meta.revision ?? null);
        if (result.status === 'conflict' || result.status === 'stale') {
          await syncNow();
        } else {
          writeMeta({ revision: result.revision ?? meta.revision ?? null, fingerprint: shelfStateFingerprint(local), lastSyncAt: new Date().toISOString(), lastStatus: 'synced' });
          report('synced');
        }
      } catch {
        // Offline or unauthorized: keep the local data, mark the error, and
        // let the next launch / manual sync reconcile.
        writeMeta({ lastStatus: 'error' });
        report('error');
      } finally {
        if (queuedPush) { queuedPush = false; schedulePush(); }
      }
    }, 1200);
  }

  return { syncNow, schedulePush, currentStatus };
}

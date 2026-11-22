/* D1 migration note (2026-10-20): legacy Bin helpers remain read-compatible
 * for recovery, while normal transport is owned by dt-d1-runtime.js.
 * Fusion update (2026-11-22): TODAY / PULSE views, task cadence model,
 * automatic day summary column (replaces manual MAIN), Action Log migration. */
import {
  cycleValue,
  memoKey,
  setMemo,
  hasMemo,
  mergeStates,
  classifyPress
} from '/js/ritual-grid-core.mjs';
import { ACTION_LOG_SNAPSHOT } from '/js/ritual-action-data.mjs';

(() => {
  'use strict';

  const root = document.querySelector('[data-rg-root]');
  if (!root) return;

  const STORE_KEY = 'dt_ritual_grid_v1';
  const BIN_KEY = 'dt_ritual_grid_bin_id';
  const DEVICE_KEY = 'dt_ritual_grid_device_id';
  const IMPORT_BACKUP_KEY = 'dt_ritual_grid_import_backup';
  const RECOVERY_KEY = 'dt_ritual_grid_recovery_v1';
  const MIGRATION_KEY = 'dt_ritual_grid_action_migration_v1';
  const VIEW_KEY = 'dt_ritual_grid_view_v2';
  const APP_KEY = 'ritual_grid';
  const d1Enabled = () => window.DTD1Runtime?.isEnabled?.(APP_KEY) || localStorage.getItem(`dt_sync_provider_${APP_KEY}`) === 'd1';
  const CHANNEL_NAME = 'dt_ritual_grid_channel';
  const BIN_URL = 'https://api.jsonbin.io/v3/b';
  const HOLD_MS = 850;
  const MOVE_LIMIT = 8;
  const STATUS_GLYPHS = { '': '', knife: '🔪', peach: '🍑', heart: '♡', check: '✓' };
  const STATUS_LABELS = { '': '未記録', knife: 'knife', peach: 'peach', heart: 'heart', check: '完了' };
  const STATUS_ORDER = ['knife', 'heart', 'peach', 'check'];
  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  const CADENCE_LABELS = { daily: '毎日', interval: '間隔', weekly: '曜日指定', ad_hoc: '不定期' };
  const CATEGORY_LABELS = { animal: '生き物', house: '家事' };
  const $ = (selector) => root.querySelector(selector);
  const $$ = (selector) => [...root.querySelectorAll(selector)];

  const els = {
    matrix: $('[data-rg-matrix-scroll]'),
    month: $('[data-rg-action="today"]'),
    taskList: $('[data-rg-task-list]'),
    taskSummary: $('[data-rg-task-summary]'),
    syncChip: $('.rg-sync-chip'),
    syncLabel: $('[data-rg-sync-label]'),
    syncCopy: $('[data-rg-settings-sync-copy]'),
    toast: $('[data-rg-toast]'),
    importInput: $('[data-rg-import-input]'),
    dateDialog: $('[data-rg-dialog="date"]'),
    dateTitle: $('#rg-date-dialog-title'),
    detailList: $('[data-rg-detail-list]'),
    detailSummary: $('[data-rg-detail-summary]'),
    memoDialog: $('[data-rg-dialog="memo"]'),
    memoContext: $('[data-rg-memo-context]'),
    memoInput: $('[data-rg-memo-input]'),
    taskDialog: $('[data-rg-dialog="task"]'),
    taskForm: $('[data-rg-task-form]'),
    taskDialogTitle: $('#rg-task-dialog-title'),
    taskId: $('[data-rg-task-id]'),
    taskName: $('[data-rg-task-name]'),
    taskColor: $('[data-rg-task-color]'),
    taskNote: $('[data-rg-task-note]'),
    taskCategory: $('[data-rg-task-category]'),
    taskSubgroup: $('[data-rg-task-subgroup]'),
    taskCadence: $('[data-rg-task-cadence]'),
    taskInterval: $('[data-rg-task-interval]'),
    taskAlert: $('[data-rg-task-alert]'),
    taskWeekdays: $('[data-rg-task-weekdays]'),
    taskHistory: $('[data-rg-task-history]'),
    taskError: $('[data-rg-task-error]'),
    taskSearch: $('[data-rg-task-search]'),
    confirmDialog: $('[data-rg-dialog="confirm"]'),
    confirmTitle: $('#rg-confirm-title'),
    confirmCopy: $('[data-rg-confirm-copy]'),
    todayTelemetry: $('[data-rg-today-telemetry]'),
    todayMain: $('[data-rg-today-main]'),
    pulseShell: $('[data-rg-pulse-shell]'),
    heatShell: $('[data-rg-heat-shell]'),
    gridCount: $('[data-rg-grid-count]'),
    exportStage: $('[data-rg-export-stage]')
  };

  const clone = (value) => {
    try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); }
  };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const pad = (value) => String(value).padStart(2, '0');
  const dateKey = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;
  const parseKey = (key) => { const [year, month, day] = String(key).split('-').map(Number); return { year, month, day }; };
  const shiftDateKey = (key, offset) => { const { year, month, day } = parseKey(key); const date = new Date(year, month - 1, day + offset); return dateKey(date.getFullYear(), date.getMonth() + 1, date.getDate()); };
  const diffDays = (fromKey, toKey) => { const a = parseKey(fromKey); const b = parseKey(toKey); return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86400000); };
  const weekdayOf = (key) => { const { year, month, day } = parseKey(key); return new Date(year, month - 1, day).getDay(); };
  const daysInMonth = (year, month) => new Date(year, month, 0).getDate();
  const localToday = () => { const date = new Date(); return dateKey(date.getFullYear(), date.getMonth() + 1, date.getDate()); };
  const dateLabel = (key, options = {}) => {
    const { year, month, day } = parseKey(key);
    return new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'short', ...options }).format(new Date(year, month - 1, day));
  };
  const timestamp = (() => { let last = 0; return () => { last = Math.max(Date.now(), last + 1); return last; }; })();
  const makeId = (prefix) => {
    const random = window.crypto?.randomUUID ? window.crypto.randomUUID().replaceAll('-', '').slice(0, 14) : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
    return `${prefix}_${random}`;
  };
  const deviceId = () => {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) { id = makeId('device'); localStorage.setItem(DEVICE_KEY, id); }
    return id;
  };
  const currentDevice = deviceId();
  const nowDate = new Date();
  let viewYear = nowDate.getFullYear();
  let viewMonth = nowDate.getMonth() + 1;
  let state;
  let activeView = 'today';
  let activeDate = '';
  let todayDate = localToday();
  let todaySegment = 'all';
  let gridFilter = 'all';
  let manageFilter = 'all';
  let manageQuery = '';
  let dialogWeekdays = new Set();
  let activeMemo = null;
  let focusAfterClose = null;
  let confirmAction = null;
  let pendingRemote = null;
  let toastTimer = 0;
  let pushTimer = 0;
  let pollTimer = 0;
  let dirtySinceRemote = false;
  let syncQueue = Promise.resolve();
  let channel = null;
  try { channel = new BroadcastChannel(CHANNEL_NAME); } catch (_) { channel = null; }

  /* ---------- task field inference (legacy tasks without explicit fields) ---------- */
  const ANIMAL_NAME = /水換え|ご飯|餌|散歩|部屋んぽ|消灯|犬|ハム|ベタ|ウーパー|ツノ|アカハラ|ラック|蛙|カエル|亀|カメ|魚|鳥|猫|爬虫/;
  function inferCategory(task) {
    if (task.color === '#10b981') return 'animal';
    if (task.color === '#06b6d4') return 'house';
    return ANIMAL_NAME.test(task.name || '') ? 'animal' : 'house';
  }
  function inferSubgroup(task) {
    const name = task.name || '';
    if (/水換え/.test(name)) return '水換え';
    if (/部屋んぽ/.test(name) || /^(こむぎ|くるみ|らて|もか|びすけ|おれお)掃除/.test(name)) return 'ハムスター';
    if (inferCategory(task) === 'house' && /掃除|片付け|モップ|洗濯/.test(name)) return '掃除';
    return '';
  }
  function inferCadence(task) {
    const name = task.name || '';
    if (/ご飯|餌やり|お散歩|散歩|消灯/.test(name)) return { cadence: 'daily', intervalDays: 1, alertDays: 0 };
    if (Number(task.alert) > 0) return { cadence: 'interval', intervalDays: Number(task.alert), alertDays: Number(task.alert) };
    if (/水換え/.test(name)) return { cadence: 'interval', intervalDays: 7, alertDays: 2 };
    return { cadence: 'ad_hoc', intervalDays: 7, alertDays: 0 };
  }

  const emptyState = () => ({ version: 1, app: APP_KEY, deviceId: currentDevice, updatedAt: 0, tasks: {}, records: {}, memos: {} });
  const normalizeTask = (input, fallbackId) => {
    const task = input && typeof input === 'object' ? input : {};
    const id = String(task.id || fallbackId || makeId('task'));
    const inferred = inferCadence(task);
    const cadence = ['daily', 'interval', 'weekly', 'ad_hoc'].includes(task.cadence) ? task.cadence : inferred.cadence;
    const weekdays = Array.isArray(task.weekdays) ? [...new Set(task.weekdays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
    return {
      ...task, id,
      name: String(task.name || '無題のタスク').trim().slice(0, 80) || '無題のタスク',
      color: /^#[0-9a-f]{6}$/i.test(task.color) ? task.color : '#7dd3fc',
      note: String(task.note || '').slice(0, 500),
      order: Number.isFinite(Number(task.order)) ? Number(task.order) : 0,
      createdAt: Number(task.createdAt) || 0,
      updatedAt: Number(task.updatedAt) || 0,
      updatedBy: String(task.updatedBy || currentDevice),
      archivedAt: task.archivedAt ? Number(task.archivedAt) : null,
      deletedAt: task.deletedAt ? Number(task.deletedAt) : null,
      activeRanges: Array.isArray(task.activeRanges) && task.activeRanges.length ? task.activeRanges : [{ startOn: null, endOn: null }],
      category: ['animal', 'house'].includes(task.category) ? task.category : inferCategory(task),
      subgroup: String(task.subgroup ?? inferSubgroup(task)).slice(0, 40),
      cadence,
      intervalDays: Math.min(365, Math.max(1, Number(task.intervalDays) || inferred.intervalDays || 7)),
      weekdays,
      alertDays: Math.min(365, Math.max(0, Number.isFinite(Number(task.alertDays)) ? Number(task.alertDays) : inferred.alertDays || 0))
    };
  };
  const normalizeRecord = (input) => {
    const record = input && typeof input === 'object' ? input : {};
    const value = ['', 'knife', 'peach', 'heart', 'check'].includes(record.value) ? record.value : null;
    return { ...record, value, updatedAt: Number(record.updatedAt) || 0, updatedBy: String(record.updatedBy || currentDevice) };
  };
  const normalizeState = (input) => {
    const source = input && typeof input === 'object' ? input : {};
    const tasks = {};
    Object.entries(source.tasks || {}).forEach(([id, task]) => { tasks[id] = normalizeTask(task, id); });
    const records = {};
    Object.entries(source.records || {}).forEach(([day, value]) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !value || typeof value !== 'object') return;
      const normalized = { ...value };
      if (value.main) normalized.main = normalizeRecord(value.main);
      if (value.tasks && typeof value.tasks === 'object') { normalized.tasks = {}; Object.entries(value.tasks).forEach(([id, record]) => { normalized.tasks[id] = normalizeRecord(record); }); }
      records[day] = normalized;
    });
    const memos = {};
    Object.entries(source.memos || {}).forEach(([key, memo]) => {
      if (!memo || typeof memo !== 'object') return;
      memos[key] = { ...memo, text: String(memo.text || '').slice(0, 2000), updatedAt: Number(memo.updatedAt) || 0, updatedBy: String(memo.updatedBy || currentDevice), deletedAt: memo.deletedAt ? Number(memo.deletedAt) : null };
    });
    return { ...source, version: 1, app: APP_KEY, deviceId: currentDevice, updatedAt: Number(source.updatedAt) || 0, tasks, records, memos };
  };
  const loadState = () => {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return emptyState();
    try { return normalizeState(JSON.parse(raw)); } catch (_) {
      try { localStorage.setItem(RECOVERY_KEY, raw); } catch (__) { /* recovery is best effort */ }
      showToast('保存データを読み込めませんでした。復旧用コピーを残しました。');
      return emptyState();
    }
  };

  state = loadState();

  function showToast(message) {
    if (!els.toast) return;
    clearTimeout(toastTimer); els.toast.textContent = message; els.toast.dataset.visible = 'true';
    toastTimer = window.setTimeout(() => { els.toast.dataset.visible = 'false'; }, 3000);
  }

  function setSyncState(kind, label) {
    if (els.syncChip) els.syncChip.dataset.rgSyncState = kind;
    const compactLabel = { local: 'ローカル', syncing: '同期中', error: 'エラー', synced: '同期済み' }[kind] || label;
    if (els.syncLabel) els.syncLabel.textContent = compactLabel;
    if (els.syncCopy) els.syncCopy.textContent = compactLabel;
  }

  function persistLocal({ cloud = true, announce = true } = {}) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (_) {
      showToast('保存容量が不足しています。JSONを書き出してください。');
      setSyncState('error', 'SAVE ERROR');
      return false;
    }
    if (channel && announce) channel.postMessage({ type: 'state', source: currentDevice, state: clone(state) });
    if (cloud) { dirtySinceRemote = true; schedulePush(); }
    return true;
  }

  function setBinId(value) {
    const id = String(value || '').trim();
    if (id) localStorage.setItem(BIN_KEY, id); else localStorage.removeItem(BIN_KEY);
    if (window.PWAConfigSync?.syncAppBinId) window.PWAConfigSync.syncAppBinId(APP_KEY, id || null).catch(() => {});
  }

  function binId() { return localStorage.getItem(BIN_KEY) || window.PWAConfigSync?.getCachedBinId?.(APP_KEY) || ''; }
  function apiKey() { return window.PWAConfigSync?.getApiKey?.() || ''; }
  function headers(extra = {}) { return { 'X-Master-Key': apiKey(), 'Content-Type': 'application/json', ...extra }; }
  function enqueue(job) { syncQueue = syncQueue.then(job, job); return syncQueue; }

  function schedulePush() {
    clearTimeout(pushTimer);
    if (!binId()) return;
    pushTimer = window.setTimeout(() => enqueue(pushRemote), 500);
  }

  async function pushRemote() {
    if (d1Enabled()) {
      window.DTD1Runtime?.syncAppNow?.(APP_KEY);
      return;
    }
    const id = binId();
    if (!id || !dirtySinceRemote) return;
    setSyncState('syncing', 'SYNCING');
    try {
      const response = await fetch(`${BIN_URL}/${id}`, { method: 'PUT', headers: headers(), body: JSON.stringify(state), cache: 'no-store' });
      if (!response.ok) { if (response.status === 404) setBinId(''); throw new Error(`PUT ${response.status}`); }
      dirtySinceRemote = false; state.updatedAt = Math.max(Number(state.updatedAt) || 0, timestamp()); setSyncState('synced', 'SYNCED');
    } catch (error) { console.warn('RITUAL GRID sync failed', error); setSyncState('error', 'SYNC ERROR'); }
  }

  function applyRemote(remote) {
    const before = JSON.stringify(state);
    state = normalizeState(mergeStates(state, remote));
    dedupeMigratedTasks();
    if (JSON.stringify(state) !== before) { persistLocal({ cloud: false, announce: false }); renderAll(); }
  }

  async function fetchRemote() {
    if (d1Enabled()) {
      return window.DTD1Runtime?.syncAppNow?.(APP_KEY) || false;
    }
    const id = binId();
    if (!id) { setSyncState('local', 'LOCAL ONLY'); return; }
    setSyncState('syncing', 'SYNCING');
    try {
      const response = await fetch(`${BIN_URL}/${id}/latest`, { headers: { 'X-Master-Key': apiKey() }, cache: 'no-store' });
      if (!response.ok) { if (response.status === 404) setBinId(''); throw new Error(`GET ${response.status}`); }
      const payload = await response.json();
      const remote = payload?.record;
      if (!remote || remote.app !== APP_KEY) throw new Error('invalid payload');
      if (isEditorOpen()) pendingRemote = mergeStates(state, remote); else applyRemote(remote);
      setSyncState('synced', 'SYNCED');
    } catch (error) { console.warn('RITUAL GRID fetch failed', error); setSyncState('error', 'SYNC ERROR'); }
  }

  function manualSync() {
    if (d1Enabled()) { window.DTD1Runtime?.syncAppNow?.(APP_KEY); return; }
    if (!binId()) { setView('settings'); showToast('先に「接続して同期」を選んでください。'); return; }
    enqueue(async () => { await fetchRemote(); if (dirtySinceRemote) await pushRemote(); });
  }

  async function connectSync() {
    if (d1Enabled()) { manualSync(); return; }
    if (binId()) { manualSync(); return; }
    setSyncState('syncing', 'CONNECTING');
    try {
      const response = await fetch(BIN_URL, { method: 'POST', headers: headers({ 'X-Bin-Name': APP_KEY, 'X-Bin-Private': 'true' }), body: JSON.stringify(state) });
      if (!response.ok) throw new Error(`POST ${response.status}`);
      const payload = await response.json();
      const id = payload?.metadata?.id;
      if (!id) throw new Error('missing bin id');
      setBinId(id); dirtySinceRemote = false; setSyncState('synced', 'SYNCED'); showToast('端末間同期を開始しました。');
    } catch (error) { console.warn('RITUAL GRID connect failed', error); setSyncState('error', 'SYNC ERROR'); showToast('接続できませんでした。ローカル保存は続いています。'); }
  }

  function disconnectSync() { setBinId(''); dirtySinceRemote = false; setSyncState('local', 'LOCAL ONLY'); showToast('同期を解除しました。ローカルの記録は残っています。'); }

  function isEditorOpen() { return [els.dateDialog, els.memoDialog, els.taskDialog, els.confirmDialog].some((dialog) => dialog?.open); }

  function applyPendingRemote() { if (!pendingRemote) return; const remote = pendingRemote; pendingRemote = null; applyRemote(remote); }

  /* ---------- Action Log one-time migration ---------- */
  function dedupeMigratedTasks() {
    // If a migrated task (act_*) and a pre-existing task share a name (e.g. the
    // migration first ran on a fresh device and the real task synced in later),
    // fold the migrated records into the pre-existing task and tombstone the copy.
    const byName = new Map();
    Object.values(state.tasks).filter((task) => !task.deletedAt).forEach((task) => {
      if (!byName.has(task.name)) byName.set(task.name, []);
      byName.get(task.name).push(task);
    });
    let changed = false;
    byName.forEach((group) => {
      if (group.length < 2) return;
      const migrated = group.filter((task) => task.id.startsWith('act_'));
      const originals = group.filter((task) => !task.id.startsWith('act_'));
      if (!migrated.length || !originals.length) return;
      const target = originals[0];
      migrated.forEach((copy) => {
        Object.entries(state.records).forEach(([day, entry]) => {
          const source = entry?.tasks?.[copy.id];
          if (!source?.value) return;
          if (!entry.tasks) entry.tasks = {};
          if (!entry.tasks[target.id]?.value) entry.tasks[target.id] = { ...source };
          delete entry.tasks[copy.id];
        });
        copy.deletedAt = timestamp();
        copy.updatedAt = copy.deletedAt;
        copy.updatedBy = currentDevice;
        changed = true;
      });
    });
    return changed;
  }

  function runActionMigration() {
    if (localStorage.getItem(MIGRATION_KEY)) return;
    try { localStorage.setItem(IMPORT_BACKUP_KEY, JSON.stringify(state)); } catch (_) { /* best effort */ }
    const byName = new Map();
    Object.values(state.tasks).filter((task) => !task.deletedAt).forEach((task) => { if (!byName.has(task.name)) byName.set(task.name, task); });
    const idMap = {};
    let created = 0; let merged = 0; let recAdded = 0; let recSkipped = 0;
    const baseOrder = Math.max(0, ...Object.values(state.tasks).map((task) => Number(task.order) || 0)) + 1;
    const stamp = Date.now();
    ACTION_LOG_SNAPSHOT.tasks.forEach((source) => {
      const existing = byName.get(source.name);
      if (existing) { idMap[source.oldId] = existing.id; merged += 1; return; }
      const id = `act_${source.oldId}`;
      const fields = inferCadence({ name: source.name, alert: source.alert });
      state.tasks[id] = normalizeTask({
        id, name: source.name, color: source.color, order: baseOrder + source.order,
        createdAt: Date.parse('2026-05-01T00:00:00+09:00'), updatedAt: stamp, updatedBy: 'action-migration',
        category: source.color === '#10b981' ? 'animal' : 'house',
        subgroup: inferSubgroup({ name: source.name, color: source.color }),
        cadence: fields.cadence, intervalDays: fields.intervalDays, alertDays: fields.alertDays
      }, id);
      idMap[source.oldId] = id; created += 1;
    });
    ACTION_LOG_SNAPSHOT.records.forEach(([day, oldId, value]) => {
      const taskId = idMap[oldId];
      if (!taskId) { recSkipped += 1; return; }
      if (!state.records[day]) state.records[day] = {};
      if (!state.records[day].tasks) state.records[day].tasks = {};
      if (state.records[day].tasks[taskId]?.value) { recSkipped += 1; return; }
      state.records[day].tasks[taskId] = { value, updatedAt: Date.parse(`${day}T12:00:00+09:00`), updatedBy: 'action-migration' };
      recAdded += 1;
    });
    state.updatedAt = stamp;
    try { localStorage.setItem(MIGRATION_KEY, JSON.stringify({ at: stamp, created, merged, recAdded, recSkipped })); } catch (_) { /* ignore */ }
    persistLocal();
    console.info('[ritual-grid] Action Log migration', { created, merged, recAdded, recSkipped });
  }

  /* ---------- records & due engine ---------- */
  function recordFor(day, columnId) {
    const entry = state.records[day];
    return columnId === 'main' ? entry?.main : entry?.tasks?.[columnId];
  }

  function taskActiveOn(task, day) {
    if (!task || task.deletedAt) return false;
    const ranges = Array.isArray(task.activeRanges) && task.activeRanges.length ? task.activeRanges : [{ startOn: null, endOn: null }];
    return ranges.some((range) => (!range.startOn || day >= range.startOn) && (!range.endOn || day <= range.endOn));
  }

  function buildDoneIndex() {
    const index = new Map();
    Object.entries(state.records).forEach(([day, entry]) => {
      Object.entries(entry?.tasks || {}).forEach(([taskId, record]) => {
        if (!record?.value) return;
        if (!index.has(taskId)) index.set(taskId, []);
        index.get(taskId).push(day);
      });
    });
    index.forEach((days) => days.sort());
    return index;
  }

  function lastDoneBefore(index, taskId, day, { inclusive = true } = {}) {
    const days = index.get(taskId) || [];
    let found = null;
    for (const candidate of days) {
      if (candidate < day || (inclusive && candidate === day)) found = candidate;
      else break;
    }
    return found;
  }

  // Due state of a task on a given day. Returns one of:
  // done / overdue(+days) / due / soon(inDays) / idle / inactive
  function dueInfo(task, day, index) {
    if (!taskActiveOn(task, day)) return { state: 'inactive' };
    if (recordFor(day, task.id)?.value) return { state: 'done', value: recordFor(day, task.id).value };
    const last = lastDoneBefore(index, task.id, day, { inclusive: false });
    if (task.cadence === 'daily') {
      if (!last) return { state: 'due', lastDone: null };
      const missed = diffDays(last, day) - 1;
      return missed >= 1 ? { state: 'overdue', overdueDays: missed, lastDone: last } : { state: 'due', lastDone: last };
    }
    if (task.cadence === 'interval') {
      const span = Math.max(1, task.intervalDays || 1);
      if (!last) return { state: 'due', lastDone: null };
      const diff = diffDays(last, day);
      if (diff > span) return { state: 'overdue', overdueDays: diff - span, lastDone: last };
      if (diff === span) return { state: 'due', lastDone: last };
      const inDays = span - diff;
      return inDays <= 2 ? { state: 'soon', inDays, lastDone: last } : { state: 'idle', inDays, lastDone: last };
    }
    if (task.cadence === 'weekly') {
      const weekdays = task.weekdays || [];
      if (!weekdays.length) return { state: 'idle', lastDone: last };
      if (weekdays.includes(weekdayOf(day))) return { state: 'due', lastDone: last };
      for (let back = 1; back <= 7; back += 1) {
        const prev = shiftDateKey(day, -back);
        if (weekdays.includes(weekdayOf(prev)) && taskActiveOn(task, prev)) {
          if (!recordFor(prev, task.id)?.value) return { state: 'overdue', overdueDays: back, lastDone: last, missedOn: prev };
          break;
        }
      }
      for (let fwd = 1; fwd <= 7; fwd += 1) {
        const next = shiftDateKey(day, fwd);
        if (weekdays.includes(weekdayOf(next))) return fwd <= 2 ? { state: 'soon', inDays: fwd, lastDone: last } : { state: 'idle', inDays: fwd, lastDone: last };
      }
      return { state: 'idle', lastDone: last };
    }
    return { state: 'idle', lastDone: last };
  }

  function dayCounts(day) {
    const counts = { knife: 0, peach: 0, heart: 0, check: 0, total: 0 };
    Object.values(state.records[day]?.tasks || {}).forEach((record) => {
      if (record?.value && counts[record.value] !== undefined) { counts[record.value] += 1; counts.total += 1; }
    });
    return counts;
  }

  function setRecordValue(day, taskId, value) {
    const record = { value: value || null, updatedAt: timestamp(), updatedBy: currentDevice };
    if (!state.records[day]) state.records[day] = {};
    if (!state.records[day].tasks) state.records[day].tasks = {};
    state.records[day].tasks[taskId] = record;
    state.updatedAt = record.updatedAt;
    return persistLocal();
  }

  function taskVisibleInMonth(task) {
    const days = daysInMonth(viewYear, viewMonth);
    return Array.from({ length: days }, (_, index) => dateKey(viewYear, viewMonth, index + 1)).some((day) => taskActiveOn(task, day) || Boolean(recordFor(day, task.id)));
  }

  function sortedTasks({ includeArchived = true } = {}) {
    return Object.values(state.tasks).filter((task) => !task.deletedAt && (includeArchived || !task.archivedAt)).sort((a, b) => Number(a.order) - Number(b.order) || String(a.id).localeCompare(String(b.id)));
  }

  function visibleTasks() {
    return sortedTasks({ includeArchived: false })
      .filter(taskVisibleInMonth)
      .filter((task) => gridFilter === 'all' || task.category === gridFilter);
  }

  /* ---------- matrix (GRID) ---------- */
  function cellLabel(day, columnId, value, memo) {
    const columnName = columnId === 'main' ? 'サマリ' : (state.tasks[columnId]?.name || 'タスク');
    return `${dateLabel(day)} ${columnName}。現在: ${STATUS_LABELS[value] || '未記録'}${hasMemo(memo) ? '。メモあり。長押しで編集' : '。長押しでメモを編集'}`;
  }

  function statusCellHtml(day, columnId, value, extraClass = '') {
    const memo = state.memos[memoKey(day, columnId)];
    const glyph = STATUS_GLYPHS[value] || '';
    const label = cellLabel(day, columnId, value, memo);
    const columnClass = columnId === 'main' ? 'rg-main-col' : 'rg-task-col';
    return `<td class="rg-status-cell ${columnClass} ${extraClass}" data-rg-status-cell data-rg-date="${day}" data-rg-column="${escapeHtml(columnId)}" data-rg-value="${value || ''}" tabindex="0" role="button" aria-label="${escapeHtml(label)}" title="${hasMemo(memo) ? 'メモあり。長押しで編集' : '長押しでメモを編集'}"><span class="rg-status-glyph" data-rg-value="${value || ''}" aria-hidden="true">${glyph}</span>${hasMemo(memo) ? '<span class="rg-memo-dot" aria-hidden="true"></span>' : ''}</td>`;
  }

  function summaryCellHtml(day) {
    const counts = dayCounts(day);
    if (!counts.total) return `<td class="rg-main-col rg-sum-cell" data-rg-day="${day}"><span class="rg-sum-empty">—</span></td>`;
    const bar = STATUS_ORDER.filter((value) => counts[value]).map((value) => `<i class="rg-sum-seg rg-sum-${value}" style="width:${(counts[value] / counts.total) * 100}%"></i>`).join('');
    const detail = STATUS_ORDER.filter((value) => counts[value]).map((value) => `${STATUS_GLYPHS[value]}${counts[value]}`).join(' ');
    return `<td class="rg-main-col rg-sum-cell" data-rg-day="${day}" role="button" aria-label="${escapeHtml(dateLabel(day))}のサマリ。合計${counts.total}件"><span class="rg-sum-count">${counts.total}</span><span class="rg-sum-bar">${bar}</span><span class="rg-sum-detail">${detail}</span></td>`;
  }

  function taskHeaderHtml(tasks, index) {
    const today = localToday();
    const emptyTask = tasks.length ? '' : '<th class="rg-empty-task-col rg-empty-task-head" scope="col"><button type="button" data-rg-action="add-task" aria-label="タスクを追加"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg><span>TASK</span></button></th>';
    return `<tr><th class="rg-day-spacer" aria-hidden="true"></th><th class="rg-main-spacer" aria-hidden="true"></th>${tasks.map((task) => {
      const info = task.archivedAt ? { state: 'idle' } : dueInfo(task, today, index);
      const overdue = info.state === 'overdue';
      const sub = task.subgroup || CATEGORY_LABELS[task.category] || '';
      return `<th class="rg-task-col ${overdue ? 'is-overdue' : ''}" scope="col" title="${escapeHtml(task.name)}${overdue ? `（${info.overdueDays}日超過）` : ''}"><span class="rg-col-name">${headerNameHtml(task.name)}</span><span class="rg-col-sub">${escapeHtml(sub)}${overdue ? ` · +${info.overdueDays}d` : ''}</span></th>`;
    }).join('')}${emptyTask}</tr>`;
  }

  function headerNameHtml(name) {
    // keep the action word unbreakable so long names wrap before it (こむぎ/部屋んぽ), never inside it
    return escapeHtml(name).replace(/(部屋んぽ|水換え|ご飯|お散歩|掃除|消灯)/g, '<span class="rg-col-brk">$1</span>');
  }
  function fixedHeaderHtml() { return '<tr><th class="rg-day-col" scope="col"><span class="rg-col-name">DAY</span><span class="rg-col-sub">日付</span></th><th class="rg-main-col" scope="col"><span class="rg-col-name">SUM</span><span class="rg-col-sub">サマリ</span></th></tr>'; }

  function taskHeaderSpacerHtml(tasks) {
    const emptyTask = tasks.length ? '' : '<th class="rg-empty-task-col" aria-hidden="true"></th>';
    return `<tr><th class="rg-day-spacer" aria-hidden="true"></th><th class="rg-main-spacer" aria-hidden="true"></th>${tasks.map(() => '<th class="rg-task-spacer" aria-hidden="true"></th>').join('')}${emptyTask}</tr>`;
  }

  function fixedHeaderSpacerHtml() { return '<tr><th class="rg-day-spacer" aria-hidden="true"></th><th class="rg-main-spacer" aria-hidden="true"></th></tr>'; }

  function renderMatrix() {
    if (!els.matrix) return;
    const tasks = visibleTasks();
    const allActive = sortedTasks({ includeArchived: false }).filter(taskVisibleInMonth);
    if (els.gridCount) els.gridCount.textContent = `表示: ${tasks.length}/${allActive.length}列`;
    const frame = els.matrix.closest('[data-rg-matrix-frame]');
    const compact = window.matchMedia('(max-width: 480px)').matches;
    const dayW = compact ? 44 : 58; const sumW = compact ? 52 : 64; const taskW = compact ? 60 : 72;
    const contentWidth = tasks.length ? (dayW + sumW) + (tasks.length * taskW) : 302;
    if (frame) frame.style.width = `min(100%, ${Math.min(1180, contentWidth)}px)`;
    const index = buildDoneIndex();
    const days = daysInMonth(viewYear, viewMonth);
    const today = localToday();
    let body = '';
    let fixedBody = '';
    for (let day = 1; day <= days; day += 1) {
      if (day === 15) {
        body += `<tr class="rg-mid-header" aria-label="中央ヘッダー">${taskHeaderHtml(tasks, index).replace(/^<tr>|<\/tr>$/g, '')}</tr>`;
        fixedBody += `<tr class="rg-fixed-mid-header" aria-label="固定列の中央ヘッダー">${fixedHeaderHtml().replace(/^<tr>|<\/tr>$/g, '')}</tr>`;
      }
      const key = dateKey(viewYear, viewMonth, day);
      const weekday = new Date(viewYear, viewMonth - 1, day).getDay();
      const dayLabel = `${dateLabel(key)}の日付詳細を開く`;
      body += '<tr><th class="rg-day-spacer" aria-hidden="true"></th><td class="rg-main-spacer" aria-hidden="true"></td>';
      tasks.forEach((task) => { const disabled = !taskActiveOn(task, key); body += statusCellHtml(key, task.id, recordFor(key, task.id)?.value || '', disabled ? 'is-disabled' : ''); });
      if (!tasks.length) body += '<td class="rg-empty-task-col" aria-hidden="true"></td>';
      body += '</tr>';
      fixedBody += `<tr><th class="rg-day-col rg-day-cell ${key === today ? 'is-today' : ''} ${weekday === 0 || weekday === 6 ? 'is-weekend' : ''}" scope="row" data-rg-day="${key}" tabindex="0" role="button" aria-label="${escapeHtml(dayLabel)}"><span class="rg-day-number">${day}</span><span class="rg-day-week">${WEEKDAYS[weekday]}</span></th>${summaryCellHtml(key)}</tr>`;
    }
    body += `<tr class="rg-mid-header rg-end-header" aria-label="月末ヘッダー">${taskHeaderHtml(tasks, index).replace(/^<tr>|<\/tr>$/g, '')}</tr>`;
    fixedBody += `<tr class="rg-fixed-mid-header rg-fixed-end-header" aria-label="固定列の月末ヘッダー">${fixedHeaderHtml().replace(/^<tr>|<\/tr>$/g, '')}</tr>`;
    const taskColumns = tasks.map(() => '<col class="rg-task-col">').join('');
    const emptyTaskColumn = tasks.length ? '' : '<col class="rg-empty-task-col">';
    els.matrix.innerHTML = `<table class="rg-matrix-table rg-scroll-table ${tasks.length ? '' : 'is-empty'}" aria-label="${viewYear}年${viewMonth}月のタスク記録"><colgroup><col class="rg-day-spacer"><col class="rg-main-spacer">${taskColumns}${emptyTaskColumn}</colgroup><thead aria-hidden="true">${taskHeaderSpacerHtml(tasks)}</thead><tbody>${body}</tbody></table><div class="rg-fixed-rail"><table class="rg-matrix-table rg-fixed-table" aria-label="${viewYear}年${viewMonth}月の日付とサマリ"><colgroup><col class="rg-day-col"><col class="rg-main-col"></colgroup><thead aria-hidden="true">${fixedHeaderSpacerHtml()}</thead><tbody>${fixedBody}</tbody></table></div><div class="rg-task-head-rail"><table class="rg-matrix-table rg-head-table rg-task-head-table" aria-label="タスク列の固定見出し"><colgroup><col class="rg-day-spacer"><col class="rg-main-spacer">${taskColumns}${emptyTaskColumn}</colgroup><thead>${taskHeaderHtml(tasks, index)}</thead></table></div><div class="rg-corner-rail"><table class="rg-matrix-table rg-head-table rg-corner-table" aria-label="日付とサマリの固定見出し"><colgroup><col class="rg-day-col"><col class="rg-main-col"></colgroup><thead>${fixedHeaderHtml()}</thead></table></div>`;
    els.month.textContent = `${viewYear}年 ${viewMonth}月`;
    els.month.setAttribute('aria-label', `${viewYear}年${viewMonth}月。タップで今月へ戻る`);
    $$('[data-rg-day]').forEach((cell) => cell.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDate(cell.dataset.rgDay, cell); }
    }));
    $$('[data-rg-status-cell]').forEach(bindStatusCell);
  }

  function updateStatus(day, columnId, sourceCell) {
    if (columnId === 'main') return;
    const current = recordFor(day, columnId)?.value || '';
    const next = cycleValue(current);
    if (!setRecordValue(day, columnId, next)) return;
    if (sourceCell) {
      sourceCell.dataset.rgValue = next;
      const glyph = sourceCell.querySelector('.rg-status-glyph');
      if (glyph) { glyph.dataset.rgValue = next; glyph.textContent = STATUS_GLYPHS[next]; }
      sourceCell.setAttribute('aria-label', cellLabel(day, columnId, next, state.memos[memoKey(day, columnId)]));
    }
    refreshSummaryCell(day);
    updateDetailIfOpen();
  }

  function refreshSummaryCell(day) {
    $$(`.rg-sum-cell[data-rg-day="${day}"]`).forEach((cell) => {
      const template = document.createElement('tbody');
      template.innerHTML = summaryCellHtml(day);
      const fresh = template.firstElementChild;
      if (fresh) cell.replaceWith(fresh);
    });
  }

  function bindStatusCell(cell) {
    let timer = 0;
    let pointerStart = null;
    let longPressed = false;
    const day = cell.dataset.rgDate;
    const columnId = cell.dataset.rgColumn;
    const cancel = () => { clearTimeout(timer); timer = 0; pointerStart = null; cell.classList.remove('is-pressing'); };
    const start = (event) => {
      if (cell.classList.contains('is-disabled') || (event.pointerType === 'mouse' && event.button !== 0)) return;
      pointerStart = { x: event.clientX, y: event.clientY, time: performance.now() }; longPressed = false; cell.classList.add('is-pressing');
      timer = window.setTimeout(() => { if (!pointerStart) return; longPressed = true; cell.classList.remove('is-pressing'); if (navigator.vibrate) navigator.vibrate(10); openMemo(day, columnId, cell); }, HOLD_MS);
    };
    const move = (event) => { if (!pointerStart) return; const distance = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y); if (distance > MOVE_LIMIT) cancel(); };
    const end = (event) => {
      if (!pointerStart) return;
      const duration = performance.now() - pointerStart.time;
      const distance = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
      const action = longPressed ? 'long-press' : classifyPress(duration, distance);
      if (action === 'tap') updateStatus(day, columnId, cell);
      cancel();
    };
    cell.addEventListener('pointerdown', start);
    cell.addEventListener('pointermove', move);
    cell.addEventListener('pointerup', end);
    cell.addEventListener('pointercancel', cancel);
    cell.addEventListener('pointerleave', (event) => { if (event.pointerType === 'mouse') cancel(); });
    cell.addEventListener('contextmenu', (event) => event.preventDefault());
    cell.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (cell.classList.contains('is-disabled')) return; if (event.shiftKey) openMemo(day, columnId, cell); else updateStatus(day, columnId, cell); }
    });
  }

  /* ---------- date detail sheet ---------- */
  function openDate(day, source) {
    activeDate = day; focusAfterClose = source || null; if (els.dateTitle) els.dateTitle.textContent = dateLabel(day); renderDateDetail(); showDialog(els.dateDialog); }

  function detailRowHtml(day, columnId, name) {
    const record = recordFor(day, columnId); const memo = state.memos[memoKey(day, columnId)]; const value = record?.value || '';
    return `<div class="rg-detail-row"><div class="rg-detail-label">${escapeHtml(name)}${hasMemo(memo) ? '<span class="rg-detail-note">  • メモあり</span>' : ''}</div>${statusCellHtml(day, columnId, value).replace('<td ', '<div ').replace('</td>', '</div>')}</div>`;
  }

  function renderDateDetail() {
    if (!els.detailList || !activeDate) return;
    const counts = dayCounts(activeDate);
    if (els.detailSummary) {
      els.detailSummary.textContent = counts.total
        ? STATUS_ORDER.filter((value) => counts[value]).map((value) => `${STATUS_GLYPHS[value]} ${counts[value]}`).join(' · ') + ` — 合計 ${counts.total}件`
        : 'この日の記録はまだありません';
    }
    const tasks = sortedTasks({ includeArchived: true }).filter((task) => taskActiveOn(task, activeDate) || Boolean(recordFor(activeDate, task.id)));
    els.detailList.innerHTML = tasks.map((task) => detailRowHtml(activeDate, task.id, task.name)).join('');
    els.detailList.querySelectorAll('[data-rg-status-cell]').forEach(bindStatusCell);
  }

  function updateDetailIfOpen() { if (els.dateDialog?.open) renderDateDetail(); }

  /* ---------- memo ---------- */
  function openMemo(day, columnId, source) {
    const existing = state.memos[memoKey(day, columnId)];
    activeMemo = { day, columnId }; focusAfterClose = source || document.activeElement;
    if (els.memoContext) els.memoContext.textContent = `${dateLabel(day)} · ${columnId === 'main' ? 'サマリ' : state.tasks[columnId]?.name || 'タスク'}`;
    if (els.memoInput) { els.memoInput.value = hasMemo(existing) ? existing.text : ''; els.memoInput.setSelectionRange(els.memoInput.value.length, els.memoInput.value.length); }
    showDialog(els.memoDialog); window.setTimeout(() => els.memoInput?.focus({ preventScroll: true }), 40);
  }

  function saveMemo(remove = false) {
    if (!activeMemo) return;
    const text = remove ? '' : (els.memoInput?.value || ''); const stamp = timestamp();
    state = setMemo(state, activeMemo.day, activeMemo.columnId, text, { updatedAt: stamp, updatedBy: currentDevice }); state.updatedAt = stamp;
    if (!persistLocal()) return;
    closeDialog(els.memoDialog); renderAll(); showToast(remove ? 'メモを削除しました。' : text.trim() ? 'メモを保存しました。' : 'メモを空にしました。');
  }

  function showDialog(dialog) { if (!dialog) return; if (!dialog.open) { try { dialog.showModal(); } catch (_) { dialog.setAttribute('open', ''); } } }
  function closeDialog(dialog) {
    if (!dialog) return;
    if (dialog.open) dialog.close(); else dialog.removeAttribute('open');
    if (dialog === els.memoDialog) activeMemo = null;
    if (![els.dateDialog, els.memoDialog, els.taskDialog, els.confirmDialog].some((item) => item?.open)) { applyPendingRemote(); const target = focusAfterClose; focusAfterClose = null; if (target?.isConnected) target.focus({ preventScroll: true }); }
  }

  /* ---------- task dialog / CRUD ---------- */
  function renderWeekdayChips() {
    if (!els.taskWeekdays) return;
    els.taskWeekdays.innerHTML = WEEKDAYS.map((label, day) => `<button type="button" class="rg-chip ${dialogWeekdays.has(day) ? 'is-active' : ''}" data-rg-weekday="${day}" aria-pressed="${dialogWeekdays.has(day)}">${label}</button>`).join('');
  }

  function renderTaskHistory(taskId) {
    if (!els.taskHistory) return;
    if (!taskId || !state.tasks[taskId]) { els.taskHistory.hidden = true; els.taskHistory.innerHTML = ''; return; }
    const today = localToday();
    const index = buildDoneIndex();
    const doneList = index.get(taskId) || [];
    let cells = '';
    for (let back = 29; back >= 0; back -= 1) {
      const day = shiftDateKey(today, -back);
      const value = recordFor(day, taskId)?.value || '';
      cells += `<span class="rg-hist-cell" data-value="${value}" title="${day}${value ? ` ${STATUS_LABELS[value]}` : ''}">${value ? STATUS_GLYPHS[value] : ''}</span>`;
    }
    const total = doneList.filter((day) => diffDays(day, today) < 30 && day <= today).length;
    els.taskHistory.hidden = false;
    els.taskHistory.innerHTML = `<span class="rg-hist-label">過去30日 · ${total}回</span><div class="rg-hist-row">${cells}</div>`;
  }

  function syncCadenceFields() {
    const cadence = els.taskCadence?.value || 'ad_hoc';
    const intervalField = root.querySelector('[data-rg-interval-field]');
    const weekdayField = root.querySelector('[data-rg-weekday-field]');
    if (intervalField) intervalField.style.display = cadence === 'interval' ? '' : 'none';
    if (weekdayField) weekdayField.style.display = cadence === 'weekly' ? '' : 'none';
  }

  function openTask(taskId = '') {
    const task = taskId ? state.tasks[taskId] : null;
    if (els.taskId) els.taskId.value = task?.id || '';
    if (els.taskName) els.taskName.value = task?.name || '';
    if (els.taskColor) els.taskColor.value = task?.color || '#7dd3fc';
    if (els.taskNote) els.taskNote.value = task?.note || '';
    if (els.taskCategory) els.taskCategory.value = task?.category || 'animal';
    if (els.taskSubgroup) els.taskSubgroup.value = task?.subgroup || '';
    if (els.taskCadence) els.taskCadence.value = task?.cadence || 'ad_hoc';
    if (els.taskInterval) els.taskInterval.value = task?.intervalDays || 7;
    if (els.taskAlert) els.taskAlert.value = task?.alertDays ?? 0;
    dialogWeekdays = new Set(task?.weekdays || []);
    renderWeekdayChips(); syncCadenceFields(); renderTaskHistory(task?.id || '');
    if (els.taskError) els.taskError.textContent = '';
    if (els.taskDialogTitle) els.taskDialogTitle.textContent = task ? 'タスクを編集' : 'タスクを追加';
    showDialog(els.taskDialog); window.setTimeout(() => els.taskName?.focus({ preventScroll: true }), 40);
  }

  function saveTask(event) {
    event.preventDefault();
    const name = (els.taskName?.value || '').trim();
    if (!name) { if (els.taskError) els.taskError.textContent = 'タスク名を入力してください。'; els.taskName?.focus(); return; }
    const cadence = els.taskCadence?.value || 'ad_hoc';
    if (cadence === 'weekly' && !dialogWeekdays.size) { if (els.taskError) els.taskError.textContent = '曜日指定では曜日を1つ以上選んでください。'; return; }
    const id = els.taskId?.value || makeId('task'); const old = state.tasks[id]; const stamp = timestamp();
    state.tasks[id] = {
      ...(old || { id, createdAt: stamp, order: Object.keys(state.tasks).length }),
      id, name,
      color: els.taskColor?.value || '#7dd3fc',
      note: (els.taskNote?.value || '').trim().slice(0, 500),
      category: els.taskCategory?.value === 'house' ? 'house' : 'animal',
      subgroup: (els.taskSubgroup?.value || '').trim().slice(0, 40),
      cadence,
      intervalDays: Math.min(365, Math.max(1, Number(els.taskInterval?.value) || 7)),
      weekdays: [...dialogWeekdays].sort(),
      alertDays: Math.min(365, Math.max(0, Number(els.taskAlert?.value) || 0)),
      updatedAt: stamp, updatedBy: currentDevice, archivedAt: old?.archivedAt || null, deletedAt: null,
      activeRanges: old?.activeRanges || [{ startOn: null, endOn: null }]
    };
    state.updatedAt = stamp; if (!persistLocal()) return; closeDialog(els.taskDialog); renderAll(); showToast(old ? 'タスクを更新しました。' : 'タスクを登録しました。');
  }

  function archiveTask(taskId, restore = false) {
    const task = state.tasks[taskId]; if (!task) return; const stamp = timestamp(); const today = localToday();
    if (restore) { task.archivedAt = null; task.activeRanges = [...(task.activeRanges || []), { startOn: today, endOn: null }]; } else { task.archivedAt = stamp; const ranges = [...(task.activeRanges || [{ startOn: null, endOn: null }])]; const open = ranges[ranges.length - 1]; if (open && !open.endOn) open.endOn = shiftDateKey(today, -1); }
    task.updatedAt = stamp; task.updatedBy = currentDevice; state.updatedAt = stamp; persistLocal(); renderAll(); showToast(restore ? 'タスクを復元しました。' : 'タスクをアーカイブしました。');
  }

  function deleteTask(taskId) { const task = state.tasks[taskId]; if (!task) return; const stamp = timestamp(); task.deletedAt = stamp; task.updatedAt = stamp; task.updatedBy = currentDevice; state.updatedAt = stamp; persistLocal(); renderAll(); showToast('タスクを削除しました。'); }

  function moveTask(taskId, direction) {
    const tasks = sortedTasks({ includeArchived: true }); const index = tasks.findIndex((task) => task.id === taskId); const swap = tasks[index + direction]; if (!swap) return; const stamp = timestamp(); const order = tasks[index].order; tasks[index].order = swap.order; swap.order = order; tasks[index].updatedAt = stamp; tasks[index].updatedBy = currentDevice; swap.updatedAt = stamp; swap.updatedBy = currentDevice; state.updatedAt = stamp; persistLocal(); renderTasks();
  }

  /* ---------- MANAGE ---------- */
  function cadenceText(task) {
    if (task.cadence === 'interval') return `間隔 ${task.intervalDays}日`;
    if (task.cadence === 'weekly') return `曜日 ${(task.weekdays || []).map((d) => WEEKDAYS[d]).join('・') || '未設定'}`;
    return CADENCE_LABELS[task.cadence] || '不定期';
  }

  function renderTasks() {
    const all = sortedTasks({ includeArchived: true });
    if (els.taskSummary) els.taskSummary.textContent = `有効 ${all.filter((task) => !task.archivedAt).length} · 保留 ${all.filter((task) => task.archivedAt).length}`;
    if (!els.taskList) return;
    const query = manageQuery.trim();
    const tasks = all.filter((task) => {
      if (manageFilter === 'archived') { if (!task.archivedAt) return false; }
      else if (manageFilter !== 'all' && task.category !== manageFilter) return false;
      if (query && !task.name.includes(query) && !(task.subgroup || '').includes(query)) return false;
      return true;
    });
    if (!tasks.length) {
      els.taskList.innerHTML = all.length
        ? '<div class="rg-task-empty"><p>条件に合うタスクがありません。</p></div>'
        : '<div class="rg-task-empty"><button type="button" class="rg-primary-button" data-rg-action="add-task" data-rg-four-edge><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>タスクを追加</span></button></div>';
      return;
    }
    els.taskList.innerHTML = tasks.map((task) => `<article class="rg-task-row ${task.archivedAt ? 'is-archived' : ''}" style="--rg-task-color:${escapeHtml(task.color)}" data-rg-task-row="${escapeHtml(task.id)}" draggable="true" data-rg-four-edge><button type="button" class="rg-task-drag" data-rg-task-action="focus" data-rg-task-id="${escapeHtml(task.id)}" aria-label="${escapeHtml(task.name)}を並べ替え"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="7" r="1"></circle><circle cx="16" cy="7" r="1"></circle><circle cx="8" cy="12" r="1"></circle><circle cx="16" cy="12" r="1"></circle><circle cx="8" cy="17" r="1"></circle><circle cx="16" cy="17" r="1"></circle></svg></button><div><span class="rg-task-name"><span class="rg-task-color" style="background:${escapeHtml(task.color)};color:${escapeHtml(task.color)}"></span>${escapeHtml(task.name)}</span><span class="rg-task-sub">${task.archivedAt ? '保留' : '有効'} · ${CATEGORY_LABELS[task.category] || ''}${task.subgroup ? ` · ${escapeHtml(task.subgroup)}` : ''} · ${cadenceText(task)}</span></div><div class="rg-task-actions"><button type="button" data-rg-task-action="up" data-rg-task-id="${escapeHtml(task.id)}" aria-label="${escapeHtml(task.name)}を上へ"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 14 5-5 5 5"></path></svg></button><button type="button" data-rg-task-action="down" data-rg-task-id="${escapeHtml(task.id)}" aria-label="${escapeHtml(task.name)}を下へ"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"></path></svg></button><button type="button" data-rg-task-action="edit" data-rg-task-id="${escapeHtml(task.id)}" aria-label="${escapeHtml(task.name)}を編集">編集</button><button type="button" data-rg-task-action="${task.archivedAt ? 'restore' : 'archive'}" data-rg-task-id="${escapeHtml(task.id)}" aria-label="${escapeHtml(task.name)}を${task.archivedAt ? '復元' : '保留'}">${task.archivedAt ? '復元' : '保留'}</button><button type="button" data-rg-task-action="delete" data-rg-task-id="${escapeHtml(task.id)}" aria-label="${escapeHtml(task.name)}を削除"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"></path></svg></button></div></article>`).join('');
  }

  /* ---------- TODAY ---------- */
  function todayRowHtml(task, info, day) {
    const current = recordFor(day, task.id)?.value || '';
    const meta = [];
    if (info.state === 'overdue') meta.push(`<span class="rg-tmeta-over">+${info.overdueDays > 99 ? '99+' : info.overdueDays}d 超過</span>`);
    if (info.lastDone) meta.push(`前回 ${dateLabel(info.lastDone, { weekday: undefined })}`);
    else if (info.state !== 'done') meta.push('記録なし');
    if (task.cadence === 'interval') meta.push(`${task.intervalDays}日ごと`);
    if (task.cadence === 'weekly') meta.push((task.weekdays || []).map((d) => WEEKDAYS[d]).join('・'));
    const buttons = ['knife', 'peach', 'heart'].map((value) => `<button type="button" class="rg-rec-btn ${current === value ? 'is-active' : ''}" data-rg-record data-rg-task="${escapeHtml(task.id)}" data-rg-value="${value}" aria-pressed="${current === value}" aria-label="${escapeHtml(task.name)}を${STATUS_LABELS[value]}で記録">${STATUS_GLYPHS[value]}</button>`).join('');
    return `<div class="rg-trow" data-cat="${task.category}"><span class="rg-trow-dot" style="background:${escapeHtml(task.color)}"></span><div class="rg-trow-info"><span class="rg-trow-name">${escapeHtml(task.name)}</span><span class="rg-trow-meta">${meta.join(' · ')}</span></div><div class="rg-trow-btns">${buttons}</div></div>`;
  }

  function renderToday() {
    if (!els.todayTelemetry || !els.todayMain) return;
    const day = todayDate;
    const isToday = day === localToday();
    const index = buildDoneIndex();
    const tasks = sortedTasks({ includeArchived: false }).filter((task) => taskActiveOn(task, day));
    const buckets = { overdue: [], due: [], soon: [], adhoc: [], done: [] };
    tasks.forEach((task) => {
      const info = dueInfo(task, day, index);
      if (info.state === 'done') buckets.done.push([task, info]);
      else if (info.state === 'overdue') buckets.overdue.push([task, info]);
      else if (info.state === 'due') buckets.due.push([task, info]);
      else if (info.state === 'soon') buckets.soon.push([task, info]);
      else if (task.cadence === 'ad_hoc') buckets.adhoc.push([task, info]);
    });
    buckets.overdue.sort((a, b) => a[1].overdueDays - b[1].overdueDays);
    const inSegment = ([task]) => todaySegment === 'all' || task.category === todaySegment;
    const dueCount = buckets.overdue.filter(inSegment).length + buckets.due.filter(inSegment).length;
    const doneCount = buckets.done.filter(inSegment).length;
    const denom = dueCount + doneCount;
    const pct = denom ? Math.round((doneCount / denom) * 100) : 100;
    const counts = dayCounts(day);
    const barTotal = Math.max(1, counts.total);
    const bar = STATUS_ORDER.filter((value) => counts[value]).map((value) => `<i class="rg-sum-seg rg-sum-${value}" style="width:${(counts[value] / barTotal) * 100}%"></i>`).join('');
    els.todayTelemetry.innerHTML = `
      <div class="rg-tele-nav">
        <button type="button" class="rg-icon-button" data-rg-today-nav="prev" data-rg-four-edge aria-label="前日"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5-7 7 7 7"/></svg></button>
        <button type="button" class="rg-tele-date" data-rg-today-nav="today" data-rg-four-edge>${dateLabel(day)}${isToday ? '' : '（今日へ）'}</button>
        <button type="button" class="rg-icon-button" data-rg-today-nav="next" data-rg-four-edge aria-label="翌日"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 5 7 7-7 7"/></svg></button>
      </div>
      <div class="rg-tele-score"><span class="rg-tele-pct">${pct}<small>%</small></span><span class="rg-tele-frac">${doneCount}/${denom} 完了</span></div>
      <div class="rg-tele-counts">${STATUS_ORDER.map((value) => `<span class="rg-tele-count rg-sum-${value}-text">${STATUS_GLYPHS[value]} ${counts[value]}</span>`).join('')}</div>
      <div class="rg-tele-bar rg-sum-bar">${bar || '<i class="rg-sum-seg rg-sum-none" style="width:100%"></i>'}</div>`;

    const section = (title, items, { open = true, cls = '' } = {}) => {
      if (!items.length) return '';
      const rows = items.map(([task, info]) => todayRowHtml(task, info, day)).join('');
      if (open) return `<div class="rg-tsec ${cls}"><h3 class="rg-tsec-title">${title}<span>${items.length}</span></h3><div class="rg-tlist">${rows}</div></div>`;
      return `<details class="rg-tsec ${cls}"><summary class="rg-tsec-title">${title}<span>${items.length}</span></summary><div class="rg-tlist">${rows}</div></details>`;
    };
    const groupedSection = (title, items) => {
      if (!items.length) return '';
      if (items.length < 16) return section(title, items);
      const groups = new Map();
      items.forEach((item) => {
        const key = item[0].subgroup || CATEGORY_LABELS[item[0].category] || 'その他';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      });
      const inner = [...groups.entries()].map(([key, group]) => `<details class="rg-tgroup"><summary>${escapeHtml(key)}<span>${group.length}</span></summary><div class="rg-tlist">${group.map(([task, info]) => todayRowHtml(task, info, day)).join('')}</div></details>`).join('');
      return `<div class="rg-tsec"><h3 class="rg-tsec-title">${title}<span>${items.length}</span></h3>${inner}</div>`;
    };
    const chips = [['all', 'すべて'], ['animal', '生き物'], ['house', '家事']].map(([value, label]) => `<button type="button" class="rg-chip ${todaySegment === value ? 'is-active' : ''}" data-rg-today-segment="${value}" data-rg-four-edge>${label}</button>`).join('');
    els.todayMain.innerHTML = `
      <div class="rg-chip-row rg-today-chips">${chips}</div>
      ${section('期限超過', buckets.overdue.filter(inSegment), { cls: 'is-over' })}
      ${groupedSection(isToday ? '今日が期限' : 'この日が期限', buckets.due.filter(inSegment))}
      ${section('近日', buckets.soon.filter(inSegment), { open: false })}
      ${section('いつでも', buckets.adhoc.filter(inSegment), { open: false })}
      ${section('完了済み', buckets.done.filter(inSegment), { open: false, cls: 'is-done' })}
      ${!denom && !buckets.adhoc.filter(inSegment).length ? '<p class="rg-today-empty">この日の期限タスクはありません。</p>' : ''}`;
  }

  /* ---------- PULSE ---------- */
  function renderPulse() {
    if (!els.pulseShell) return;
    const index = buildDoneIndex();
    const today = localToday();
    const daysTotal = daysInMonth(viewYear, viewMonth);
    const lastDay = dateKey(viewYear, viewMonth, daysTotal) > today && viewYear === nowDate.getFullYear() && viewMonth === nowDate.getMonth() + 1
      ? today
      : dateKey(viewYear, viewMonth, daysTotal);
    const tasks = sortedTasks({ includeArchived: false });
    let dueTotal = 0; let doneTotal = 0;
    const monthCounts = { knife: 0, peach: 0, heart: 0, check: 0 };
    const catStats = { animal: { due: 0, done: 0 }, house: { due: 0, done: 0 } };
    for (let d = 1; d <= daysTotal; d += 1) {
      const day = dateKey(viewYear, viewMonth, d);
      if (day > lastDay) break;
      const counts = dayCounts(day);
      STATUS_ORDER.forEach((value) => { monthCounts[value] += counts[value]; });
      tasks.forEach((task) => {
        if (!taskActiveOn(task, day) || task.cadence === 'ad_hoc') return;
        const info = dueInfo(task, day, index);
        if (info.state === 'done' || info.state === 'due' || info.state === 'overdue') {
          dueTotal += 1;
          catStats[task.category].due += 1;
          if (info.state === 'done') { doneTotal += 1; catStats[task.category].done += 1; }
        }
      });
    }
    const pct = dueTotal ? Math.round((doneTotal / dueTotal) * 100) : 100;
    const splitTotal = Math.max(1, monthCounts.knife + monthCounts.heart + monthCounts.peach + monthCounts.check);
    const bar = STATUS_ORDER.filter((value) => monthCounts[value]).map((value) => `<i class="rg-sum-seg rg-sum-${value}" style="width:${(monthCounts[value] / splitTotal) * 100}%"></i>`).join('');
    const circumference = 2 * Math.PI * 34;
    const overdueNow = tasks
      .map((task) => [task, dueInfo(task, today, index)])
      .filter(([, info]) => info.state === 'overdue')
      .sort((a, b) => b[1].overdueDays - a[1].overdueDays);
    const catRow = (key, label) => {
      const s = catStats[key];
      const p = s.due ? Math.round((s.done / s.due) * 100) : 100;
      return `<div class="rg-pulse-cat"><span class="rg-pulse-cat-label">${label}</span><span class="rg-pulse-cat-bar"><i style="width:${p}%"></i></span><span class="rg-pulse-cat-num">${s.done}/${s.due} · ${p}%</span></div>`;
    };

    els.pulseShell.innerHTML = `
      <div class="rg-pulse-head">
        <button type="button" class="rg-icon-button" data-rg-action="prev-month" data-rg-four-edge aria-label="前月"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5-7 7 7 7"/></svg></button>
        <span class="rg-pulse-month">${viewYear}年 ${viewMonth}月</span>
        <button type="button" class="rg-icon-button" data-rg-action="next-month" data-rg-four-edge aria-label="翌月"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 5 7 7-7 7"/></svg></button>
      </div>
      <div class="rg-pulse-grid">
        <div class="rg-pulse-card rg-pulse-main">
          <svg class="rg-ring" viewBox="0 0 84 84" aria-hidden="true"><circle class="rg-ring-bg" cx="42" cy="42" r="34"/><circle class="rg-ring-fg" cx="42" cy="42" r="34" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference * (1 - pct / 100)}"/></svg>
          <div class="rg-pulse-main-text"><span class="rg-pulse-pct">${pct}<small>%</small></span><span class="rg-pulse-sub">期限内ケア率 · ${doneTotal}/${dueTotal}</span></div>
        </div>
        <div class="rg-pulse-card">
          <h3>分担（今月）</h3>
          <div class="rg-sum-bar rg-pulse-bar">${bar || '<i class="rg-sum-seg rg-sum-none" style="width:100%"></i>'}</div>
          <div class="rg-pulse-counts">${STATUS_ORDER.map((value) => `<span class="rg-sum-${value}-text">${STATUS_GLYPHS[value]} ${monthCounts[value]}</span>`).join('')}</div>
          ${catRow('animal', '生き物')}
          ${catRow('house', '家事')}
        </div>
        <div class="rg-pulse-card rg-pulse-over">
          <h3>いま期限超過 <span>${overdueNow.length}</span></h3>
          ${overdueNow.length ? `<div class="rg-pulse-over-list">${overdueNow.map(([task, info]) => `<button type="button" class="rg-over-row" data-rg-jump-today data-rg-four-edge><span class="rg-trow-dot" style="background:${escapeHtml(task.color)}"></span><span class="rg-over-name">${escapeHtml(task.name)}</span><span class="rg-tmeta-over">+${info.overdueDays > 99 ? '99+' : info.overdueDays}d</span></button>`).join('')}</div>` : '<p class="rg-pulse-none">超過はありません。</p>'}
        </div>
      </div>`;
  }

  function renderHeat() {
    if (!els.heatShell) return;
    const today = localToday();
    // daily record counts for the last 26 weeks (Sunday-start columns)
    const heatStart = shiftDateKey(today, -weekdayOf(today) - 25 * 7);
    const heatCounts = [];
    let heatMax = 1;
    let totalRecords = 0;
    let activeDays = 0;
    for (let i = 0; i < 182; i += 1) {
      const day = shiftDateKey(heatStart, i);
      const count = day <= today ? dayCounts(day).total : -1;
      heatCounts.push([day, count]);
      if (count > heatMax) heatMax = count;
      if (count > 0) { activeDays += 1; totalRecords += count; }
    }
    let longest = 0;
    let run = 0;
    let current = 0;
    heatCounts.forEach(([, count]) => {
      if (count > 0) { run += 1; if (run > longest) longest = run; } else if (count === 0) run = 0;
    });
    for (let i = heatCounts.length - 1; i >= 0; i -= 1) {
      const count = heatCounts[i][1];
      if (count > 0) current += 1;
      else if (count === 0) break;
    }
    const heatCells = heatCounts.map(([day, count]) => {
      if (count < 0) return '<span class="rg-heat-cell is-future" aria-hidden="true"></span>';
      const level = count === 0 ? 0 : Math.max(1, Math.ceil((count / heatMax) * 4));
      return `<button type="button" class="rg-heat-cell" data-rg-day="${day}" data-level="${level}" title="${day} · ${count}件" aria-label="${day} ${count}件"></button>`;
    }).join('');
    const stat = (label, value, unit) => `<div class="rg-heat-stat"><span class="rg-heat-stat-value">${value}<small>${unit}</small></span><span class="rg-heat-stat-label">${label}</span></div>`;
    els.heatShell.innerHTML = `
      <div class="rg-heat-head"><span class="rg-pulse-month">記録ヒートマップ</span><span class="rg-heat-range">${heatStart} 〜 ${today}</span></div>
      <div class="rg-heat-stats">${stat('記録した日', activeDays, '日')}${stat('合計記録', totalRecords, '件')}${stat('現在の連続', current, '日')}${stat('最長連続', longest, '日')}</div>
      <div class="rg-pulse-card rg-pulse-heat">
        <div class="rg-heat-grid">${heatCells}</div>
        <div class="rg-heat-legend"><span>少</span><i data-level="0"></i><i data-level="1"></i><i data-level="2"></i><i data-level="3"></i><i data-level="4"></i><span>多</span></div>
        <p class="rg-heat-note">マスをタップするとその日の詳細が開きます。</p>
      </div>`;
  }

  /* ---------- views ---------- */
  function setView(view) {
    activeView = ['today', 'log', 'pulse', 'heat', 'tasks', 'settings'].includes(view) ? view : 'today';
    try { localStorage.setItem(VIEW_KEY, activeView); } catch (_) { /* ignore */ }
    $$('[data-rg-view]').forEach((section) => { section.hidden = section.dataset.rgView !== activeView; });
    $$('[data-rg-tab]').forEach((tab) => { tab.classList.toggle('is-active', tab.dataset.rgTab === activeView); tab.setAttribute('aria-selected', String(tab.dataset.rgTab === activeView)); });
    if (activeView === 'log') renderMatrix();
    if (activeView === 'tasks') renderTasks();
    if (activeView === 'today') renderToday();
    if (activeView === 'pulse') renderPulse();
    if (activeView === 'heat') renderHeat();
  }
  function renderAll() {
    if (activeView === 'log') renderMatrix();
    if (activeView === 'tasks') renderTasks();
    if (activeView === 'today') renderToday();
    if (activeView === 'pulse') renderPulse();
    if (activeView === 'heat') renderHeat();
    if (els.dateDialog?.open) renderDateDetail();
  }

  function openConfirm(title, copy, action) { confirmAction = action; if (els.confirmTitle) els.confirmTitle.textContent = title; if (els.confirmCopy) els.confirmCopy.textContent = copy; showDialog(els.confirmDialog); }

  /* ---------- exports ---------- */
  function downloadBlob(blob, filename) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = filename; link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  }

  function exportJson() { downloadBlob(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }), `ritual_grid_${viewYear}-${pad(viewMonth)}.json`); showToast('JSONを書き出しました。'); }

  function exportCsv() {
    const tasks = sortedTasks({ includeArchived: false }).filter(taskVisibleInMonth);
    const glyph = (value) => STATUS_GLYPHS[value] || '';
    const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const lines = [['日付', '合計', '🔪', '🍑', '♡', '✓', ...tasks.map((task) => task.name)].map(quote).join(',')];
    const days = daysInMonth(viewYear, viewMonth);
    for (let d = 1; d <= days; d += 1) {
      const day = dateKey(viewYear, viewMonth, d);
      const counts = dayCounts(day);
      lines.push([day, counts.total, counts.knife, counts.peach, counts.heart, counts.check, ...tasks.map((task) => glyph(recordFor(day, task.id)?.value || ''))].map(quote).join(','));
    }
    downloadBlob(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv' }), `ritual_grid_${viewYear}-${pad(viewMonth)}.csv`);
    showToast('CSVを書き出しました。');
  }

  function buildExportTable() {
    const tasks = sortedTasks({ includeArchived: false }).filter(taskVisibleInMonth);
    const days = daysInMonth(viewYear, viewMonth);
    const cell = (content, extra = '') => `<td style="border:1px solid #26303c;padding:4px 2px;text-align:center;font-size:11px;${extra}">${content}</td>`;
    let html = `<div style="background:#0b0e11;color:#eef4f8;padding:16px;font-family:sans-serif;width:max-content"><div style="font-size:15px;font-weight:700;margin-bottom:10px">RITUAL GRID — ${viewYear}年${viewMonth}月</div><table style="border-collapse:collapse"><tr><th style="border:1px solid #26303c;padding:4px 6px;font-size:11px">日</th><th style="border:1px solid #26303c;padding:4px 6px;font-size:11px">計</th>${tasks.map((task) => `<th style="border:1px solid #26303c;padding:4px 3px;font-size:10px;max-width:64px">${escapeHtml(task.name)}</th>`).join('')}</tr>`;
    for (let d = 1; d <= days; d += 1) {
      const day = dateKey(viewYear, viewMonth, d);
      const counts = dayCounts(day);
      html += `<tr>${cell(`${d}`)}${cell(counts.total || '')}${tasks.map((task) => cell(STATUS_GLYPHS[recordFor(day, task.id)?.value || ''] || '')).join('')}</tr>`;
    }
    html += '</table></div>';
    return html;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src; script.onload = resolve; script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function exportImage(asPdf) {
    if (!els.exportStage) return;
    showToast('画像を生成しています…');
    try {
      if (!window.html2canvas) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
      els.exportStage.innerHTML = buildExportTable();
      const target = els.exportStage.firstElementChild;
      const canvas = await window.html2canvas(target, { backgroundColor: '#0b0e11', scale: 2 });
      els.exportStage.innerHTML = '';
      const filename = `ritual_grid_${viewYear}-${pad(viewMonth)}`;
      if (!asPdf) {
        canvas.toBlob((blob) => { if (blob) downloadBlob(blob, `${filename}.png`); showToast('PNGを書き出しました。'); }, 'image/png');
        return;
      }
      if (!window.jspdf) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
      const { jsPDF } = window.jspdf;
      const landscape = canvas.width >= canvas.height;
      const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth(); const pageH = pdf.internal.pageSize.getHeight();
      const scale = Math.min(pageW / canvas.width, pageH / canvas.height);
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', (pageW - canvas.width * scale) / 2, 12, canvas.width * scale, canvas.height * scale);
      pdf.save(`${filename}.pdf`);
      showToast('PDFを書き出しました。');
    } catch (error) {
      console.warn('export failed', error);
      if (els.exportStage) els.exportStage.innerHTML = '';
      showToast('書き出しに失敗しました。通信環境を確認してください。');
    }
  }

  async function importJson(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()); if (!parsed || parsed.app !== APP_KEY || typeof parsed.tasks !== 'object' || typeof parsed.records !== 'object' || typeof parsed.memos !== 'object') throw new Error('invalid import');
      localStorage.setItem(IMPORT_BACKUP_KEY, JSON.stringify(state)); state = normalizeState(parsed); state.deviceId = currentDevice; state.updatedAt = timestamp(); if (!persistLocal()) return; renderAll(); showToast('JSONを読み込みました。');
    } catch (_) { showToast('JSONを読み込めませんでした。現在の記録は変更していません。'); }
    if (els.importInput) els.importInput.value = '';
  }

  function restoreBackup() { const raw = localStorage.getItem(IMPORT_BACKUP_KEY); if (!raw) { showToast('直前のバックアップはありません。'); return; } openConfirm('直前のバックアップを復元', '現在の状態を、最後のJSON読み込み直前へ戻します。', () => { try { state = normalizeState(JSON.parse(raw)); state.updatedAt = timestamp(); persistLocal(); renderAll(); showToast('バックアップを復元しました。'); } catch (_) { showToast('バックアップを復元できませんでした。'); } }); }

  /* ---------- events ---------- */
  root.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-rg-tab]'); if (tab) { setView(tab.dataset.rgTab); return; }
    const close = event.target.closest('[data-rg-dialog-close]'); if (close) { closeDialog(close.closest('dialog')); return; }
    const weekdayChip = event.target.closest('[data-rg-weekday]'); if (weekdayChip) { const d = Number(weekdayChip.dataset.rgWeekday); if (dialogWeekdays.has(d)) dialogWeekdays.delete(d); else dialogWeekdays.add(d); renderWeekdayChips(); return; }
    const recBtn = event.target.closest('[data-rg-record]'); if (recBtn) {
      const taskId = recBtn.dataset.rgTask; const value = recBtn.dataset.rgValue;
      const current = recordFor(todayDate, taskId)?.value || '';
      if (setRecordValue(todayDate, taskId, current === value ? '' : value)) { renderToday(); refreshSummaryCell(todayDate); showToast(current === value ? '記録を取り消しました。' : '記録しました。'); }
      return;
    }
    const todayNav = event.target.closest('[data-rg-today-nav]'); if (todayNav) {
      const nav = todayNav.dataset.rgTodayNav;
      if (nav === 'prev') todayDate = shiftDateKey(todayDate, -1);
      else if (nav === 'next') todayDate = shiftDateKey(todayDate, 1);
      else todayDate = localToday();
      renderToday(); return;
    }
    const segment = event.target.closest('[data-rg-today-segment]'); if (segment) { todaySegment = segment.dataset.rgTodaySegment; renderToday(); return; }
    const gridChip = event.target.closest('[data-rg-grid-filter]'); if (gridChip) {
      gridFilter = gridChip.dataset.rgGridFilter;
      $$('[data-rg-grid-filter]').forEach((chip) => chip.classList.toggle('is-active', chip === gridChip));
      renderMatrix(); return;
    }
    const manageChip = event.target.closest('[data-rg-manage-filter]'); if (manageChip) {
      manageFilter = manageChip.dataset.rgManageFilter;
      $$('[data-rg-manage-filter]').forEach((chip) => chip.classList.toggle('is-active', chip === manageChip));
      renderTasks(); return;
    }
    const jump = event.target.closest('[data-rg-jump-today]'); if (jump) { todayDate = localToday(); setView('today'); return; }
    const day = event.target.closest('[data-rg-day]'); if (day) { openDate(day.dataset.rgDay, day); return; }
    const action = event.target.closest('[data-rg-action]'); if (!action) return;
    const name = action.dataset.rgAction;
    if (name === 'settings') setView('settings');
    else if (name === 'sync') manualSync();
    else if (name === 'prev-month') { viewMonth -= 1; if (viewMonth < 1) { viewMonth = 12; viewYear -= 1; } renderMatrix(); renderPulse(); }
    else if (name === 'next-month') { viewMonth += 1; if (viewMonth > 12) { viewMonth = 1; viewYear += 1; } renderMatrix(); renderPulse(); }
    else if (name === 'today') { const today = new Date(); viewYear = today.getFullYear(); viewMonth = today.getMonth() + 1; renderMatrix(); renderPulse(); }
    else if (name === 'focus-today') { const today = localToday(); const dayCell = root.querySelector(`[data-rg-day="${today}"]`); dayCell?.scrollIntoView({ block: 'center', inline: 'nearest' }); dayCell?.focus({ preventScroll: true }); }
    else if (name === 'add-task') openTask();
    else if (name === 'save-memo') saveMemo();
    else if (name === 'delete-memo') saveMemo(true);
    else if (name === 'connect-sync') connectSync();
    else if (name === 'disconnect-sync') openConfirm('同期を解除しますか？', 'ローカルのタスク、記録、セルメモはこの端末に残ります。', disconnectSync);
    else if (name === 'export') exportJson();
    else if (name === 'export-csv') exportCsv();
    else if (name === 'export-png') exportImage(false);
    else if (name === 'export-pdf') exportImage(true);
    else if (name === 'import') els.importInput?.click();
    else if (name === 'restore-backup') restoreBackup();
    else if (name === 'confirm-action') { const actionToRun = confirmAction; confirmAction = null; closeDialog(els.confirmDialog); actionToRun?.(); }
  });

  els.taskForm?.addEventListener('submit', saveTask);
  els.taskCadence?.addEventListener('change', syncCadenceFields);
  els.taskSearch?.addEventListener('input', (event) => { manageQuery = event.target.value || ''; renderTasks(); });
  els.importInput?.addEventListener('change', (event) => importJson(event.target.files?.[0]));
  [els.dateDialog, els.memoDialog, els.taskDialog, els.confirmDialog].forEach((dialog) => {
    dialog?.addEventListener('click', (event) => { if (event.target === dialog) closeDialog(dialog); });
    dialog?.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(dialog); });
  });

  els.taskList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-rg-task-action]'); if (!button) return; const id = button.dataset.rgTaskId; const action = button.dataset.rgTaskAction;
    if (action === 'edit') openTask(id); else if (action === 'up') moveTask(id, -1); else if (action === 'down') moveTask(id, 1); else if (action === 'archive') archiveTask(id); else if (action === 'restore') archiveTask(id, true); else if (action === 'delete') openConfirm('タスクを完全に削除しますか？', 'タスクは一覧から消え、古い端末データから復活しないための記録だけが残ります。', () => deleteTask(id));
  });
  els.taskList?.addEventListener('dragstart', (event) => { const row = event.target.closest('[data-rg-task-row]'); if (row) event.dataTransfer.setData('text/plain', row.dataset.rgTaskRow); });
  els.taskList?.addEventListener('dragover', (event) => { if (event.target.closest('[data-rg-task-row]')) event.preventDefault(); });
  els.taskList?.addEventListener('drop', (event) => { event.preventDefault(); const target = event.target.closest('[data-rg-task-row]'); const sourceId = event.dataTransfer.getData('text/plain'); if (!target || !sourceId || target.dataset.rgTaskRow === sourceId) return; const tasks = sortedTasks({ includeArchived: true }); const source = tasks.findIndex((task) => task.id === sourceId); const destination = tasks.findIndex((task) => task.id === target.dataset.rgTaskRow); if (source < 0 || destination < 0) return; const [moved] = tasks.splice(source, 1); tasks.splice(destination, 0, moved); const stamp = timestamp(); tasks.forEach((task, index) => { task.order = index; task.updatedAt = stamp; task.updatedBy = currentDevice; }); state.updatedAt = stamp; persistLocal(); renderTasks(); });

  if (channel) channel.addEventListener('message', (event) => { if (event.data?.type !== 'state' || event.data.source === currentDevice) return; if (isEditorOpen()) pendingRemote = mergeStates(state, event.data.state); else applyRemote(event.data.state); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (d1Enabled()) manualSync();
    else if (binId()) manualSync();
  });

  function startPolling() {
    clearInterval(pollTimer);
    if (!d1Enabled()) pollTimer = window.setInterval(() => { if (document.visibilityState === 'visible' && binId()) enqueue(fetchRemote); }, 4500);
  }

  /* ---------- boot ---------- */
  runActionMigration();
  dedupeMigratedTasks();
  window.RitualGridTest = {
    getState: () => clone(state),
    openMemo: (day, columnId) => openMemo(day, columnId, null),
    cycleValue, hasMemo,
    dueInfo: (taskId, day) => { const task = state.tasks[taskId]; return task ? dueInfo(task, day || localToday(), buildDoneIndex()) : null; },
    migration: () => { try { return JSON.parse(localStorage.getItem(MIGRATION_KEY) || 'null'); } catch (_) { return null; } }
  };
  let initialView = 'today';
  try { initialView = localStorage.getItem(VIEW_KEY) || 'today'; } catch (_) { /* ignore */ }
  setView(initialView);
  startPolling();
  if (d1Enabled()) setSyncState('synced', 'D1同期済み');
  else if (binId()) enqueue(fetchRemote);
  else setSyncState('local', 'LOCAL ONLY');
})();

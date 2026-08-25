import {
  cycleValue,
  memoKey,
  setMemo,
  hasMemo,
  mergeStates,
  classifyPress
} from '/js/ritual-grid-core.mjs';

(() => {
  'use strict';

  const root = document.querySelector('[data-rg-root]');
  if (!root) return;

  const STORE_KEY = 'dt_ritual_grid_v1';
  const BIN_KEY = 'dt_ritual_grid_bin_id';
  const DEVICE_KEY = 'dt_ritual_grid_device_id';
  const IMPORT_BACKUP_KEY = 'dt_ritual_grid_import_backup';
  const RECOVERY_KEY = 'dt_ritual_grid_recovery_v1';
  const APP_KEY = 'ritual_grid';
  const CHANNEL_NAME = 'dt_ritual_grid_channel';
  const BIN_URL = 'https://api.jsonbin.io/v3/b';
  const HOLD_MS = 850;
  const MOVE_LIMIT = 8;
  const STATUS_GLYPHS = { '': '', knife: '🔪', peach: '🍑', heart: '♡' };
  const STATUS_LABELS = { '': '未記録', knife: 'knife', peach: 'peach', heart: 'heart' };
  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
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
    taskError: $('[data-rg-task-error]'),
    confirmDialog: $('[data-rg-dialog="confirm"]'),
    confirmTitle: $('#rg-confirm-title'),
    confirmCopy: $('[data-rg-confirm-copy]')
  };

  const clone = (value) => {
    try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); }
  };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const pad = (value) => String(value).padStart(2, '0');
  const dateKey = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;
  const parseKey = (key) => { const [year, month, day] = String(key).split('-').map(Number); return { year, month, day }; };
  const shiftDateKey = (key, offset) => { const { year, month, day } = parseKey(key); const date = new Date(year, month - 1, day + offset); return dateKey(date.getFullYear(), date.getMonth() + 1, date.getDate()); };
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
  let activeView = 'log';
  let activeDate = '';
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

  const emptyState = () => ({ version: 1, app: APP_KEY, deviceId: currentDevice, updatedAt: 0, tasks: {}, records: {}, memos: {} });
  const normalizeTask = (input, fallbackId) => {
    const task = input && typeof input === 'object' ? input : {};
    const id = String(task.id || fallbackId || makeId('task'));
    return { ...task, id, name: String(task.name || '無題のタスク').trim().slice(0, 80) || '無題のタスク', color: /^#[0-9a-f]{6}$/i.test(task.color) ? task.color : '#7dd3fc', note: String(task.note || '').slice(0, 500), order: Number.isFinite(Number(task.order)) ? Number(task.order) : 0, createdAt: Number(task.createdAt) || 0, updatedAt: Number(task.updatedAt) || 0, updatedBy: String(task.updatedBy || currentDevice), archivedAt: task.archivedAt ? Number(task.archivedAt) : null, deletedAt: task.deletedAt ? Number(task.deletedAt) : null, activeRanges: Array.isArray(task.activeRanges) && task.activeRanges.length ? task.activeRanges : [{ startOn: null, endOn: null }] };
  };
  const normalizeRecord = (input) => {
    const record = input && typeof input === 'object' ? input : {};
    const value = ['', 'knife', 'peach', 'heart'].includes(record.value) ? record.value : null;
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
    if (JSON.stringify(state) !== before) { persistLocal({ cloud: false, announce: false }); renderAll(); }
  }

  async function fetchRemote() {
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

  function manualSync() { if (!binId()) { setView('settings'); showToast('先に「接続して同期」を選んでください。'); return; } enqueue(async () => { await fetchRemote(); if (dirtySinceRemote) await pushRemote(); }); }

  async function connectSync() {
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

  function recordFor(day, columnId) {
    const entry = state.records[day];
    return columnId === 'main' ? entry?.main : entry?.tasks?.[columnId];
  }

  function taskActiveOn(task, day) {
    if (!task || task.deletedAt) return false;
    const ranges = Array.isArray(task.activeRanges) && task.activeRanges.length ? task.activeRanges : [{ startOn: null, endOn: null }];
    return ranges.some((range) => (!range.startOn || day >= range.startOn) && (!range.endOn || day <= range.endOn));
  }

  function taskVisibleInMonth(task) {
    const days = daysInMonth(viewYear, viewMonth);
    return Array.from({ length: days }, (_, index) => dateKey(viewYear, viewMonth, index + 1)).some((day) => taskActiveOn(task, day) || Boolean(recordFor(day, task.id)));
  }

  function sortedTasks({ includeArchived = true } = {}) {
    return Object.values(state.tasks).filter((task) => !task.deletedAt && (includeArchived || !task.archivedAt)).sort((a, b) => Number(a.order) - Number(b.order) || String(a.id).localeCompare(String(b.id)));
  }

  function visibleTasks() { return sortedTasks({ includeArchived: false }).filter(taskVisibleInMonth); }

  function cellLabel(day, columnId, value, memo) {
    const columnName = columnId === 'main' ? 'MAIN' : (state.tasks[columnId]?.name || 'タスク');
    return `${dateLabel(day)} ${columnName}。現在: ${STATUS_LABELS[value] || '未記録'}${hasMemo(memo) ? '。メモあり。長押しで編集' : '。長押しでメモを編集'}`;
  }

  function statusCellHtml(day, columnId, value, extraClass = '') {
    const memo = state.memos[memoKey(day, columnId)];
    const glyph = STATUS_GLYPHS[value] || '';
    const label = cellLabel(day, columnId, value, memo);
    const columnClass = columnId === 'main' ? 'rg-main-col' : 'rg-task-col';
    return `<td class="rg-status-cell ${columnClass} ${extraClass}" data-rg-status-cell data-rg-date="${day}" data-rg-column="${escapeHtml(columnId)}" data-rg-value="${value || ''}" tabindex="0" role="button" aria-label="${escapeHtml(label)}" title="${hasMemo(memo) ? 'メモあり。長押しで編集' : '長押しでメモを編集'}"><span class="rg-status-glyph" data-rg-value="${value || ''}" aria-hidden="true">${glyph}</span>${hasMemo(memo) ? '<span class="rg-memo-dot" aria-hidden="true"></span>' : ''}</td>`;
  }

  function headerHtml(tasks) {
    const emptyTask = tasks.length ? '' : '<th class="rg-empty-task-col rg-empty-task-head" scope="col"><button type="button" data-rg-action="add-task" aria-label="タスクを追加"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg><span>TASK</span></button></th>';
    return `<tr><th class="rg-day-col" scope="col"><span class="rg-col-name">DAY</span><span class="rg-col-sub">日付</span></th><th class="rg-main-col" scope="col"><span class="rg-col-name">MAIN</span><span class="rg-col-sub">主担当</span></th>${tasks.map((task) => `<th class="rg-task-col" scope="col" title="${escapeHtml(task.name)}"><span class="rg-col-name">${escapeHtml(task.name)}</span><span class="rg-col-sub">TASK</span></th>`).join('')}${emptyTask}</tr>`;
  }

  function renderMatrix() {
    if (!els.matrix) return;
    const tasks = visibleTasks();
    const frame = els.matrix.closest('[data-rg-matrix-frame]');
    const contentWidth = tasks.length ? 138 + (tasks.length * 112) : 302;
    if (frame) frame.style.width = `min(100%, ${Math.min(1180, contentWidth)}px)`;
    const days = daysInMonth(viewYear, viewMonth);
    const today = localToday();
    let body = '';
    for (let day = 1; day <= days; day += 1) {
      if (day === 15) body += `<tr class="rg-mid-header" aria-label="中央ヘッダー">${headerHtml(tasks).replace(/^<tr>|<\/tr>$/g, '')}</tr>`;
      const key = dateKey(viewYear, viewMonth, day);
      const weekday = new Date(viewYear, viewMonth - 1, day).getDay();
      const dayLabel = `${dateLabel(key)}の日付詳細を開く`;
      body += `<tr><th class="rg-day-col rg-day-cell ${key === today ? 'is-today' : ''} ${weekday === 0 || weekday === 6 ? 'is-weekend' : ''}" scope="row" data-rg-day="${key}" tabindex="0" role="button" aria-label="${escapeHtml(dayLabel)}"><span class="rg-day-number">${day}</span><span class="rg-day-week">${WEEKDAYS[weekday]}</span></th>`;
      body += statusCellHtml(key, 'main', recordFor(key, 'main')?.value || '');
      tasks.forEach((task) => { const disabled = !taskActiveOn(task, key); body += statusCellHtml(key, task.id, recordFor(key, task.id)?.value || '', disabled ? 'is-disabled' : ''); });
      if (!tasks.length) body += '<td class="rg-empty-task-col" aria-hidden="true"></td>';
      body += '</tr>';
    }
    els.matrix.innerHTML = `<table class="rg-matrix-table ${tasks.length ? '' : 'is-empty'}" aria-label="${viewYear}年${viewMonth}月のRITUAL GRID"><colgroup><col class="rg-day-col"><col class="rg-main-col">${tasks.map(() => '<col class="rg-task-col">').join('')}${tasks.length ? '' : '<col class="rg-empty-task-col">'}</colgroup><thead>${headerHtml(tasks)}</thead><tbody>${body}</tbody></table>`;
    els.month.textContent = `${viewYear}年 ${viewMonth}月`;
    els.month.setAttribute('aria-label', `${viewYear}年${viewMonth}月。タップで今月へ戻る`);
    const syncFixedColumns = () => { const offset = `${els.matrix.scrollLeft}px`; els.matrix.querySelectorAll('.rg-day-col, .rg-main-col').forEach((cell) => cell.style.setProperty('--rg-fixed-x', offset)); };
    els.matrix.addEventListener('scroll', syncFixedColumns, { passive: true });
    syncFixedColumns();
    $$('[data-rg-day]').forEach((cell) => cell.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDate(cell.dataset.rgDay, cell); }
    }));
    $$('[data-rg-status-cell]').forEach(bindStatusCell);
  }

  function updateStatus(day, columnId, sourceCell) {
    const current = recordFor(day, columnId)?.value || '';
    const next = cycleValue(current);
    const record = { value: next || null, updatedAt: timestamp(), updatedBy: currentDevice };
    if (!state.records[day]) state.records[day] = {};
    if (columnId === 'main') state.records[day].main = record;
    else { if (!state.records[day].tasks) state.records[day].tasks = {}; state.records[day].tasks[columnId] = record; }
    state.updatedAt = record.updatedAt;
    if (!persistLocal()) return;
    if (sourceCell) {
      sourceCell.dataset.rgValue = next;
      const glyph = sourceCell.querySelector('.rg-status-glyph');
      if (glyph) { glyph.dataset.rgValue = next; glyph.textContent = STATUS_GLYPHS[next]; }
      sourceCell.setAttribute('aria-label', cellLabel(day, columnId, next, state.memos[memoKey(day, columnId)]));
    }
    updateDetailIfOpen();
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

  function openDate(day, source) {
    activeDate = day; focusAfterClose = source || null; if (els.dateTitle) els.dateTitle.textContent = dateLabel(day); renderDateDetail(); showDialog(els.dateDialog); }

  function detailRowHtml(day, columnId, name, isMain = false) {
    const record = recordFor(day, columnId); const memo = state.memos[memoKey(day, columnId)]; const value = record?.value || '';
    return `<div class="rg-detail-row ${isMain ? 'is-main' : ''}"><div class="rg-detail-label">${escapeHtml(name)}${hasMemo(memo) ? '<span class="rg-detail-note">  • メモあり</span>' : ''}</div>${statusCellHtml(day, columnId, value).replace('<td ', '<div ').replace('</td>', '</div>')}</div>`;
  }

  function renderDateDetail() {
    if (!els.detailList || !activeDate) return;
    const tasks = sortedTasks({ includeArchived: true }).filter((task) => taskActiveOn(task, activeDate) || Boolean(recordFor(activeDate, task.id)));
    els.detailList.innerHTML = `${detailRowHtml(activeDate, 'main', 'MAIN', true)}${tasks.map((task) => detailRowHtml(activeDate, task.id, task.name)).join('')}`;
    els.detailList.querySelectorAll('[data-rg-status-cell]').forEach(bindStatusCell);
  }

  function updateDetailIfOpen() { if (els.dateDialog?.open) renderDateDetail(); }

  function openMemo(day, columnId, source) {
    const existing = state.memos[memoKey(day, columnId)];
    activeMemo = { day, columnId }; focusAfterClose = source || document.activeElement;
    if (els.memoContext) els.memoContext.textContent = `${dateLabel(day)} · ${columnId === 'main' ? 'MAIN' : state.tasks[columnId]?.name || 'タスク'}`;
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

  function openTask(taskId = '') {
    const task = taskId ? state.tasks[taskId] : null; if (els.taskId) els.taskId.value = task?.id || ''; if (els.taskName) els.taskName.value = task?.name || ''; if (els.taskColor) els.taskColor.value = task?.color || '#7dd3fc'; if (els.taskNote) els.taskNote.value = task?.note || ''; if (els.taskError) els.taskError.textContent = ''; if (els.taskDialogTitle) els.taskDialogTitle.textContent = task ? 'タスクを編集' : 'タスクを追加'; showDialog(els.taskDialog); window.setTimeout(() => els.taskName?.focus({ preventScroll: true }), 40);
  }

  function saveTask(event) {
    event.preventDefault(); const name = (els.taskName?.value || '').trim(); if (!name) { if (els.taskError) els.taskError.textContent = 'タスク名を入力してください。'; els.taskName?.focus(); return; }
    const id = els.taskId?.value || makeId('task'); const old = state.tasks[id]; const stamp = timestamp();
    state.tasks[id] = { ...(old || { id, createdAt: stamp, order: Object.keys(state.tasks).length }), id, name, color: els.taskColor?.value || '#7dd3fc', note: (els.taskNote?.value || '').trim().slice(0, 500), updatedAt: stamp, updatedBy: currentDevice, archivedAt: old?.archivedAt || null, deletedAt: null, activeRanges: old?.activeRanges || [{ startOn: null, endOn: null }] };
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

  function renderTasks() {
    const tasks = sortedTasks({ includeArchived: true }); if (els.taskSummary) els.taskSummary.textContent = `有効 ${tasks.filter((task) => !task.archivedAt).length} · 保留 ${tasks.filter((task) => task.archivedAt).length}`; if (!els.taskList) return;
    if (!tasks.length) { els.taskList.innerHTML = '<div class="rg-task-empty"><button type="button" class="rg-primary-button" data-rg-action="add-task" data-rg-four-edge><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg><span>タスクを追加</span></button></div>'; return; }
    els.taskList.innerHTML = tasks.map((task, index) => `<article class="rg-task-row ${task.archivedAt ? 'is-archived' : ''}" style="--rg-task-color:${escapeHtml(task.color)}" data-rg-task-row="${escapeHtml(task.id)}" draggable="true" data-rg-four-edge><button type="button" class="rg-task-drag" data-rg-task-action="focus" data-rg-task-id="${escapeHtml(task.id)}" aria-label="${escapeHtml(task.name)}を並べ替え"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="7" r="1"></circle><circle cx="16" cy="7" r="1"></circle><circle cx="8" cy="12" r="1"></circle><circle cx="16" cy="12" r="1"></circle><circle cx="8" cy="17" r="1"></circle><circle cx="16" cy="17" r="1"></circle></svg></button><div><span class="rg-task-name"><span class="rg-task-color" style="background:${escapeHtml(task.color)};color:${escapeHtml(task.color)}"></span>${escapeHtml(task.name)}</span><span class="rg-task-sub">${task.archivedAt ? '保留' : '有効'} · ${index + 1}</span></div><div class="rg-task-actions"><button type="button" data-rg-task-action="up" data-rg-task-id="${escapeHtml(task.id)}" aria-label="${escapeHtml(task.name)}を上へ"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 14 5-5 5 5"></path></svg></button><button type="button" data-rg-task-action="down" data-rg-task-id="${escapeHtml(task.id)}" aria-label="${escapeHtml(task.name)}を下へ"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"></path></svg></button><button type="button" data-rg-task-action="edit" data-rg-task-id="${escapeHtml(task.id)}" aria-label="${escapeHtml(task.name)}を編集">編集</button><button type="button" data-rg-task-action="${task.archivedAt ? 'restore' : 'archive'}" data-rg-task-id="${escapeHtml(task.id)}" aria-label="${escapeHtml(task.name)}を${task.archivedAt ? '復元' : '保留'}">${task.archivedAt ? '復元' : '保留'}</button><button type="button" data-rg-task-action="delete" data-rg-task-id="${escapeHtml(task.id)}" aria-label="${escapeHtml(task.name)}を削除"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"></path></svg></button></div></article>`).join('');
  }

  function setView(view) { activeView = ['log', 'tasks', 'settings'].includes(view) ? view : 'log'; $$('[data-rg-view]').forEach((section) => { section.hidden = section.dataset.rgView !== activeView; }); $$('[data-rg-tab]').forEach((tab) => { tab.classList.toggle('is-active', tab.dataset.rgTab === activeView); tab.setAttribute('aria-selected', String(tab.dataset.rgTab === activeView)); }); if (activeView === 'log') renderMatrix(); if (activeView === 'tasks') renderTasks(); }
  function renderAll() { renderMatrix(); renderTasks(); }

  function openConfirm(title, copy, action) { confirmAction = action; if (els.confirmTitle) els.confirmTitle.textContent = title; if (els.confirmCopy) els.confirmCopy.textContent = copy; showDialog(els.confirmDialog); }

  function exportJson() { const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `ritual_grid_${viewYear}-${pad(viewMonth)}.json`; link.click(); URL.revokeObjectURL(link.href); showToast('JSONを書き出しました。'); }

  async function importJson(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()); if (!parsed || parsed.app !== APP_KEY || typeof parsed.tasks !== 'object' || typeof parsed.records !== 'object' || typeof parsed.memos !== 'object') throw new Error('invalid import');
      localStorage.setItem(IMPORT_BACKUP_KEY, JSON.stringify(state)); state = normalizeState(parsed); state.deviceId = currentDevice; state.updatedAt = timestamp(); if (!persistLocal()) return; renderAll(); showToast('JSONを読み込みました。');
    } catch (_) { showToast('JSONを読み込めませんでした。現在の記録は変更していません。'); }
    if (els.importInput) els.importInput.value = '';
  }

  function restoreBackup() { const raw = localStorage.getItem(IMPORT_BACKUP_KEY); if (!raw) { showToast('直前のバックアップはありません。'); return; } openConfirm('直前のバックアップを復元', '現在の状態を、最後のJSON読み込み直前へ戻します。', () => { try { state = normalizeState(JSON.parse(raw)); state.updatedAt = timestamp(); persistLocal(); renderAll(); showToast('バックアップを復元しました。'); } catch (_) { showToast('バックアップを復元できませんでした。'); } }); }

  root.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-rg-tab]'); if (tab) { setView(tab.dataset.rgTab); return; }
    const close = event.target.closest('[data-rg-dialog-close]'); if (close) { closeDialog(close.closest('dialog')); return; }
    const day = event.target.closest('[data-rg-day]'); if (day) { openDate(day.dataset.rgDay, day); return; }
    const action = event.target.closest('[data-rg-action]'); if (!action) return;
    const name = action.dataset.rgAction;
    if (name === 'settings') setView('settings');
    else if (name === 'sync') manualSync();
    else if (name === 'prev-month') { viewMonth -= 1; if (viewMonth < 1) { viewMonth = 12; viewYear -= 1; } renderMatrix(); }
    else if (name === 'next-month') { viewMonth += 1; if (viewMonth > 12) { viewMonth = 1; viewYear += 1; } renderMatrix(); }
    else if (name === 'today') { const today = new Date(); viewYear = today.getFullYear(); viewMonth = today.getMonth() + 1; renderMatrix(); }
    else if (name === 'focus-today') { const today = localToday(); const dayCell = root.querySelector(`[data-rg-day="${today}"]`); dayCell?.scrollIntoView({ block: 'center', inline: 'nearest' }); dayCell?.focus({ preventScroll: true }); }
    else if (name === 'add-task') openTask();
    else if (name === 'save-memo') saveMemo();
    else if (name === 'delete-memo') saveMemo(true);
    else if (name === 'connect-sync') connectSync();
    else if (name === 'disconnect-sync') openConfirm('同期を解除しますか？', 'ローカルのタスク、記録、セルメモはこの端末に残ります。', disconnectSync);
    else if (name === 'export') exportJson();
    else if (name === 'import') els.importInput?.click();
    else if (name === 'restore-backup') restoreBackup();
    else if (name === 'confirm-action') { const actionToRun = confirmAction; confirmAction = null; closeDialog(els.confirmDialog); actionToRun?.(); }
  });

  els.taskForm?.addEventListener('submit', saveTask);
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
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && binId()) manualSync(); });

  function startPolling() { clearInterval(pollTimer); pollTimer = window.setInterval(() => { if (document.visibilityState === 'visible' && binId()) enqueue(fetchRemote); }, 4500); }

  window.RitualGridTest = { getState: () => clone(state), openMemo: (day, columnId) => openMemo(day, columnId, null), cycleValue, hasMemo };
  renderAll(); startPolling(); if (binId()) enqueue(fetchRemote); else setSyncState('local', 'LOCAL ONLY');
})();

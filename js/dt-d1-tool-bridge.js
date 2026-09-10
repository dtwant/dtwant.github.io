/* Keep legacy tool controls attached to the D1 owner after a safe cutover. */
(function (root) {
  'use strict';

  const STATUS_TARGETS = {
    manga: ['#ms-sync'],
    novel: ['[data-role="sync"]'],
    movie: ['#mt-sync'],
    feeding: ['#fl-sync-badge'],
    timetable: ['#sync-status'],
    diary: ['#sd-sync-badge-top', '#sd-gaman-sync-status'],
    task_calendar: ['#ntc-sync-badge span:last-child'],
    calendar: ['#cg-sync'],
    report_card: ['#rc-sync-badge-label', '#rc-sync-status-text'],
    deadline: ['.dm-pill'],
    tasklist: ['[data-tl-sync-state] > span:last-child'],
    payment: ['.cn-badge'],
    vocal_range: ['#vr-sbadge'],
    library: ['#bs-sync-status'],
    attendance: ['.ag-pill'],
    weight_log: ['#wl-sync-badge'],
    shift_clock: ['#sc-sync'],
    taskmanage: ['#km-btn-sync'],
    math_memo: ['[data-mm-sync-label]'],
    ritual_grid: ['[data-rg-sync-label]'],
    biome_archive: ['#ba-sync']
  };

  const SYNC_CONTROLS = {
    manga: ['[data-ms-nav="sync"]'],
    novel: ['[data-action="sync-now"][data-role="sync"]'],
    movie: ['#mt-btn-sync'],
    feeding: ['#fl-sync-badge'],
    timetable: ['#btn-sync-now'],
    diary: ['#sd-sync-badge-top'],
    task_calendar: ['#ntc-sync-btn'],
    calendar: ['button[onclick*="cgSync"]'],
    report_card: ['#rc-sync-now-btn'],
    deadline: ['.dm-pill'],
    tasklist: ['[data-tl-action="sync"]'],
    payment: ['button[title="同期"]'],
    vocal_range: ['button[onclick*="VR.doSync"]'],
    library: ['.bs-btn-sync'],
    attendance: ['.ag-pill'],
    weight_log: ['button[onclick*="wlSync"]'],
    shift_clock: ['button[onclick*="scSync"]'],
    taskmanage: ['#km-btn-sync'],
    math_memo: ['[data-mm-action="sync-now"]'],
    ritual_grid: ['[data-rg-action="sync"]'],
    biome_archive: ['#ba-sync-action']
  };

  const labels = {
    syncing: 'D1同期中', synced: 'D1同期済み', pulled: 'D1同期済み', pushed: 'D1同期済み',
    unchanged: 'D1同期済み', conflict: 'D1競合確認', resolved: 'D1同期済み',
    error: 'D1同期エラー', network: 'D1同期エラー', timeout: 'D1同期エラー',
    runtime_error: 'D1実行エラー', worker_unavailable: 'D1 Worker未接続',
    d1_runtime_unavailable: 'D1ランタイム未読込', indexeddb_unavailable: '端末DBを読めません',
    apply_failed: '端末への反映失敗', source_snapshot_missing: '選択原本に対象なし',
    source_snapshot_unavailable: '選択原本を確認できません',
    unauthorized: 'D1認証エラー', forbidden: 'D1アクセスエラー',
    http_401: 'D1認証エラー', http_403: 'D1アクセスエラー',
    http_404: 'D1経路エラー', http_408: 'D1応答待ちエラー',
    http_429: 'D1リクエスト制限', http_500: 'D1サーバーエラー',
    http_502: 'D1サーバーエラー', http_503: 'D1サーバーエラー'
  };
  const statusByApp = new Map();
  let observer;
  let refreshing = false;

  function isEnabled(appKey) {
    return root.localStorage?.getItem(`dt_sync_provider_${appKey}`) === 'd1';
  }

  function statusLabel(detail) {
    if (!detail || detail.status === 'local') return 'D1未同期';
    if (detail.ok === false) return labels[detail.reason] || labels.error;
    return labels[detail.status] || 'D1同期状態不明';
  }

  function statusDetail(detail) {
    if (!detail) return 'D1同期を確認しています';
    if (detail.ok === false) {
      const status = Number.isInteger(detail.statusCode) ? ` (HTTP ${detail.statusCode})` : '';
      return `D1同期エラー: ${detail.reason || 'unknown'}${status}`;
    }
    if (detail.status === 'conflict') return `D1競合 ${detail.conflicts?.length || 0}件。Sync Settingsで確定してください`;
    if (detail.status === 'syncing') return 'D1へ最新状態を確認しています';
    return `D1同期済み / 反映 ${Number(detail.changed) || 0}件`;
  }

  function nodesFor(appKey) {
    const selectors = STATUS_TARGETS[appKey] || [];
    return selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
  }

  function stateFor(detail) {
    if (detail?.ok === false) return 'error';
    if (detail?.status === 'conflict') return 'conflict';
    if (detail?.status === 'syncing') return 'syncing';
    return 'synced';
  }

  function normalizeLegacyStatusNode(node, state) {
    if (!node) return;
    const legacyState = state === 'syncing' ? 'working'
      : state === 'synced' ? 'synced'
        : state === 'conflict' ? 'error' : 'error';
    if (node.dataset.dtD1State !== state) node.dataset.dtD1State = state;
    // Old tools style their badge with data-state or a short class such as
    // `err`. Keep the element and its tool-specific layout, but make D1 the
    // only owner of its state so old JSONBin code cannot paint a false error.
    if (node.dataset.state !== legacyState) node.dataset.state = legacyState;
    if (node.dataset.syncState !== legacyState) node.dataset.syncState = legacyState;
    if (node.classList) {
      for (const token of [...node.classList]) {
        // Never remove classes owned by this bridge. Removing and re-adding
        // them would retrigger the MutationObserver indefinitely.
        if (!/^dt-d1-status(?:-|$)/.test(token)
          && /(?:^|[-_])(error|err|busy|working|syncing|ok|synced|online|offline|local)(?:$|[-_])/i.test(token)) {
          node.classList.remove(token);
        }
      }
      if (!node.classList.contains('dt-d1-status')) node.classList.add('dt-d1-status');
      const statusClass = `dt-d1-status-${state}`;
      if (!node.classList.contains(statusClass)) node.classList.add(statusClass);
    }
    const busy = String(state === 'syncing');
    if (node.getAttribute?.('aria-busy') !== busy) node.setAttribute?.('aria-busy', busy);
  }

  function renderStatus(appKey, detail) {
    if (!isEnabled(appKey)) return;
    statusByApp.set(appKey, detail);
    const text = statusLabel(detail);
    const title = statusDetail(detail);
    const state = stateFor(detail);
    for (const node of nodesFor(appKey)) {
      normalizeLegacyStatusNode(node, state);
      if (node.dataset.dtD1Status === text && node.title === title) continue;
      node.dataset.dtD1Status = text;
      node.title = title;
      node.textContent = text;
    }
  }

  function refreshStatuses() {
    if (refreshing) return;
    refreshing = true;
    try {
      for (const appKey of Object.keys(STATUS_TARGETS)) {
        if (isEnabled(appKey)) renderStatus(appKey, statusByApp.get(appKey) || { ok: true, status: 'syncing' });
      }
    } finally {
      refreshing = false;
    }
  }

  async function syncApp(appKey) {
    const runtime = root.DTD1Runtime;
    if (!isEnabled(appKey) || typeof runtime?.syncAppNow !== 'function') {
      renderStatus(appKey, { ok: false, reason: 'worker_unavailable' });
      return { ok: false, reason: 'worker_unavailable' };
    }
    return runtime.syncAppNow(appKey);
  }

  function closestControl(target) {
    if (!target || typeof target.closest !== 'function') return null;
    for (const [appKey, selectors] of Object.entries(SYNC_CONTROLS)) {
      if (!isEnabled(appKey)) continue;
      for (const selector of selectors) {
        const node = target.closest(selector);
        if (node) return { appKey, node };
      }
    }
    return null;
  }

  function install() {
    root.addEventListener('dt-d1-sync-status', (event) => {
      const detail = event.detail || {};
      if (detail.appKey) renderStatus(detail.appKey, detail);
    });
    document.addEventListener('click', (event) => {
      const control = closestControl(event.target);
      if (!control) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      syncApp(control.appKey);
    }, true);
    if (typeof MutationObserver === 'function' && document.body) {
      observer = new MutationObserver(refreshStatuses);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
    refreshStatuses();
  }

  root.DTD1LegacyBridge = { isEnabled, syncApp, refreshStatuses, normalizeLegacyStatusNode };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(typeof window !== 'undefined' ? window : globalThis);

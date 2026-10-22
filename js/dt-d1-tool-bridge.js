/*
 * D1 migration history: 2026-10-20
 * JSONBin configuration controls are retired from normal 0723 use. The
 * storage keys and recovery snapshots remain intentionally untouched so that
 * migration/recovery can be performed without deleting user data.
 */
(function (root) {
  'use strict';

  const LEGACY_UI_RETIRED = true;

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

  // These selectors remove the retired configuration surface even when a
  // device has lost its per-tool D1 flag. This prevents a stale/new device
  // from presenting JSONBin as an available owner again.
  const LEGACY_SYNC_UI = {
    manga: {
      roots: ['#ms-overlay-settings'],
      selectors: ['#ms-blob-id-input', '#ms-blob-id-display', '#ms-sync-detail'],
      markers: ['JSONBIN', 'jsonbin.io', 'EXISTING BLOB ID', 'Blob ID']
    },
    novel: {
      roots: ['.ns-modal[data-modal="settings"]'],
      selectors: ['[data-role="sync-key"]', '[data-role="sync-bin"]'],
      markers: ['JSONBin', 'Bin ID', '専用Bin', '共通マスター']
    },
    movie: {
      roots: ['#mt-overlay-settings'],
      selectors: ['#mt-blob-id-input', '#mt-blob-id-display'],
      markers: ['JSONBIN', 'jsonbin.io', 'EXISTING BLOB ID', 'Blob ID']
    },
    feeding: {
      roots: ['#fl-sync-settings-overlay'],
      selectors: ['#fl-sync-bin-id'],
      markers: ['CURRENT BIN ID', '接続ID']
    },
    timetable: {
      roots: ['#cyber-sync-panel'],
      selectors: ['#sync-key-input', '#btn-sync-generate', '#btn-sync-link', '#btn-sync-connect', '#btn-sync-disconnect'],
      markers: ['jsonbin.io', 'APIキー', '同期キー']
    },
    diary: {
      roots: ['#sd-tab-settings'],
      selectors: ['#sd-gaman-sync-copy-key-btn', '#sd-gaman-sync-key-input', '#sd-gaman-sync-save-btn', '#sd-gaman-sync-status'],
      markers: ['同期キー', '他の端末やブラウザと同期']
    },
    task_calendar: {
      roots: ['#ntc-cfg-overlay'],
      selectors: ['#ntc-cfg-binid'],
      markers: ['JSONBIN', 'Bin ID', 'MASTER KEY']
    },
    calendar: {
      roots: ['#cg-ov-settings'],
      selectors: ['#cg-blob-input', '#cg-jbkey-input', '#cg-old-bin-id', '#cg-old-api-key', '#cg-migrate-area'],
      markers: ['JSONBIN', '旧 Bin ID', '旧 API Key', 'APIキー']
    },
    report_card: {
      roots: ['#rc-settings-modal'],
      selectors: ['#rc-sync-now-btn', '#rc-sync-copy-key-btn', '#rc-sync-key-input', '#rc-sync-connect-btn', '#rc-sync-disconnect-btn'],
      markers: ['端末間同期', '同期キー', 'クラウド送信']
    },
    deadline: {
      roots: ['#dm-config-modal'],
      selectors: ['#dm-config-blob-id'],
      markers: ['接続 BIN ID', 'Bin ID']
    },
    tasklist: {
      roots: ['.tl-dialog'],
      selectors: ['[placeholder*="sync ID"]', '[placeholder*="同期ID"]'],
      markers: ['Cloud sync', 'Current sync ID', 'Paste an existing sync ID']
    },
    payment: {
      roots: ['.cn-dialog'],
      selectors: ['[placeholder="Bin ID を入力"]'],
      markers: ['JSONBin', 'Bin ID', 'クラウド同期']
    },
    vocal_range: {
      roots: ['#vr-m-cfg'],
      selectors: ['#cfg-blob', '#cfg-bid'],
      markers: ['クラウド同期', 'JSONBin', 'Bin ID']
    },
    library: {
      roots: ['#bs-overlay-settings'],
      selectors: ['#bs-blob-input', '#bs-jbkey-input'],
      markers: ['JSONBIN', 'Bin ID', 'API KEY']
    },
    attendance: {
      roots: ['#ag-config-modal'],
      selectors: ['#ag-config-blob-id'],
      markers: ['接続 BIN ID', 'Bin ID']
    },
    weight_log: {
      roots: ['#wl-cfg-overlay'],
      selectors: ['#wl-cfg-bin', '#wl-cfg-key'],
      markers: ['JSONBin', 'Bin ID', 'API Key']
    },
    shift_clock: {
      roots: ['#sc-ov-config'],
      selectors: ['#sc-cfg-bin', '#sc-cfg-key'],
      markers: ['JSONBin', 'Bin ID', 'API Key']
    },
    taskmanage: {
      roots: ['#km-sync-ol'],
      selectors: ['#km-btn-sync-settings', '#km-sync-bin-input'],
      markers: ['JSONBin', 'Bin ID', 'APIキー']
    },
    math_memo: {
      roots: ['[data-mm-dialog="sync"]'],
      selectors: ['[data-mm-bin-input]', '[data-mm-action="sync-open"]'],
      markers: ['Bin ID', '同期キー']
    },
    ritual_grid: {
      roots: ['[data-rg-settings-panel]'],
      selectors: ['[data-rg-action="connect-sync"]', '[data-rg-action="disconnect-sync"]'],
      markers: ['端末間同期', '接続して同期']
    },
    oshi: { roots: [], selectors: [], markers: [] },
    habit_heatmap: { roots: [], selectors: [], markers: [] },
    biome_archive: { roots: [], selectors: ['#ba-sync-action'], markers: [] }
  };

  const labels = {
    syncing: 'D1同期中', synced: 'D1同期済み', pulled: 'D1同期済み', pushed: 'D1同期済み',
    unchanged: 'D1同期済み', conflict: 'D1競合確認', resolved: 'D1同期済み',
    error: 'D1同期エラー', network: 'D1同期エラー', timeout: 'D1同期エラー',
    runtime_error: 'D1実行エラー', worker_unavailable: 'D1 Worker未接続',
    recovery_hold: '復元保留中（D1未同期）',
    d1_runtime_unavailable: 'D1ランタイム未読込', indexeddb_unavailable: '端末DBを読めません',
    storage_quota: '端末容量不足（自動退避を整理できません）',
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
    const changed = Number(detail.changed) || 0;
    const pushed = Number(detail.pushed) || 0;
    const pulled = Number(detail.pulled) || 0;
    if (detail.status === 'pushed') return `D1反映済み / 送信${pushed || changed}件`;
    if (detail.status === 'pulled') return `D1反映済み / 受信${pulled || changed}件`;
    if (detail.status === 'synced') return `D1反映済み / 送信${pushed}件・受信${pulled}件`;
    if (detail.status === 'unchanged') return 'D1確認済み / 変更なし';
    if (detail.status === 'conflict') return `D1競合確認 (${detail.conflicts?.length || 0}件)`;
    return labels[detail.status] || 'D1同期状態不明';
  }

  function statusDetail(detail) {
    if (!detail) return 'D1同期を確認しています';
    if (detail.ok === false) {
      if (detail.reason === 'recovery_hold') return '復元した端末データを確認するまでD1同期を保留しています';
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

  function hideLegacyNode(node) {
    if (!node || node.classList?.contains('dt-d1-only-notice') || node.dataset?.dtD1LegacyHidden === 'true') return;
    const target = node.closest?.('label, .cn-field, .tl-field, .ms-field, .mt-field, .bs-field, .sc-form-group') || node;
    if (target.dataset) target.dataset.dtD1LegacyHidden = 'true';
    target.hidden = true;
    target.setAttribute?.('aria-hidden', 'true');
    if (target.style) target.style.display = 'none';
  }

  function addD1Notice(root) {
    if (!root || root.querySelector?.('.dt-d1-only-notice')) return;
    const notice = document.createElement('p');
    notice.className = 'dt-d1-only-notice';
    notice.setAttribute('role', 'status');
    notice.style.cssText = 'margin:0 0 12px;padding:10px 12px;border:1px solid rgba(56,189,248,.35);border-radius:10px;background:rgba(14,116,144,.12);color:#bae6fd;font-size:12px;line-height:1.5;';
    notice.innerHTML = 'このツールの同期先はCloudflare D1です。URL・同期キー・端末間同期は <a href="/project-x/sync-settings/" style="color:inherit;text-decoration:underline;font-weight:700;">Sync Settings</a> で管理します。';
    root.insertBefore(notice, root.firstChild || null);
  }

  function hasMarker(node, markers) {
    const value = `${node.id || ''} ${node.getAttribute?.('placeholder') || ''} ${node.textContent || ''}`;
    return markers.some((marker) => value.toLowerCase().includes(String(marker).toLowerCase()));
  }

  function hideLegacySyncUi() {
    if (!document?.querySelectorAll) return;
    for (const [appKey, rule] of Object.entries(LEGACY_SYNC_UI)) {
      if (!LEGACY_UI_RETIRED && !isEnabled(appKey)) continue;
      const roots = rule.roots
        .flatMap((selector) => [...document.querySelectorAll(selector)])
        .filter((rootNode) => !rule.markers.length
          || hasMarker(rootNode, rule.markers)
          || rule.selectors.some((selector) => rootNode.querySelector?.(selector)));
      for (const selector of rule.selectors) {
        for (const node of document.querySelectorAll(selector)) hideLegacyNode(node);
      }
      for (const rootNode of roots) {
        addD1Notice(rootNode);
        if (!rule.markers.length || !rootNode.querySelectorAll) continue;
        for (const node of rootNode.querySelectorAll('label,p,h2,h3,h4,span,div,input,button')) {
          if (node.classList?.contains('dt-d1-only-notice')) continue;
          if (!hasMarker(node, rule.markers)) continue;
          const markedChild = [...(node.children || [])].some((child) => hasMarker(child, rule.markers));
          if (!markedChild) hideLegacyNode(node);
        }
      }
    }
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
      hideLegacySyncUi();
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

  root.DTD1LegacyBridge = { isEnabled, syncApp, refreshStatuses, normalizeLegacyStatusNode, statusLabel, hideLegacySyncUi };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(typeof window !== 'undefined' ? window : globalThis);

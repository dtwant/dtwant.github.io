/* dt-sync-panel.js — 全ツール共通の同期状態チップ＋パネル。
   目的: 競合や同期エラーを「表示が凍結して初めて気づく」状態にしない。
   データの読み取りと表示だけを行い、同期そのものの動作は変えない。
   状態は DTD1Runtime（競合・有効判定・最終同期記録）と
   dt-d1-sync-status イベントから取得する。 */
(function () {
  'use strict';
  if (window.__dtSyncPanelInstalled) return;
  window.__dtSyncPanelInstalled = true;

  const LIVE_APP_KEYS = [
    'manga', 'novel', 'movie', 'feeding', 'timetable', 'diary',
    'task_calendar', 'calendar', 'report_card', 'score_book', 'deadline', 'tasklist',
    'payment', 'vocal_range', 'library', 'attendance', 'weight_log',
    'shift_clock', 'taskmanage', 'math_memo', 'ritual_grid', 'oshi',
    'habit_heatmap', 'biome_archive'
  ];
  const TOOL_NAMES = {
    manga: '漫画棚', novel: '小説棚', movie: '映画トラッカー', feeding: '授乳・育児ログ',
    timetable: '時間割', diary: '秘密日記', task_calendar: 'ネオンタスクカレンダー',
    calendar: 'カレンダー', report_card: '成績管理', score_book: 'スコアブック',
    deadline: '締切マネージャー', tasklist: 'タスクリスト', payment: '支払いトラッカー',
    vocal_range: '音域トラッカー', library: '図書館棚', attendance: '出欠モニター',
    weight_log: '体重ログ', shift_clock: '出勤管理＆給与計算', taskmanage: 'タスクボード',
    math_memo: '数学メモ', ritual_grid: 'RITUAL GRID', oshi: '推し記録',
    habit_heatmap: '習慣ヒートマップ', biome_archive: 'Biome Archive'
  };
  const REASON_JA = {
    both_changed: 'この端末とD1の両方で変更された',
    local_missing: 'この端末にデータがない',
    remote_missing: 'D1にデータがない',
    invalid_remote_record: 'D1の記録が読めない形式',
    stale_remote_record_invalid: 'D1の記録が読めない形式',
    baseline_missing: '比較の基準データがない',
    baseline_mismatch: '比較の基準データが一致しない',
    same_timestamp: '同時刻の変更で自動判定できない',
    remote_revision_conflict: 'D1側が先に更新されている',
    local_changed_during_sync: '同期中にこの端末で変更された',
    remote_newer: 'D1の方が新しい',
    not_enabled: '同期が有効になっていない',
    network_error: '通信エラー',
    runtime_error: '実行時エラー'
  };
  const SETTINGS_URL = '/project-x/sync-settings/';
  /* ツール自身のヘッダー内同期表示（dt-d1-tool-bridge の STATUS_TARGETS と同じ実物）。
     これがあるページではフロートチップを作らず、その表示をタップでパネルが開くようにする。 */
  const LEGACY_TARGETS = {
    manga: ['#ms-sync'], novel: ['[data-role="sync"]'], movie: ['#mt-sync'],
    feeding: ['#fl-sync-badge'], timetable: ['#sync-badge-top', '#sync-status'],
    diary: ['#sd-sync-badge-top', '#sd-gaman-sync-status'],
    task_calendar: ['#ntc-sync-badge'], calendar: ['#cg-sync'],
    report_card: ['#rc-sync-badge-top'], deadline: ['.dm-pill'],
    tasklist: ['[data-tl-sync-state]'], payment: ['.cn-header-actions .cn-badge'],
    vocal_range: ['#vr-sbadge'], library: ['#bs-sync-status'],
    attendance: ['.ag-pill'], weight_log: ['#wl-sync-badge'],
    shift_clock: ['#sc-sync'], taskmanage: ['#km-btn-sync'],
    math_memo: ['.mm-sync-strip'], ritual_grid: ['.rg-sync-chip'],
    biome_archive: ['#ba-sync'], score_book: ['#sb-status']
  };
  /* ツール側バッジがヘッダー外に描画されるアプリは、ヘッダーの格納先を直接指定する */
  const DOCK_CONTAINERS = {
    weight_log: ['.wl-topbar-actions']
  };
  function findDockContainer(appKey) {
    for (const sel of DOCK_CONTAINERS[appKey] || []) {
      try { const el = document.querySelector(sel); if (el) return el; } catch (_) { /* bad selector */ }
    }
    return null;
  }
  function findLegacy(appKey) {
    for (const sel of LEGACY_TARGETS[appKey] || []) {
      try { const el = document.querySelector(sel); if (el) return el; } catch (_) { /* bad selector */ }
    }
    return null;
  }

  function detectAppKey() {
    try {
      const fromRuntime = window.DTD1Runtime && window.DTD1Runtime.appKey;
      if (fromRuntime && LIVE_APP_KEYS.includes(fromRuntime)) return fromRuntime;
      const fromPath = window.DTSyncRuntimeCore && window.DTSyncRuntimeCore.appKeyFromPath
        ? window.DTSyncRuntimeCore.appKeyFromPath(window.location.pathname) : null;
      if (fromPath && LIVE_APP_KEYS.includes(fromPath)) return fromPath;
    } catch (_) { /* fall through */ }
    return null;
  }

  function readLastSync(appKey) {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(`dt_d1_last_sync_${appKey}`) || '');
      if (parsed && parsed.version === 1 && typeof parsed.at === 'string') return parsed;
    } catch (_) { /* no record yet */ }
    return null;
  }

  function readConflicts(appKey) {
    try {
      const list = window.DTD1Runtime && typeof window.DTD1Runtime.pendingConflicts === 'function'
        ? window.DTD1Runtime.pendingConflicts(appKey) : [];
      return Array.isArray(list) ? list : [];
    } catch (_) { return []; }
  }

  function readEnabled(appKey) {
    try {
      if (window.DTD1Runtime && typeof window.DTD1Runtime.isEnabled === 'function') {
        return window.DTD1Runtime.isEnabled(appKey) === true;
      }
      return window.localStorage.getItem(`dt_sync_provider_${appKey}`) === 'd1';
    } catch (_) { return false; }
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fmtRelative(iso) {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '';
    const min = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (min < 1) return '（たった今）';
    if (min < 60) return `（${min}分前）`;
    const h = Math.floor(min / 60);
    if (h < 24) return `（${h}時間前）`;
    return `（${Math.floor(h / 24)}日前）`;
  }

  function shortKey(recordKey) {
    const s = String(recordKey || '');
    return s.length > 44 ? `${s.slice(0, 20)}…${s.slice(-18)}` : s;
  }

  function currentState(appKey) {
    const enabled = readEnabled(appKey);
    const conflicts = readConflicts(appKey);
    const last = readLastSync(appKey);
    if (!enabled) return { kind: 'off', label: 'SYNC OFF', conflicts, last };
    if (conflicts.length) return { kind: 'conflict', label: `競合 ${conflicts.length}件`, conflicts, last };
    if (last && last.ok === false) return { kind: 'error', label: '同期エラー', conflicts, last };
    if (last) return { kind: 'ok', label: '同期OK', conflicts, last };
    return { kind: 'unknown', label: '未確認', conflicts, last };
  }

  function lastSummary(last) {
    if (!last) return 'この端末ではまだ同期記録がありません';
    const parts = [];
    if (last.ok === false) parts.push(`エラー${last.reason ? `（${REASON_JA[last.reason] || last.reason}）` : ''}`);
    else if (last.status === 'unchanged') parts.push('変更なし');
    else {
      if (last.pushed) parts.push(`送信 ${last.pushed}`);
      if (last.pulled) parts.push(`受信 ${last.pulled}`);
      if (!parts.length) parts.push('変更なし');
    }
    if (last.conflictCount) parts.push(`競合 ${last.conflictCount}件`);
    return parts.join(' / ');
  }

  const CSS = `
/* ==========================================================================
   dtwant.github.io — Unified Common Header & Sync Chip
   Skeleton (immutable):
     Header: 64px height, 20px radius, 10px 12px padding, 16px bottom margin
     Back:   44px height, 10px radius (concentric 20 - 10), 0 14px 0 12px pad
     Title:  16px / 600 + 10px mono kicker (.14em tracking, hidden <= 600px)
     Chip:   32px height, 6px radius, 0 12px pad, 11px / 600 mono + 8px diamond
   External CSS variables (set per page by JS):
     --dtsp-accent, --dtsp-accent-dim, --dtsp-accent-soft
   ========================================================================== */

/* --------------------------------------------------------------------------
   1. Shared Tokens & Header Shell (.dtsp-header & LAB .lab-toolbar)
   -------------------------------------------------------------------------- */

.dtsp-header.dtsp-header,
.lab-shell .lab-toolbar.lab-toolbar,
.lab-toolbar.lab-toolbar {
  --_dtsp-accent: var(--dtsp-accent, #67e8f9);
  --_dtsp-ease: cubic-bezier(0.22, 1, 0.36, 1);

  /* Smoked obsidian glass ramp (fallback before color-mix) */
  --_dtsp-bg-top: rgba(15, 18, 24, 0.85);
  --_dtsp-bg-bottom: rgba(10, 12, 17, 0.89);
  --_dtsp-rim: var(--dtsp-accent-dim, rgba(237, 245, 255, 0.12));
  --_dtsp-specular: rgba(255, 255, 255, 0.12);
  --_dtsp-bevel-low: rgba(0, 0, 0, 0.30);
  --_dtsp-shadow:
    0 1px 2px rgba(0, 0, 0, 0.34),
    0 10px 28px -6px rgba(0, 0, 0, 0.42);

  /* Three neutral text roles */
  --_dtsp-ink-1: #f2f5fa;
  --_dtsp-ink-2: #dce4f0;
  --_dtsp-ink-3: #9aa6b8;

  /* Borderless ghost back-button surface steps */
  --_dtsp-ghost-bg: rgba(255, 255, 255, 0.048);
  --_dtsp-ghost-bg-hover: var(--dtsp-accent-soft, rgba(255, 255, 255, 0.092));
  --_dtsp-ghost-bg-active: rgba(255, 255, 255, 0.062);

  /* Interactive button state variables (safe under !important rules) */
  --_dtsp-btn-bg: var(--_dtsp-ghost-bg);
  --_dtsp-btn-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.055);
  --_dtsp-btn-ink: var(--_dtsp-ink-2);
}

.lab-shell .lab-toolbar.lab-toolbar,
.lab-toolbar.lab-toolbar {
  --_dtsp-accent: var(--dtsp-accent, var(--lab-accent, var(--accent, #22d3ee)));
}

/* Perceptually uniform oklab world-tinting: keeps dark obsidian neutral while
   absorbing ~3.5% of the page's temperature; nested color-mix pins exact alpha */
@supports (color: color-mix(in oklab, white, black)) {
  .dtsp-header.dtsp-header,
  .lab-shell .lab-toolbar.lab-toolbar,
  .lab-toolbar.lab-toolbar {
    --_dtsp-bg-top: color-mix(
      in oklab,
      color-mix(in oklab, #0f1218 96.5%, var(--_dtsp-accent)) 85%,
      transparent
    );
    --_dtsp-bg-bottom: color-mix(
      in oklab,
      color-mix(in oklab, #0a0c11 98%, var(--_dtsp-accent)) 89%,
      transparent
    );
    --_dtsp-rim: color-mix(
      in oklab,
      color-mix(in oklab, #ffffff 72%, var(--_dtsp-accent)) 13%,
      transparent
    );
    --_dtsp-ghost-bg-hover: color-mix(
      in oklab,
      color-mix(in oklab, #ffffff 86%, var(--_dtsp-accent)) 9.5%,
      transparent
    );
  }
}

/* Core shell geometry + smoked glass surface (shared by .dtsp-header & LAB) */
.dtsp-header.dtsp-header,
.lab-shell .lab-toolbar.lab-toolbar,
.lab-toolbar.lab-toolbar {
  display: flex !important;
  align-items: center !important;
  flex-wrap: nowrap !important;
  gap: 12px !important;
  height: 64px !important;
  min-height: 64px !important;
  max-height: 64px !important;
  width: 100% !important;
  box-sizing: border-box !important;
  padding: 10px 12px !important;
  margin: 0 auto 16px !important;
  position: relative !important;
  z-index: 30;
  isolation: isolate;
  border: 0 !important;
  border-radius: 20px !important;
  background: linear-gradient(180deg, var(--_dtsp-bg-top), var(--_dtsp-bg-bottom)) !important;
  box-shadow:
    inset 0 0 0 1px var(--_dtsp-rim),
    inset 0 1px 0 var(--_dtsp-specular),
    inset 0 -1px 0 var(--_dtsp-bevel-low),
    var(--_dtsp-shadow) !important;
  backdrop-filter: blur(22px) saturate(180%) brightness(0.97) !important;
  -webkit-backdrop-filter: blur(22px) saturate(180%) brightness(0.97) !important;
  color: var(--_dtsp-ink-1) !important;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Default interface typeface for tool header only (LAB preserves theme font,
   e.g. DotGothic16 on pixel / deadline) */
.dtsp-header.dtsp-header {
  font-family: Inter, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Hiragino Sans", "Hiragino Kaku Gothic ProN", ui-sans-serif, system-ui, sans-serif;
}

/* Signature detail: razor-thin 1px machined top-bevel accent reflection,
   aligned to the 20px corner tangent points, fading out before the chip */
.dtsp-header.dtsp-header::before,
.lab-shell .lab-toolbar.lab-toolbar::before,
.lab-toolbar.lab-toolbar::before {
  content: "" !important;
  position: absolute !important;
  inset: 0 20px auto 20px !important;
  width: auto !important;
  height: 1px !important;
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  filter: none !important;
  pointer-events: none !important;
  z-index: 1;
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--_dtsp-accent) 22%,
    var(--dtsp-accent-dim, var(--_dtsp-accent)) 56%,
    transparent 100%
  ) !important;
  opacity: 0.46 !important;
}

@supports (color: color-mix(in oklab, white, black)) {
  .dtsp-header.dtsp-header::before,
  .lab-shell .lab-toolbar.lab-toolbar::before,
  .lab-toolbar.lab-toolbar::before {
    background: linear-gradient(
      90deg,
      transparent 0%,
      color-mix(in oklab, var(--_dtsp-accent) 68%, #ffffff) 22%,
      color-mix(in oklab, var(--_dtsp-accent) 34%, transparent) 58%,
      transparent 100%
    ) !important;
    opacity: 0.56 !important;
  }
}

/* Neutralize any legacy LAB theme decorative pseudo-element glow or scanline */
.lab-shell .lab-toolbar.lab-toolbar::after,
.lab-toolbar.lab-toolbar::after {
  content: none !important;
  display: none !important;
}

/* --------------------------------------------------------------------------
   2. Back Button (.dtsp-header-back & LAB .lab-exit)
   44px height, 10px radius (20 - 10 concentric), 0 14px 0 12px optical pad
   -------------------------------------------------------------------------- */

.dtsp-header.dtsp-header .dtsp-header-back,
.lab-shell .lab-toolbar.lab-toolbar .lab-exit,
.lab-toolbar.lab-toolbar .lab-exit {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 6px !important;
  height: 44px !important;
  min-height: 44px !important;
  max-height: 44px !important;
  width: auto !important;
  min-width: 0 !important;
  box-sizing: border-box !important;
  padding: 0 14px 0 12px !important;
  margin: 0 !important;
  flex: none !important;
  border: 0 !important;
  border-radius: 10px !important;
  background-color: var(--_dtsp-btn-bg) !important;
  background-image: none !important;
  box-shadow: var(--_dtsp-btn-shadow) !important;
  color: var(--_dtsp-btn-ink) !important;
  text-decoration: none !important;
  font-size: 14px !important;
  font-weight: 500 !important;
  line-height: 1 !important;
  letter-spacing: 0.01em !important;
  white-space: nowrap !important;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  transition:
    background-color 150ms var(--_dtsp-ease),
    color 150ms var(--_dtsp-ease),
    box-shadow 150ms var(--_dtsp-ease),
    transform 140ms var(--_dtsp-ease);
}

/* Guard against legacy LAB rule that hid the 「戻る」 label text */
.dtsp-header.dtsp-header .dtsp-header-back span,
.lab-shell .lab-toolbar.lab-toolbar .lab-exit span,
.lab-toolbar.lab-toolbar .lab-exit span,
.lab-shell .lab-toolbar.lab-toolbar.dtsp-with-sync .lab-exit span:last-child,
.lab-toolbar.lab-toolbar.dtsp-with-sync .lab-exit span:last-child {
  display: inline !important;
  line-height: 1 !important;
}

.dtsp-header.dtsp-header .dtsp-header-back svg,
.lab-shell .lab-toolbar.lab-toolbar .lab-exit svg,
.lab-toolbar.lab-toolbar .lab-exit svg {
  flex: none !important;
  display: block !important;
  width: 18px !important;
  height: 18px !important;
  color: currentColor;
  opacity: 0.72;
  stroke-width: 1.75;
  transition:
    transform 150ms var(--_dtsp-ease),
    opacity 150ms var(--_dtsp-ease);
}

/* Hover gated to fine pointers so touch taps never stick in hover state */
@media (hover: hover) and (pointer: fine) {
  .dtsp-header.dtsp-header .dtsp-header-back:hover,
  .lab-shell .lab-toolbar.lab-toolbar .lab-exit:hover,
  .lab-toolbar.lab-toolbar .lab-exit:hover {
    --_dtsp-btn-bg: var(--_dtsp-ghost-bg-hover);
    --_dtsp-btn-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.11);
    --_dtsp-btn-ink: #f5f8fc;
  }

  .dtsp-header.dtsp-header .dtsp-header-back:hover svg,
  .lab-shell .lab-toolbar.lab-toolbar .lab-exit:hover svg,
  .lab-toolbar.lab-toolbar .lab-exit:hover svg {
    opacity: 1;
    transform: translateX(-2px);
  }
}

.dtsp-header.dtsp-header .dtsp-header-back:active,
.lab-shell .lab-toolbar.lab-toolbar .lab-exit:active,
.lab-toolbar.lab-toolbar .lab-exit:active {
  --_dtsp-btn-bg: var(--_dtsp-ghost-bg-active);
  --_dtsp-btn-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.28);
  --_dtsp-btn-ink: #f5f8fc;
  transform: scale(0.96);
}

.dtsp-header.dtsp-header .dtsp-header-back:active svg,
.lab-shell .lab-toolbar.lab-toolbar .lab-exit:active svg,
.lab-toolbar.lab-toolbar .lab-exit:active svg {
  opacity: 1;
  transform: translateX(-2px);
}

.dtsp-header.dtsp-header .dtsp-header-back:focus-visible,
.lab-shell .lab-toolbar.lab-toolbar .lab-exit:focus-visible,
.lab-toolbar.lab-toolbar .lab-exit:focus-visible {
  outline: 2px solid var(--_dtsp-accent);
  outline-offset: 2px;
}

/* --------------------------------------------------------------------------
   3. Title & Kicker (.dtsp-header-title / .dtsp-header-kicker & LAB equivalents)
   Stacked cleanly inside the 44px inner track (11px + 2px + 20px = 33px)
   -------------------------------------------------------------------------- */

.dtsp-header.dtsp-header .dtsp-header-title {
  min-width: 0 !important;
  flex: 1 1 auto !important;
  display: flex !important;
  flex-direction: column !important;
  justify-content: center !important;
  align-items: flex-start !important;
  gap: 2px !important;
  overflow: hidden !important;
  margin: 0 !important;
  padding: 0 !important;
}

.dtsp-header.dtsp-header .dtsp-header-kicker,
.lab-shell .lab-toolbar.lab-toolbar .lab-toolbar-kicker,
.lab-toolbar.lab-toolbar .lab-toolbar-kicker {
  display: block;
  flex: none !important;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: 0 !important;
  padding: 0 !important;
  color: var(--_dtsp-accent) !important;
  font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px !important;
  font-weight: 500 !important;
  line-height: 1.1 !important;
  letter-spacing: 0.14em !important;
  text-transform: uppercase;
  font-variant-numeric: tabular-nums;
}

.dtsp-header.dtsp-header .dtsp-header-title strong {
  display: block !important;
  max-width: 100%;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
  margin: 0 !important;
  padding: 0 !important;
  color: var(--_dtsp-ink-1) !important;
  font-size: 16px !important;
  font-weight: 600 !important;
  line-height: 1.25 !important;
  letter-spacing: 0 !important;
}

/* LAB title rules: handle both DOM layouts seamlessly
   (A) wrapper > .lab-toolbar-kicker + .lab-toolbar-title
   (B) .lab-toolbar-title > .lab-toolbar-kicker + strong/span/text */
.lab-toolbar.lab-toolbar > :has(> .lab-toolbar-title) {
  min-width: 0 !important;
  flex: 1 1 auto !important;
  display: flex !important;
  flex-direction: column !important;
  justify-content: center !important;
  align-items: flex-start !important;
  gap: 2px !important;
  overflow: hidden !important;
  margin: 0 !important;
  padding: 0 !important;
}

.lab-shell .lab-toolbar.lab-toolbar .lab-toolbar-title,
.lab-toolbar.lab-toolbar .lab-toolbar-title {
  min-width: 0;
  max-width: 100%;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
  color: var(--_dtsp-ink-1) !important;
  font-size: 16px !important;
  font-weight: 600 !important;
  line-height: 1.25 !important;
  letter-spacing: 0 !important;
}

.lab-toolbar.lab-toolbar > .lab-toolbar-title {
  flex: 1 1 auto !important;
}

.lab-toolbar.lab-toolbar .lab-toolbar-title:has(.lab-toolbar-kicker) {
  display: flex !important;
  flex-direction: column !important;
  justify-content: center !important;
  align-items: flex-start !important;
  gap: 2px !important;
}

.lab-toolbar.lab-toolbar .lab-toolbar-title:has(.lab-toolbar-kicker) > :not(.lab-toolbar-kicker) {
  display: block !important;
  max-width: 100%;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
  margin: 0 !important;
  padding: 0 !important;
  color: var(--_dtsp-ink-1) !important;
  font-size: 16px !important;
  font-weight: 600 !important;
  line-height: 1.25 !important;
  letter-spacing: 0 !important;
}

/* --------------------------------------------------------------------------
   4. Sync Chip Slot & Recessed Telemetry Chip (.dtsp-header-slot / .dtsp-chip)
   32px visible height (44px touch target via ::after), 6px radius, 0 12px pad
   -------------------------------------------------------------------------- */

.dtsp-header.dtsp-header .dtsp-header-slot,
.lab-shell .lab-toolbar.lab-toolbar [data-sync-slot],
.lab-toolbar.lab-toolbar [data-sync-slot] {
  position: relative !important;
  display: flex !important;
  align-items: center !important;
  justify-content: flex-end !important;
  flex: none !important;
  margin: 0 0 0 auto !important;
  padding: 0 !important;
  min-width: 79px;
  min-height: 32px;
}

.dtsp-chip.dtsp-chip {
  /* Self-contained defaults so chip stays consistent in any mount context */
  --_dtsp-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --_chip-bg: rgba(7, 9, 14, 0.56);
  --_chip-bg-hover: rgba(20, 25, 36, 0.78);
  --_chip-bg-active: rgba(6, 8, 12, 0.74);
  --_chip-ring: rgba(255, 255, 255, 0.11);
  --_chip-ring-hover: rgba(255, 255, 255, 0.22);
  --_chip-ink: #dde6f2;
  --_chip-ink-hover: #f5f8fc;
  --_dot-bg: #4cc38a;

  /* Always in-flow inside the header — never floats over page content */
  position: relative !important;
  inset: auto !important;
  z-index: auto !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 8px !important;
  height: 32px !important;
  min-height: 0 !important;
  max-height: 32px !important;
  width: auto !important;
  box-sizing: border-box !important;
  padding: 0 12px !important;
  margin: 0 !important;
  flex: none !important;
  align-self: center !important;
  justify-self: center !important;

  border: 0 !important;
  border-radius: 6px !important;
  background-color: var(--_chip-bg) !important;
  background-image: none !important;
  box-shadow:
    inset 0 0 0 1px var(--_chip-ring),
    inset 0 1px 2px rgba(0, 0, 0, 0.30),
    0 1px 0 rgba(255, 255, 255, 0.05) !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;

  color: var(--_chip-ink) !important;
  font: 600 10.5px/1 ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Hiragino Sans", "Hiragino Kaku Gothic ProN", sans-serif !important;
  font-variant-numeric: tabular-nums !important;
  letter-spacing: 0.04em !important;
  text-transform: uppercase !important;
  text-decoration: none !important;
  white-space: nowrap !important;

  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;

  transition:
    background-color 150ms var(--_dtsp-ease),
    color 150ms var(--_dtsp-ease),
    box-shadow 150ms var(--_dtsp-ease),
    transform 140ms var(--_dtsp-ease);
}

/* Extend touch hit area vertically to 44px inside the bounded slot container
   (safe even if JS applies inline position:static!important on .dtsp-chip) */
.dtsp-header-slot > .dtsp-chip.dtsp-chip::after,
[data-sync-slot] > .dtsp-chip.dtsp-chip::after {
  content: "";
  position: absolute;
  inset: -6px -4px;
  border-radius: 10px;
}

.dtsp-chip .dtsp-chip-label {
  font: inherit !important;
  color: inherit !important;
  letter-spacing: inherit !important;
  line-height: 1 !important;
}

.dtsp-chip.dtsp-chip-bar {
  display: flex !important;
  position: relative !important;
  width: 100% !important;
  border-radius: 0 !important;
  justify-content: center !important;
}

/* 8px rotated diamond indicator — carries semantic color without glow */
.dtsp-dot {
  width: 8px !important;
  height: 8px !important;
  flex: none !important;
  border-radius: 0 !important;
  background-color: var(--_dot-bg, #4cc38a) !important;
  box-shadow: none !important;
  transform: rotate(45deg);
  transform-origin: center;
  transition: background-color 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

/* --------------------------------------------------------------------------
   5. Sync Chip Semantic States (all 6 states, muted contrast, zero glow)
   -------------------------------------------------------------------------- */

/* OK: normal / calm */
.dtsp-chip.dtsp-chip[data-kind="ok"] {
  --_dot-bg: #4cc38a;
  --_chip-bg: rgba(7, 9, 14, 0.56);
  --_chip-bg-hover: rgba(20, 25, 36, 0.78);
  --_chip-bg-active: rgba(5, 7, 11, 0.72);
  --_chip-ring: rgba(255, 255, 255, 0.11);
  --_chip-ring-hover: rgba(255, 255, 255, 0.22);
  --_chip-ink: #dde6f2;
  --_chip-ink-hover: #f5f8fc;
}

/* SYNC: active transfer */
.dtsp-chip.dtsp-chip[data-kind="syncing"] {
  --_dot-bg: #22d3ee;
  --_chip-bg: rgba(10, 22, 29, 0.68);
  --_chip-bg-hover: rgba(14, 30, 40, 0.84);
  --_chip-bg-active: rgba(8, 17, 23, 0.78);
  --_chip-ring: rgba(34, 211, 238, 0.30);
  --_chip-ring-hover: rgba(34, 211, 238, 0.50);
  --_chip-ink: #e2f5f9;
  --_chip-ink-hover: #f2fbfd;
}

.dtsp-chip.dtsp-chip[data-kind="syncing"] .dtsp-dot {
  animation: dtsp-pulse 1.1s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

/* 競合: requires user attention */
.dtsp-chip.dtsp-chip[data-kind="conflict"] {
  --_dot-bg: #fbbf24;
  --_chip-bg: rgba(28, 22, 11, 0.70);
  --_chip-bg-hover: rgba(38, 30, 15, 0.84);
  --_chip-bg-active: rgba(22, 17, 9, 0.80);
  --_chip-ring: rgba(251, 191, 36, 0.38);
  --_chip-ring-hover: rgba(251, 191, 36, 0.58);
  --_chip-ink: #fae5b2;
  --_chip-ink-hover: #fef0cc;
}

.dtsp-chip.dtsp-chip[data-kind="conflict"] .dtsp-dot {
  animation: dtsp-pulse 1.8s ease-in-out infinite;
}

/* エラー: static high-clarity alert */
.dtsp-chip.dtsp-chip[data-kind="error"] {
  --_dot-bg: #e5484d;
  --_chip-bg: rgba(30, 13, 16, 0.72);
  --_chip-bg-hover: rgba(42, 17, 21, 0.86);
  --_chip-bg-active: rgba(24, 10, 13, 0.82);
  --_chip-ring: rgba(229, 72, 77, 0.44);
  --_chip-ring-hover: rgba(229, 72, 77, 0.64);
  --_chip-ink: #f8d0d2;
  --_chip-ink-hover: #fce4e6;
}

/* OFF: dormant / sync disabled */
.dtsp-chip.dtsp-chip[data-kind="off"] {
  --_dot-bg: #64748b;
  --_chip-bg: rgba(7, 9, 14, 0.46);
  --_chip-bg-hover: rgba(18, 22, 31, 0.72);
  --_chip-bg-active: rgba(5, 7, 11, 0.62);
  --_chip-ring: rgba(255, 255, 255, 0.08);
  --_chip-ring-hover: rgba(255, 255, 255, 0.18);
  --_chip-ink: #9aa6b8;
  --_chip-ink-hover: #cbd6e6;
}

/* 未確認: awaiting initial check */
.dtsp-chip.dtsp-chip[data-kind="unknown"] {
  --_dot-bg: #64748b;
  --_chip-bg: rgba(7, 9, 14, 0.54);
  --_chip-bg-hover: rgba(20, 25, 36, 0.76);
  --_chip-bg-active: rgba(5, 7, 11, 0.70);
  --_chip-ring: rgba(255, 255, 255, 0.11);
  --_chip-ring-hover: rgba(255, 255, 255, 0.22);
  --_chip-ink: #c8d3e3;
  --_chip-ink-hover: #eef3fa;
}

/* Chip hover / active / focus-visible */
@media (hover: hover) and (pointer: fine) {
  .dtsp-chip.dtsp-chip:hover {
    background-color: var(--_chip-bg-hover) !important;
    color: var(--_chip-ink-hover) !important;
    box-shadow:
      inset 0 0 0 1px var(--_chip-ring-hover),
      inset 0 1px 2px rgba(0, 0, 0, 0.24),
      0 1px 0 rgba(255, 255, 255, 0.07) !important;
  }
}

.dtsp-chip.dtsp-chip:active {
  background-color: var(--_chip-bg-active) !important;
  color: var(--_chip-ink-hover) !important;
  box-shadow:
    inset 0 0 0 1px var(--_chip-ring-hover),
    inset 0 1px 3px rgba(0, 0, 0, 0.44) !important;
  transform: scale(0.96);
}

.dtsp-chip.dtsp-chip:focus-visible {
  outline: 2px solid var(--_dtsp-accent, var(--dtsp-accent, rgba(237, 245, 255, 0.80)));
  outline-offset: 2px;
}

@keyframes dtsp-pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.32;
  }
}

/* --------------------------------------------------------------------------
   6. Responsive (Mobile <= 600px: preserve 64px skeleton, hide kicker, gap 8px)
   -------------------------------------------------------------------------- */

@media (max-width: 600px) {
  .dtsp-header.dtsp-header,
  .lab-shell .lab-toolbar.lab-toolbar,
  .lab-toolbar.lab-toolbar {
    gap: 8px !important;
  }

  .dtsp-header.dtsp-header .dtsp-header-kicker,
  .lab-shell .lab-toolbar.lab-toolbar .lab-toolbar-kicker,
  .lab-toolbar.lab-toolbar .lab-toolbar-kicker {
    display: none !important;
  }
}

/* --------------------------------------------------------------------------
   7. Accessibility: Reduced Motion & Forced Colors
   -------------------------------------------------------------------------- */

@media (prefers-reduced-motion: reduce) {
  .dtsp-header.dtsp-header .dtsp-header-back,
  .lab-shell .lab-toolbar.lab-toolbar .lab-exit,
  .lab-toolbar.lab-toolbar .lab-exit,
  .dtsp-chip.dtsp-chip {
    transition:
      background-color 120ms ease,
      color 120ms ease,
      box-shadow 120ms ease;
  }

  .dtsp-header.dtsp-header .dtsp-header-back:active,
  .lab-shell .lab-toolbar.lab-toolbar .lab-exit:active,
  .lab-toolbar.lab-toolbar .lab-exit:active,
  .dtsp-chip.dtsp-chip:active {
    transform: none !important;
  }

  .dtsp-header.dtsp-header .dtsp-header-back svg,
  .lab-shell .lab-toolbar.lab-toolbar .lab-exit svg,
  .lab-toolbar.lab-toolbar .lab-exit svg {
    transition: opacity 120ms ease;
    transform: none !important;
  }

  .dtsp-chip.dtsp-chip[data-kind="syncing"] .dtsp-dot,
  .dtsp-chip.dtsp-chip[data-kind="conflict"] .dtsp-dot {
    animation: none !important;
    opacity: 1 !important;
  }
}

@media (forced-colors: active) {
  .dtsp-header.dtsp-header,
  .lab-shell .lab-toolbar.lab-toolbar,
  .lab-toolbar.lab-toolbar {
    border: 1px solid CanvasText !important;
  }

  .dtsp-header.dtsp-header .dtsp-header-back,
  .lab-shell .lab-toolbar.lab-toolbar .lab-exit,
  .lab-toolbar.lab-toolbar .lab-exit,
  .dtsp-chip.dtsp-chip {
    border: 1px solid ButtonBorder !important;
  }

  .dtsp-dot {
    forced-color-adjust: none;
  }
}


/* Long-label guard: the frame never breaks — an over-long status truncates */
.dtsp-chip.dtsp-chip { max-width: min(240px, 60vw); }
.dtsp-chip .dtsp-chip-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .dtsp-chip.dtsp-chip-docked{position:relative!important}

  .dtsp-panel:not([hidden]){display:block}
  .dtsp-panel.dtsp-panel{position:fixed;z-index:2147482001;left:10px;right:10px;top:76px;
    background:rgba(5,12,22,.97);border:1px solid rgba(34,211,238,.55);border-radius:6px;
    box-shadow:0 0 28px rgba(34,211,238,.25),0 18px 50px rgba(0,0,0,.6);color:#e6f6ff;
    font:13px/1.55 -apple-system,"Hiragino Kaku Gothic ProN",sans-serif;padding:16px;
    max-height:min(78vh,640px);overflow-y:auto;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
  @media (min-width:640px){.dtsp-panel.dtsp-panel{left:auto;right:16px;top:76px;width:352px}}
  .dtsp-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;border-bottom:1px solid rgba(34,211,238,.25);padding-bottom:10px;margin-bottom:12px}
  .dtsp-title{font:700 12px/1.3 ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#67e8f9}
  .dtsp-tool{font-size:15px;font-weight:700;margin-top:3px}
  .dtsp-close{background:none;border:1px solid rgba(148,197,255,.35);color:#bae6fd;border-radius:4px;
    font:600 11px ui-monospace,Menlo,monospace;letter-spacing:.1em;padding:6px 10px;cursor:pointer;flex:none}
  .dtsp-close:active{transform:scale(.96)}
  .dtsp-row{display:flex;justify-content:space-between;gap:16px;padding:5px 0;border-bottom:1px dashed rgba(103,232,249,.14)}
  .dtsp-row dt{color:#8fb8cc;flex:none}
  .dtsp-row dd{margin:0;text-align:right;font-weight:600;word-break:break-all}
  .dtsp-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
  .dtsp-sec{margin-top:14px}
  .dtsp-sec h4{margin:0 0 6px;font:700 11px ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#67e8f9}
  .dtsp-conflict{border:1px solid rgba(251,191,36,.55);background:rgba(251,191,36,.07);border-radius:4px;padding:9px 11px;margin-bottom:8px}
  .dtsp-conflict .k{font-family:ui-monospace,Menlo,monospace;font-size:11px;word-break:break-all;color:#fde68a}
  .dtsp-conflict .r{font-size:12px;margin-top:2px}
  .dtsp-note{font-size:12px;color:#a8c6d8}
  .dtsp-rev{display:flex;justify-content:space-between;gap:12px;padding:3px 0;border-bottom:1px dashed rgba(103,232,249,.12);font-size:12px}
  .dtsp-rev .k{font-family:ui-monospace,Menlo,monospace;word-break:break-all;color:#bfe9ff}
  .dtsp-rev .v{font-family:ui-monospace,Menlo,monospace;color:#67e8f9;flex:none}
  .dtsp-actions{display:flex;gap:8px;margin-top:16px}
  .dtsp-btn{flex:1;text-align:center;background:rgba(34,211,238,.14);border:1px solid rgba(34,211,238,.6);color:#e0faff;
    border-radius:4px;padding:11px 8px;font-weight:700;font-size:13px;cursor:pointer;text-decoration:none;display:block}
  .dtsp-btn:active{transform:scale(.97)}
  .dtsp-btn.sub{background:transparent;border-color:rgba(148,197,255,.35);color:#bae6fd}
  .dtsp-btn[disabled]{opacity:.55;pointer-events:none}
  `;

  function init() {
    const appKey = detectAppKey();
    if (!appKey) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'dtsp-chip';
    chip.setAttribute('aria-haspopup', 'dialog');
    chip.innerHTML = '<span class="dtsp-dot"></span><span class="dtsp-chip-label"></span>';
    /* 統一チップの寸法・書体はインライン !important で固定する。
       ツール側の ID セレクタ規則（#ntc-root header button 等）にも負けない。 */
    chip.style.cssText = 'height:32px!important;min-height:0!important;padding:0 12px!important;'
      + 'font:600 10.5px/1 ui-monospace,SFMono-Regular,Menlo,monospace!important;'
      + 'display:inline-flex!important;align-items:center!important;align-self:center!important;justify-self:center!important;'
      + 'flex:none!important;gap:8px!important;white-space:nowrap!important;cursor:pointer';
    /* フロート禁止: 同期状態は必ずヘッダーの中（またはページ最上部の帯）に置く。
       LABページ … 統一ヘッダー .lab-toolbar の2行目に格納
       data-sync-slot … ツールが用意した格納場所
       自前バッジ … ツール自身のヘッダー表示をそのまま使い、チップは作らない
       どれも無い … body 先頭にインフローの帯として挿入 */
    /* 全ツール共通ヘッダー (2026-11-19 Kaneko指示): 同じ見た目のバーを全ツールに置き、
       ツール名と同期チップを表示する。色だけ各ページの世界観に合わせる。 */
    const HEADER_THEME = {
      manga: '#fb923c', novel: '#3fa58c', movie: '#fbbf24', feeding: '#a3e635',
      timetable: '#4ade80', diary: '#f9a8d4', task_calendar: '#22d3ee', calendar: '#818cf8',
      report_card: '#fbbf24', score_book: '#38bdf8', tasklist: '#94a3b8', payment: '#34d399',
      vocal_range: '#f472b6', library: '#fbbf24', weight_log: '#06b6d4', shift_clock: '#22d3ee',
      taskmanage: '#818cf8', math_memo: '#a78bfa', ritual_grid: '#c084fc', oshi: '#f472b6',
      biome_archive: '#4ade80'
    };
    const HEADER_INSERT = {
      manga: ['.ms-header', 'before'], novel: ['.ns-header', 'before'], movie: ['.mt-header', 'before'],
      feeding: ['.fl-header', 'before'], timetable: ['.cmd-bar', 'before'],
      diary: ['.sd-header', 'before'], task_calendar: ['#ntc-root > div', 'prepend'],
      calendar: ['.cg-header', 'before'], report_card: ['.rc5-top', 'before'],
      score_book: ['.sb-topbar', 'before'], tasklist: ['#root', 'prepend'],
      payment: ['.cn-header', 'before'], vocal_range: ['.vr-head', 'before'],
      library: ['.bs-toolbar', 'before'], weight_log: ['.wl-topbar', 'before'],
      shift_clock: ['.sc-hdr', 'before'], taskmanage: ['.km-topbar', 'before'],
      math_memo: ['.mm-app', 'prepend'], ritual_grid: ['.rg-header', 'before'],
      oshi: ['.odb-header', 'before'], biome_archive: ['.ba-header', 'before']
    };
    let commonHeader = null;
    function hexToRgba(hex, a) {
      const n = parseInt(hex.slice(1), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    }
    function buildCommonHeader() {
      const accent = HEADER_THEME[appKey] || '#67e8f9';
      const name = (document.title || '').split('·')[0].split('|')[0].trim() || appKey.toUpperCase();
      const back = window.location.pathname.startsWith('/0723/') ? '/0723/' : '/';
      const el = document.createElement('div');
      el.className = 'dtsp-header';
      el.style.setProperty('--dtsp-accent', accent);
      el.style.setProperty('--dtsp-accent-dim', hexToRgba(accent, 0.16));
      el.style.setProperty('--dtsp-accent-soft', hexToRgba(accent, 0.45));
      el.innerHTML = '<a class="dtsp-header-back" href="' + back + '" aria-label="戻る"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg><span>戻る</span></a>'
        + '<div class="dtsp-header-title"><span class="dtsp-header-kicker">DT // TOOL</span><strong></strong></div>'
        + '<span class="dtsp-header-slot"></span>';
      el.querySelector('strong').textContent = name;
      /* ツール側のリセットCSS (.km * 等) に padding を消されるページがあるため、
         ヘッダーの骨格寸法はインライン !important で固定する (チップと同じ方針)。 */
      el.style.cssText = 'display:flex!important;align-items:center!important;gap:12px!important;'
        + 'height:64px!important;box-sizing:border-box!important;width:100%!important;'
        + 'padding:10px 12px!important;margin:0 auto 16px!important';
      const backBtn = el.querySelector('.dtsp-header-back');
      if (backBtn) backBtn.style.cssText = 'display:inline-flex!important;align-items:center!important;gap:6px!important;'
        + 'height:44px!important;padding:0 14px 0 12px!important;flex:none!important';
      return el;
    }
    function injectCommonHeader() {
      if (commonHeader && document.contains(commonHeader)) return true;
      const spec = HEADER_INSERT[appKey];
      let placed = false;
      if (spec) {
        const target = document.querySelector(spec[0]);
        if (target && target.parentElement) {
          commonHeader = buildCommonHeader();
          if (spec[1] === 'prepend') target.insertBefore(commonHeader, target.firstChild);
          else target.parentElement.insertBefore(commonHeader, target);
          placed = true;
        }
      }
      if (!placed) {
        const ref = findDockContainer(appKey) || findLegacy(appKey);
        const bar = ref ? (ref.closest('header') || ref.parentElement) : null;
        if (bar && bar.parentElement) {
          commonHeader = buildCommonHeader();
          bar.parentElement.insertBefore(commonHeader, bar);
          placed = true;
        }
      }
      if (placed && commonHeader) {
        chip.classList.remove('dtsp-chip-bar');
        chip.classList.add('dtsp-chip-docked');
        commonHeader.querySelector('.dtsp-header-slot').appendChild(chip);
        hideLegacy();
      }
      return placed;
    }

    let anchor = chip;
    const toolbar = document.querySelector('.lab-toolbar');
    const slot = document.querySelector('[data-sync-slot]');
    let inToolbar = false;
    const compactChip = () => true; /* 表示文言は全ツール共通の短ラベルに統一 */
    const rendered = (el) => !!el && el.getClientRects().length > 0;
    function hideLegacy() {
      for (const sel of LEGACY_TARGETS[appKey] || []) {
        try {
          document.querySelectorAll(sel).forEach((el) => {
            el.style.display = 'none';
            el.dataset.dtspLegacyHidden = 'true';
          });
        } catch (_) { /* bad selector */ }
      }
    }
    function dockBeforeLegacy(el) {
      chip.classList.remove('dtsp-chip-bar');
      chip.classList.add('dtsp-chip-docked');
      el.parentNode.insertBefore(chip, el);
      hideLegacy();
    }
    function watchRelocation(fromBar) {
      const obs = new MutationObserver(() => {
        if (!toolbar && !commonHeader && injectCommonHeader()) { obs.disconnect(); return; }
        if (commonHeader) { hideLegacy(); return; }
        const box = findDockContainer(appKey);
        if (box && rendered(box) && !box.contains(chip)) {
          chip.classList.remove('dtsp-chip-bar');
          chip.classList.add('dtsp-chip-docked');
          box.appendChild(chip);
          hideLegacy();
          obs.disconnect();
          return;
        }
        const b = findLegacy(appKey);
        if (!b) return;
        const wasRendered = rendered(b);
        hideLegacy();
        if (fromBar && wasRendered && chip.classList.contains('dtsp-chip-bar')) {
          dockBeforeLegacy(b);
          obs.disconnect();
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      window.setTimeout(() => obs.disconnect(), 30000);
    }
    if (toolbar) {
      chip.classList.add('dtsp-chip-docked');
      toolbar.classList.add('dtsp-with-sync');
      (toolbar.querySelector('[data-sync-slot]') || toolbar).appendChild(chip);
      inToolbar = true;
      hideLegacy();
      watchRelocation(false);
    } else if (injectCommonHeader()) {
      watchRelocation(false);
    } else if (slot) {
      chip.classList.add('dtsp-chip-docked');
      slot.appendChild(chip);
      hideLegacy();
      watchRelocation(false);
    } else if (findDockContainer(appKey)) {
      chip.classList.add('dtsp-chip-docked');
      findDockContainer(appKey).appendChild(chip);
      hideLegacy();
      watchRelocation(false);
    } else if (rendered(findLegacy(appKey))) {
      dockBeforeLegacy(findLegacy(appKey));
      watchRelocation(false);
    } else {
      chip.classList.add('dtsp-chip-bar');
      document.body.insertBefore(chip, document.body.firstChild);
      watchRelocation(true);
    }

    const panel = document.createElement('div');
    panel.className = 'dtsp-panel';
    /* 映画ツールはテーマ chrome 一括非表示の都合で .mt-overlay だけが非表示化を免れる */
    if (appKey === 'movie') panel.classList.add('mt-overlay');
    if (appKey === 'manga') panel.classList.add('ms-overlay');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '同期状態');
    panel.hidden = true;
    document.body.appendChild(panel);

    let revisionsLoaded = false;

    const SHORT_LABEL = { ok: 'OK', conflict: '競合', error: 'エラー', off: 'OFF', unknown: '未確認', syncing: 'SYNC' };
    function renderChip(state) {
      chip.dataset.kind = state.kind;
      chip.querySelector('.dtsp-chip-label').textContent = compactChip() ? (SHORT_LABEL[state.kind] || state.label) : `SYNC · ${state.label}`;
      chip.setAttribute('aria-label', `同期状態: ${state.label}。詳細を開く`);
      chip.setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
    }

    function renderPanel(state) {
      const tool = TOOL_NAMES[appKey] || appKey;
      const statusText = { ok: '正常', conflict: '競合あり', error: 'エラー', off: 'オフ', unknown: '未確認' }[state.kind];
      let html = `
      <div class="dtsp-head">
        <div><div class="dtsp-title">SYNC STATUS</div><div class="dtsp-tool">${tool}</div></div>
        <button type="button" class="dtsp-close" data-act="close">CLOSE</button>
      </div>
      <dl style="margin:0">
        <div class="dtsp-row"><dt>同期先</dt><dd>${state.kind === 'off' ? 'オフ（この端末のみ）' : 'D1（Cloudflare）'}</dd></div>
        <div class="dtsp-row"><dt>状態</dt><dd>${statusText}</dd></div>
        <div class="dtsp-row"><dt>前回同期</dt><dd>${state.last ? `${fmtTime(state.last.at)}${fmtRelative(state.last.at)}` : '記録なし'}</dd></div>
        <div class="dtsp-row"><dt>結果</dt><dd>${lastSummary(state.last)}</dd></div>
      </dl>`;
      if (state.conflicts.length) {
        html += '<div class="dtsp-sec"><h4>保留中の競合</h4>';
        for (const c of state.conflicts) {
          html += `<div class="dtsp-conflict"><div class="k">${shortKey(c.recordKey)}</div><div class="r">${REASON_JA[c.reason] || c.reason || '原因不明'}</div></div>`;
        }
        html += '<p class="dtsp-note">競合がある間、このツールの表示はD1の最新に追随しません。Sync Settings の「競合を安全に解消」から直せます。</p></div>';
      }
      html += `<div class="dtsp-sec"><h4>D1の現在値（revision）</h4><div data-rev>${
        revisionsLoaded ? '' : '<p class="dtsp-note" style="margin:0">開くたびに最新の revision を取得します。</p>'
      }</div></div>`;
      html += `<div class="dtsp-actions">
        <button type="button" class="dtsp-btn" data-act="sync">今すぐ同期</button>
        <a class="dtsp-btn sub" href="${SETTINGS_URL}">Sync Settings</a>
      </div>`;
      panel.innerHTML = html;
      panel.querySelector('[data-act="close"]').addEventListener('click', closePanel);
      panel.querySelector('[data-act="sync"]').addEventListener('click', onSyncNow);
    }

    async function loadRevisions() {
      const box = panel.querySelector('[data-rev]');
      if (!box) return;
      box.innerHTML = '<p class="dtsp-note" style="margin:0">取得中…</p>';
      try {
        const baseUrl = window.localStorage.getItem('dt_sync_gateway_url') || '';
        const syncKey = window.localStorage.getItem('dt_sync_gateway_key') || '';
        if (!baseUrl || !syncKey || !window.DTSyncGatewayClient) {
          box.innerHTML = '<p class="dtsp-note" style="margin:0">接続設定がないため取得できません（Sync Settingsで設定）。</p>';
          return;
        }
        const client = window.DTSyncGatewayClient.createLive({ baseUrl, syncKey, timeoutMs: 7000, retries: 1 });
        const result = await client.getSnapshot(appKey);
        const records = result && result.ok !== false
          ? ((result.data && result.data.records) || result.records || []) : null;
        if (!records) {
          box.innerHTML = '<p class="dtsp-note" style="margin:0">取得に失敗しました。通信状態を確認してください。</p>';
          return;
        }
        revisionsLoaded = true;
        const rows = records.slice(0, 12).map(r =>
          `<div class="dtsp-rev"><span class="k">${shortKey(r.recordKey)}${r.deletedAt ? '（削除済み）' : ''}</span><span class="v">rev ${r.revision}</span></div>`).join('');
        box.innerHTML = rows + (records.length > 12 ? `<p class="dtsp-note">他 ${records.length - 12} 件</p>` : '');
      } catch (_) {
        box.innerHTML = '<p class="dtsp-note" style="margin:0">取得に失敗しました。通信状態を確認してください。</p>';
      }
    }

    async function onSyncNow(ev) {
      const btn = ev.currentTarget;
      btn.setAttribute('disabled', '');
      btn.textContent = '同期中…';
      try {
        if (window.DTD1Runtime && typeof window.DTD1Runtime.syncAppNow === 'function') {
          await window.DTD1Runtime.syncAppNow(appKey);
        }
      } catch (_) { /* result is reflected via stored state below */ }
      revisionsLoaded = false;
      refresh();
      if (!panel.hidden) loadRevisions();
    }

    function refresh() {
      const state = currentState(appKey);
      renderChip(state);
      if (!panel.hidden) renderPanel(state);
      return state;
    }

    function openPanel() {
      panel.hidden = false;
      revisionsLoaded = false;
      refresh();
      loadRevisions();
      anchor.setAttribute('aria-expanded', 'true');
    }
    function closePanel() {
      panel.hidden = true;
      anchor.setAttribute('aria-expanded', 'false');
    }
    anchor.addEventListener('click', togglePanel);
    function togglePanel() { panel.hidden ? openPanel() : closePanel(); }
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) closePanel(); });
    document.addEventListener('pointerdown', e => {
      if (!panel.hidden && !panel.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closePanel();
    });
    window.addEventListener('dt-d1-sync-status', e => {
      if (!e.detail || e.detail.appKey !== appKey) return;
      if (e.detail.status === 'syncing') {
        chip.dataset.kind = 'syncing';
        chip.querySelector('.dtsp-chip-label').textContent = 'SYNC';
        return;
      }
      window.setTimeout(refresh, 60);
    });
    window.addEventListener('pageshow', refresh);
    window.addEventListener('focus', refresh);

    refresh();
    /* 初回同期（ページ表示の約2.5秒後に自動実行）の結果を拾うため、少し遅れて再描画する */
    window.setTimeout(refresh, 4000);
    window.setTimeout(refresh, 12000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

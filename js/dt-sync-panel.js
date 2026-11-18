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
  .dtsp-chip{position:fixed;right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));z-index:2147482000;
    display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;
    background:rgba(6,14,24,.9);border:1px solid rgba(34,211,238,.5);border-radius:4px;
    box-shadow:0 0 14px rgba(34,211,238,.22),inset 0 0 10px rgba(34,211,238,.07);
    color:#dff6ff;font:600 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;
    backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
  .dtsp-chip:active{transform:scale(.96)}
  .dtsp-dot{width:8px;height:8px;transform:rotate(45deg);background:#34d399;box-shadow:0 0 8px #34d399;flex:none}
  .dtsp-chip[data-kind="conflict"]{border-color:rgba(251,191,36,.75);box-shadow:0 0 16px rgba(251,191,36,.35),inset 0 0 10px rgba(251,191,36,.1)}
  .dtsp-chip[data-kind="conflict"] .dtsp-dot{background:#fbbf24;box-shadow:0 0 9px #fbbf24;animation:dtsp-pulse 1.6s ease-in-out infinite}
  .dtsp-chip[data-kind="error"]{border-color:rgba(248,113,113,.75);box-shadow:0 0 16px rgba(248,113,113,.3)}
  .dtsp-chip[data-kind="error"] .dtsp-dot{background:#f87171;box-shadow:0 0 9px #f87171}
  .dtsp-chip[data-kind="off"] .dtsp-dot,.dtsp-chip[data-kind="unknown"] .dtsp-dot{background:#64748b;box-shadow:none}
  .dtsp-chip[data-kind="syncing"] .dtsp-dot{background:#22d3ee;box-shadow:0 0 9px #22d3ee;animation:dtsp-pulse 1s ease-in-out infinite}
  @keyframes dtsp-pulse{50%{opacity:.35}}
  @media (prefers-reduced-motion:reduce){.dtsp-chip .dtsp-dot{animation:none}}
  .dtsp-panel{position:fixed;z-index:2147482001;left:10px;right:10px;bottom:max(10px,env(safe-area-inset-bottom));
    background:rgba(5,12,22,.97);border:1px solid rgba(34,211,238,.55);border-radius:6px;
    box-shadow:0 0 28px rgba(34,211,238,.25),0 18px 50px rgba(0,0,0,.6);color:#e6f6ff;
    font:13px/1.55 -apple-system,"Hiragino Kaku Gothic ProN",sans-serif;padding:16px;
    max-height:min(78vh,640px);overflow-y:auto;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
  @media (min-width:640px){.dtsp-panel{left:auto;right:16px;bottom:60px;width:352px}}
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
    document.body.appendChild(chip);

    const panel = document.createElement('div');
    panel.className = 'dtsp-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '同期状態');
    panel.hidden = true;
    document.body.appendChild(panel);

    let revisionsLoaded = false;

    function renderChip(state) {
      chip.dataset.kind = state.kind;
      chip.querySelector('.dtsp-chip-label').textContent = `SYNC · ${state.label}`;
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
      chip.setAttribute('aria-expanded', 'true');
    }
    function closePanel() {
      panel.hidden = true;
      chip.setAttribute('aria-expanded', 'false');
    }
    chip.addEventListener('click', () => { panel.hidden ? openPanel() : closePanel(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) closePanel(); });
    document.addEventListener('pointerdown', e => {
      if (!panel.hidden && !panel.contains(e.target) && e.target !== chip && !chip.contains(e.target)) closePanel();
    });
    window.addEventListener('dt-d1-sync-status', e => {
      if (!e.detail || e.detail.appKey !== appKey) return;
      if (e.detail.status === 'syncing') {
        chip.dataset.kind = 'syncing';
        chip.querySelector('.dtsp-chip-label').textContent = 'SYNC · 同期中';
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

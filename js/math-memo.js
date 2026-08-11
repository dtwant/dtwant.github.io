/* Math Memo: local-first Markdown notes with centered TeX and additive JSONBin sync. */
(function () {
  'use strict';

  const root = document.querySelector('[data-mm-root]');
  if (!root) return;

  const STORE_KEY = 'dt_0723_math_memo_v1';
  const IMPORT_BACKUP_KEY = 'dt_0723_math_memo_import_backup';
  const BIN_KEY = 'dt_math_memo_blob';
  const APP_KEY = 'math_memo';
  const DEVICE_KEY = 'dt_math_memo_device_id';
  const CHANNEL_NAME = 'dt_0723_math_memo';
  const BIN_URL = 'https://api.jsonbin.io/v3/b';
  const now = () => new Date().toISOString();
  const uid = (prefix) => {
    const random = (window.crypto && typeof window.crypto.randomUUID === 'function')
      ? window.crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    return `${prefix || 'mm'}_${random}`;
  };
  const deviceId = () => {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) { id = uid('device'); localStorage.setItem(DEVICE_KEY, id); }
    return id;
  };

  const els = {
    title: root.querySelector('[data-mm-title]'), body: root.querySelector('[data-mm-editor]'), tags: root.querySelector('[data-mm-tags]'),
    list: root.querySelector('[data-mm-doc-list]'), count: root.querySelector('[data-mm-doc-count]'), search: root.querySelector('[data-mm-search]'),
    clearSearch: root.querySelector('[data-mm-action="search-clear"]'), mobileSelect: root.querySelector('[data-mm-mobile-doc-select]'),
    preview: root.querySelector('[data-mm-preview]'), previewStatus: root.querySelector('[data-mm-preview-status]'),
    saveState: root.querySelector('[data-mm-save-state]'), saveLabel: root.querySelector('[data-mm-save-label]'),
    syncStrip: root.querySelector('[data-mm-sync-strip]'), syncLabel: root.querySelector('[data-mm-sync-label]'), syncTime: root.querySelector('[data-mm-sync-time]'),
    syncInput: root.querySelector('[data-mm-bin-input]'), toast: root.querySelector('[data-mm-toast]'), cursor: root.querySelector('[data-mm-cursor]'), wordCount: root.querySelector('[data-mm-word-count]')
  };

  const emptyState = () => {
    const timestamp = now();
    const doc = { id: uid('note'), title: 'はじめてのメモ', body: '# Math Memoへようこそ\n\n数式は `$$` で囲むと、読みやすい表示数式になります。\n\n$$\nE = mc^2\n$$\n\nここから自由に書き換えてください。', tags: ['welcome'], pinned: false, createdAt: timestamp, updatedAt: timestamp };
    return { version: 1, docs: [doc], activeId: doc.id, updatedAt: timestamp, deviceId: deviceId() };
  };
  const asString = (value, fallback) => typeof value === 'string' ? value : (value == null ? fallback : String(value));
  const normalizeDoc = (input) => {
    const value = input && typeof input === 'object' ? input : {};
    const createdAt = asString(value.createdAt, now());
    return {
      ...value,
      id: asString(value.id, uid('note')),
      title: asString(value.title, '無題のメモ').trim().slice(0, 120) || '無題のメモ',
      body: asString(value.body, ''),
      tags: Array.isArray(value.tags) ? value.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 12) : [],
      pinned: value.pinned === true,
      createdAt,
      updatedAt: asString(value.updatedAt, createdAt)
    };
  };
  const normalizeState = (input) => {
    const value = input && typeof input === 'object' ? input : {};
    let docs = Array.isArray(value.docs) ? value.docs.map(normalizeDoc) : [];
    const unique = new Map();
    docs.forEach((doc) => unique.set(doc.id, doc));
    docs = [...unique.values()];
    if (!docs.length) return emptyState();
    const activeId = docs.some((doc) => doc.id === value.activeId) ? value.activeId : docs[0].id;
    return { version: 1, docs, activeId, updatedAt: asString(value.updatedAt, docs.reduce((latest, doc) => doc.updatedAt > latest ? doc.updatedAt : latest, docs[0].updatedAt)), deviceId: asString(value.deviceId, deviceId()) };
  };

  let state;
  try { state = normalizeState(JSON.parse(localStorage.getItem(STORE_KEY) || 'null')); } catch (_) { state = emptyState(); }
  // 初回表示時もウェルカム文書を端末へ確定保存し、リロードで内容が揺れないようにする。
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) { /* storage quota errors are surfaced on the next edit */ }
  let selectedMode = 'split';
  let previewTimer = 0;
  let pushTimer = 0;
  let toastTimer = 0;
  let syncTimer = 0;
  let syncInFlight = false;
  let dirtySinceRemote = false;
  let channel = null;
  try { channel = new BroadcastChannel(CHANNEL_NAME); } catch (_) { channel = null; }

  const activeDoc = () => state.docs.find((doc) => doc.id === state.activeId) || state.docs[0];
  const persist = ({ cloud = true, announce = true } = {}) => {
    state.updatedAt = now();
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    if (channel && announce) channel.postMessage({ type: 'state', source: deviceId(), state });
    if (cloud) schedulePush();
  };
  const setSaveState = (kind, label) => {
    if (els.saveState) els.saveState.dataset.state = kind;
    if (els.saveLabel) els.saveLabel.textContent = label;
  };
  const setSyncState = (kind, label) => {
    if (els.syncStrip) els.syncStrip.dataset.state = kind;
    if (els.syncLabel) els.syncLabel.textContent = label;
  };
  const showToast = (message) => {
    if (!els.toast) return;
    clearTimeout(toastTimer); els.toast.textContent = message; els.toast.dataset.visible = 'true';
    toastTimer = setTimeout(() => { els.toast.dataset.visible = 'false'; }, 2800);
  };
  const formatDate = (value) => {
    try { return new Intl.DateTimeFormat('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); } catch (_) { return ''; }
  };
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

  function renderList() {
    const query = (els.search && els.search.value || '').trim().toLowerCase();
    const docs = [...state.docs].sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const filtered = docs.filter((doc) => !query || `${doc.title} ${doc.body} ${doc.tags.join(' ')}`.toLowerCase().includes(query));
    if (els.count) els.count.textContent = String(state.docs.length);
    if (els.clearSearch) els.clearSearch.hidden = !query;
    if (els.list) {
      els.list.innerHTML = filtered.length ? filtered.map((doc) => `<button type="button" class="mm-doc-item" role="option" aria-selected="${doc.id === state.activeId}" data-mm-doc-id="${escapeHtml(doc.id)}"><span class="mm-doc-icon" aria-hidden="true">${doc.pinned ? '★' : '◇'}</span><span class="mm-doc-copy"><span class="mm-doc-title">${escapeHtml(doc.title)}</span><span class="mm-doc-subtitle">${escapeHtml(doc.tags.length ? `#${doc.tags.join(' #')}` : formatDate(doc.updatedAt))}</span></span></button>`).join('') : '<div class="mm-doc-empty">一致するメモがありません。<br>新しいメモを作成できます。</div>';
    }
    if (els.mobileSelect) {
      els.mobileSelect.innerHTML = docs.map((doc) => `<option value="${escapeHtml(doc.id)}">${escapeHtml(doc.pinned ? `★ ${doc.title}` : doc.title)}</option>`).join('');
      els.mobileSelect.value = state.activeId;
    }
  }

  function updateCounters() {
    if (!els.body) return;
    const before = els.body.value.slice(0, els.body.selectionStart || 0);
    const line = before.split('\n').length;
    const column = before.length - before.lastIndexOf('\n');
    if (els.cursor) els.cursor.textContent = `行 ${line} · 列 ${column}`;
    if (els.wordCount) els.wordCount.textContent = `${els.body.value.length.toLocaleString('ja-JP')}文字`;
  }

  function protectFences(markdown, callback) {
    const saved = [];
    const protectedText = markdown.replace(/```[\s\S]*?```/g, (code) => { const token = `\u0000MMCODE${saved.length}\u0000`; saved.push(code); return token; });
    const result = callback(protectedText);
    return result.replace(/\u0000MMCODE(\d+)\u0000/g, (_, index) => saved[Number(index)] || '');
  }
  function markdownForPreview(markdown) {
    let source = protectFences(String(markdown || ''), (value) => value
      .replace(/(^|\n)[ \t]*\$\$[ \t]*\n([\s\S]*?)\n[ \t]*\$\$[ \t]*(?=\n|$)/g, (_, prefix, tex) => `${prefix}\n<div class="mm-display-math">\\[${escapeHtml(tex.trim())}\\]</div>\n`)
      .replace(/\$\$([^\n$]+)\$\$/g, (_, tex) => `<div class="mm-display-math">\\[${escapeHtml(tex.trim())}\\]</div>`)
      .replace(/\{\{<\s*nl\s*>\}\}/g, '<hr class="mm-nl">')
      .replace(/\{\{<\s*callout\s*>\}\}([\s\S]*?)\{\{<\s*\/callout\s*>\}\}/g, '<div class="mm-callout">$1</div>'));
    if (window.marked && typeof window.marked.parse === 'function') {
      try { return window.marked.parse(source, { gfm: true, breaks: true }); } catch (_) { return `<pre>${escapeHtml(markdown)}</pre>`; }
    }
    return `<pre>${escapeHtml(markdown)}</pre>`;
  }
  function sanitizePreview() {
    if (!els.preview) return;
    els.preview.querySelectorAll('script,iframe,object,embed,form,style,link').forEach((node) => node.remove());
    els.preview.querySelectorAll('*').forEach((node) => {
      [...node.attributes].forEach((attribute) => {
        if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name);
        if ((attribute.name === 'href' || attribute.name === 'src') && /^\s*javascript:/i.test(attribute.value)) node.removeAttribute(attribute.name);
      });
    });
  }
  async function typeset() {
    if (!window.MathJax || !els.preview) return;
    try {
      if (window.MathJax.startup && window.MathJax.startup.promise) await window.MathJax.startup.promise;
      if (typeof window.MathJax.typesetClear === 'function') window.MathJax.typesetClear([els.preview]);
      if (typeof window.MathJax.typesetPromise === 'function') await window.MathJax.typesetPromise([els.preview]);
      if (els.previewStatus) els.previewStatus.textContent = 'プレビューは最新です';
    } catch (_) { if (els.previewStatus) els.previewStatus.textContent = '数式の一部を確認してください'; }
  }
  function renderPreview() {
    const doc = activeDoc(); if (!doc || !els.preview) return;
    els.preview.innerHTML = markdownForPreview(doc.body);
    sanitizePreview();
    if (els.previewStatus) els.previewStatus.textContent = '描画中…';
    clearTimeout(previewTimer); previewTimer = setTimeout(typeset, 20);
  }
  function renderDocument() {
    const doc = activeDoc(); if (!doc) return;
    if (els.title && document.activeElement !== els.title) els.title.value = doc.title;
    if (els.body && document.activeElement !== els.body) els.body.value = doc.body;
    if (els.tags && document.activeElement !== els.tags) els.tags.value = doc.tags.join(', ');
    const star = root.querySelector('[data-mm-action="pin"]'); if (star) { star.textContent = doc.pinned ? '★' : '☆'; star.setAttribute('aria-pressed', String(doc.pinned)); }
    const meta = root.querySelector('[data-mm-meta]'); if (meta) meta.textContent = `${formatDate(doc.updatedAt)} · ${doc.body.length.toLocaleString('ja-JP')}文字`;
    updateCounters(); renderPreview();
  }
  function renderAll() { renderList(); renderDocument(); }
  function setMode(mode) {
    selectedMode = ['edit', 'split', 'preview'].includes(mode) ? mode : 'split'; root.dataset.mmMode = selectedMode;
    root.querySelectorAll('[data-mm-mode]').forEach((button) => { if (button.tagName === 'BUTTON') { button.setAttribute('aria-selected', String(button.dataset.mmMode === selectedMode)); } });
  }
  function updateActive(fields) {
    const doc = activeDoc(); if (!doc) return;
    Object.assign(doc, fields, { updatedAt: now() }); dirtySinceRemote = true; setSaveState('saving', '保存中…'); persist();
    renderList(); renderPreview();
    window.setTimeout(() => { if (els.saveState && els.saveState.dataset.state === 'saving') setSaveState('saved', '保存済み'); }, 360);
  }
  function selectDoc(id) { if (!state.docs.some((doc) => doc.id === id)) return; state.activeId = id; persist({ cloud: false }); renderAll(); }
  function newDoc() {
    const timestamp = now(); const doc = { id: uid('note'), title: '無題のメモ', body: '', tags: [], pinned: false, createdAt: timestamp, updatedAt: timestamp };
    state.docs.unshift(doc); state.activeId = doc.id; dirtySinceRemote = true; persist(); renderAll(); setMode('edit'); els.title && els.title.focus(); showToast('新しいメモを作成しました');
  }
  function deleteDoc() {
    const doc = activeDoc(); if (!doc) return;
    if (state.docs.length === 1) { updateActive({ title: '無題のメモ', body: '', tags: [], pinned: false }); showToast('最後のメモは空に戻しました'); return; }
    if (!window.confirm(`「${doc.title}」を削除しますか？`)) return;
    state.docs = state.docs.filter((item) => item.id !== doc.id); state.activeId = state.docs[0].id; dirtySinceRemote = true; persist(); renderAll(); showToast('メモを削除しました');
  }
  function insertText(value, selectionStartOffset, selectionEndOffset) {
    if (!els.body) return;
    const start = els.body.selectionStart; const end = els.body.selectionEnd; const selected = els.body.value.slice(start, end);
    const text = typeof value === 'function' ? value(selected) : value;
    els.body.setRangeText(text, start, end, 'select');
    const newStart = start + (selectionStartOffset == null ? text.length : selectionStartOffset); const newEnd = start + (selectionEndOffset == null ? text.length : selectionEndOffset);
    els.body.setSelectionRange(newStart, newEnd); els.body.focus();
    updateActive({ body: els.body.value }); updateCounters();
  }
  function toolbarInsert(kind) {
    const selected = els.body ? els.body.value.slice(els.body.selectionStart, els.body.selectionEnd) : '';
    const actions = {
      heading: () => [`## ${selected || '見出し'}`, selected ? 3 : 3, selected ? 3 + selected.length : 6],
      bold: () => [`**${selected || '太字'}**`, 2, selected ? selected.length + 2 : 4],
      italic: () => [`*${selected || '斜体'}*`, 1, selected ? selected.length + 1 : 3],
      'inline-math': () => [`$${selected || 'x^2'}$`, 1, selected ? selected.length + 1 : 4],
      'display-math': () => [`$$\n${selected || 'x^2 + y^2 = z^2'}\n$$`, selected ? 3 : 3, selected ? selected.length + 3 : 18],
      code: () => [`\`\`\`\n${selected || 'code'}\n\`\`\``, selected ? 4 : 4, selected ? selected.length + 4 : 8],
      bullet: () => [selected ? selected.split('\n').map((line) => `- ${line}`).join('\n') : '- 項目', 0, selected ? selected.length + selected.split('\n').length * 2 : 4],
      check: () => [selected ? selected.split('\n').map((line) => `- [ ] ${line}`).join('\n') : '- [ ] タスク', 0, selected ? selected.length + selected.split('\n').length * 6 : 7],
      quote: () => [selected ? selected.split('\n').map((line) => `> ${line}`).join('\n') : '> 引用', 0, selected ? selected.length + selected.split('\n').length * 2 : 4],
      nl: () => ['\n\n{{< nl >}}\n\n', 4, 4],
      callout: () => [`{{< callout >}}\n${selected || 'ポイント'}\n{{< /callout >}}`, selected ? 16 : 17, selected ? selected.length + 16 : 21]
    };
    const result = actions[kind] && actions[kind](); if (result) insertText(result[0], result[1], result[2]);
  }

  function apiKey() { return window.PWAConfigSync && typeof window.PWAConfigSync.getApiKey === 'function' ? window.PWAConfigSync.getApiKey() : ''; }
  function binHeaders(extra) { return { 'X-Master-Key': apiKey(), 'Content-Type': 'application/json', ...(extra || {}) }; }
  function cachedBin() { return window.PWAConfigSync && typeof window.PWAConfigSync.getCachedBinId === 'function' ? window.PWAConfigSync.getCachedBinId(APP_KEY) : localStorage.getItem(BIN_KEY); }
  async function setBin(id) {
    if (!id) return;
    localStorage.setItem(BIN_KEY, id);
    if (window.PWAConfigSync && typeof window.PWAConfigSync.syncAppBinId === 'function') await window.PWAConfigSync.syncAppBinId(APP_KEY, id);
    if (els.syncInput) els.syncInput.value = id;
  }
  function syncPayload() { return { version: 1, app: 'math_memo', deviceId: deviceId(), updatedAt: state.updatedAt, docs: state.docs, activeId: state.activeId }; }
  async function fetchRemote(id) {
    const response = await fetch(`${BIN_URL}/${encodeURIComponent(id)}/latest`, { headers: { 'X-Master-Key': apiKey() }, cache: 'no-store' });
    if (!response.ok) throw new Error(`fetch ${response.status}`);
    const result = await response.json(); return normalizeState(result.record || result);
  }
  function mergeRemote(remote) {
    const localById = new Map(state.docs.map((doc) => [doc.id, doc]));
    remote.docs.forEach((remoteDoc) => {
      const localDoc = localById.get(remoteDoc.id);
      if (!localDoc || String(remoteDoc.updatedAt) > String(localDoc.updatedAt)) localById.set(remoteDoc.id, remoteDoc);
    });
    const mergedDocs = [...localById.values()].sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const remoteActive = mergedDocs.some((doc) => doc.id === remote.activeId) ? remote.activeId : state.activeId;
    state = normalizeState({ version: 1, docs: mergedDocs, activeId: remoteActive, updatedAt: new Date(Math.max(Date.parse(state.updatedAt) || 0, Date.parse(remote.updatedAt) || 0)).toISOString(), deviceId: deviceId() });
    localStorage.setItem(STORE_KEY, JSON.stringify(state)); renderAll();
  }
  async function pushRemote() {
    const id = cachedBin(); if (!id || syncInFlight) return false;
    syncInFlight = true; setSyncState('busy', '同期しています…');
    try {
      const response = await fetch(`${BIN_URL}/${encodeURIComponent(id)}`, { method: 'PUT', headers: binHeaders(), body: JSON.stringify(syncPayload()) });
      if (!response.ok) throw new Error(`put ${response.status}`);
      dirtySinceRemote = false; setSyncState('online', '端末間同期済み'); if (els.syncTime) els.syncTime.textContent = `最終 ${formatDate(now())}`; return true;
    } catch (_) { setSyncState('error', '同期できません。ローカル保存は継続中'); return false; } finally { syncInFlight = false; }
  }
  function schedulePush() { clearTimeout(pushTimer); pushTimer = setTimeout(() => { if (cachedBin()) pushRemote(); }, 720); }
  async function syncNow({ create = true } = {}) {
    if (syncInFlight) return false;
    setSyncState('busy', 'ほかの端末のメモを確認しています…');
    try {
      let id = cachedBin() || (els.syncInput && els.syncInput.value.trim());
      if (window.PWAConfigSync && typeof window.PWAConfigSync.syncAppBinId === 'function') id = await window.PWAConfigSync.syncAppBinId(APP_KEY, id);
      if (!id && create) {
        const created = await fetch(BIN_URL, { method: 'POST', headers: binHeaders({ 'X-Bin-Name': 'math_memo', 'X-Bin-Private': 'true' }), body: JSON.stringify(syncPayload()) });
        if (!created.ok) throw new Error(`create ${created.status}`);
        const result = await created.json(); id = result.metadata && result.metadata.id;
      }
      if (!id) { setSyncState('local', 'この端末だけに保存されています'); return true; }
      await setBin(id);
      const remote = await fetchRemote(id);
      mergeRemote(remote); await pushRemote();
      showToast('端末間同期を完了しました'); return true;
    } catch (_) { setSyncState('error', '同期できませんでした。ローカルデータは保持されています'); showToast('同期に失敗しました。設定と通信を確認してください'); return false; }
  }
  async function poll() { if (document.hidden || syncInFlight) return; const id = cachedBin(); if (!id) return; try { const remote = await fetchRemote(id); if (String(remote.updatedAt) > String(state.updatedAt)) mergeRemote(remote); setSyncState('online', '端末間同期済み'); } catch (_) { /* transient network errors should not interrupt editing */ } }
  function startPolling() { clearInterval(syncTimer); syncTimer = setInterval(poll, 4500); }

  function download(filename, content, type) { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([content], { type })); link.download = filename; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 500); }
  function currentFilename(extension) { return `${(activeDoc() && activeDoc().title || 'math-memo').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/g, '') || 'math-memo'}.${extension}`; }
  async function copyText(text) { try { await navigator.clipboard.writeText(text); showToast('クリップボードにコピーしました'); } catch (_) { showToast('コピーできませんでした'); } }
  function openDialog(name) { const dialog = root.querySelector(`[data-mm-dialog="${name}"]`); if (dialog && typeof dialog.showModal === 'function') dialog.showModal(); }
  function closeDialogs() { root.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close()); }

  function importFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = String(reader.result || '');
        if (/\.json$/i.test(file.name)) {
          localStorage.setItem(IMPORT_BACKUP_KEY, JSON.stringify(state));
          const parsed = JSON.parse(raw); state = normalizeState(parsed.state || parsed); state.deviceId = deviceId(); state.activeId = state.activeId || state.docs[0].id; persist(); renderAll(); showToast('JSONバックアップを復元しました');
        } else {
          const timestamp = now(); const title = file.name.replace(/\.(markdown?|txt)$/i, '') || 'インポートしたメモ'; const doc = normalizeDoc({ id: uid('note'), title, body: raw, tags: [], createdAt: timestamp, updatedAt: timestamp }); state.docs.unshift(doc); state.activeId = doc.id; persist(); renderAll(); showToast('Markdownを読み込みました');
        }
      } catch (_) { showToast('ファイルを読み込めませんでした'); }
    };
    reader.readAsText(file);
  }

  root.addEventListener('click', (event) => {
    const actionNode = event.target.closest('[data-mm-action]');
    if (actionNode && root.contains(actionNode)) {
      const action = actionNode.dataset.mmAction;
      if (action === 'new') newDoc();
      if (action === 'delete') deleteDoc();
      if (action === 'pin') { const doc = activeDoc(); if (doc) updateActive({ pinned: !doc.pinned }); renderList(); }
      if (action === 'sync-open') { const id = cachedBin(); if (els.syncInput) els.syncInput.value = id || ''; openDialog('sync'); }
      if (action === 'export-open') openDialog('export');
      if (action === 'sync-now') syncNow();
      if (action === 'sync-copy') copyText(els.syncInput && els.syncInput.value.trim() || cachedBin() || '');
      if (action === 'sync-apply') { const id = els.syncInput && els.syncInput.value.trim(); if (id) { setBin(id).then(() => syncNow({ create: false })); } else syncNow(); closeDialogs(); }
      if (action === 'export-md') { const doc = activeDoc(); download(currentFilename('md'), doc ? doc.body : '', 'text/markdown;charset=utf-8'); showToast('Markdownを書き出しました'); closeDialogs(); }
      if (action === 'export-json') { download('math-memo-backup.json', JSON.stringify(state, null, 2), 'application/json;charset=utf-8'); showToast('JSONバックアップを書き出しました'); closeDialogs(); }
      if (action === 'copy') { const doc = activeDoc(); copyText(doc ? doc.body : ''); closeDialogs(); }
      if (action === 'print') { closeDialogs(); setTimeout(() => window.print(), 40); }
      if (action === 'import') { const input = root.querySelector('[data-mm-import-input]'); if (input) input.click(); }
      if (action === 'search-clear' && els.search) { els.search.value = ''; renderList(); els.search.focus(); }
    }
    const docNode = event.target.closest('[data-mm-doc-id]'); if (docNode && root.contains(docNode)) selectDoc(docNode.dataset.mmDocId);
    const modeNode = event.target.closest('[data-mm-mode]'); if (modeNode && modeNode.tagName === 'BUTTON') setMode(modeNode.dataset.mmMode);
    const insertNode = event.target.closest('[data-mm-insert]'); if (insertNode) toolbarInsert(insertNode.dataset.mmInsert);
  });
  root.addEventListener('input', (event) => {
    if (event.target === els.title) updateActive({ title: els.title.value });
    if (event.target === els.body) { updateActive({ body: els.body.value }); updateCounters(); }
    if (event.target === els.tags) updateActive({ tags: els.tags.value.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 12) });
    if (event.target === els.search) renderList();
  });
  root.addEventListener('change', (event) => { if (event.target === els.mobileSelect) selectDoc(event.target.value); if (event.target.matches('[data-mm-import-input]')) importFile(event.target.files[0]); });
  root.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); persist(); setSaveState('saved', '保存済み'); showToast('この端末に保存しました'); }
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); setMode(selectedMode === 'preview' ? 'edit' : 'preview'); }
    if (event.key === 'Escape') closeDialogs();
    if (event.target === els.body && event.key === 'Tab') { event.preventDefault(); insertText('  ', 2, 2); }
  });
  root.addEventListener('keyup', updateCounters); root.addEventListener('click', () => { window.setTimeout(updateCounters, 0); });
  if (channel) channel.addEventListener('message', (event) => { if (!event.data || event.data.source === deviceId() || event.data.type !== 'state') return; const incoming = normalizeState(event.data.state); if (String(incoming.updatedAt) > String(state.updatedAt)) { state = incoming; dirtySinceRemote = false; localStorage.setItem(STORE_KEY, JSON.stringify(state)); renderAll(); showToast('別のタブから更新しました'); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

  setMode('split'); renderAll();
  const initialBin = cachedBin(); if (els.syncInput) els.syncInput.value = initialBin || '';
  if (initialBin) { setSyncState('busy', '同期を確認しています…'); syncNow({ create: false }); } else setSyncState('local', 'この端末に保存されています');
  startPolling();
})();

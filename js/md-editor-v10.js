(function () {
  'use strict';

  const SLOT_PREFIX = 'ne_slot_';
  const META_KEY = 'ne_meta_v2';
  const HISTORY_KEY = 'ne_history_v2';
  const SETTINGS_KEY = 'ne_settings_v2';
  const RECOVERY_KEY = 'ne_import_recovery_v2';
  const BACKUP_SCHEMA = 'dt-world-markdown-editor';
  const DEFAULT_TEXT = '# 新しいノート\n\nここに文章を入力してください。';
  const HTML2CANVAS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  const HTML2CANVAS_INTEGRITY = 'sha512-BNaRQnYJYiPSqHHDb58B0yaPfCu+Wgds8Gp/gU33kqBtgNS4tSPHuGibyoeqMV/TJlSKda6FXzoEyYGjTe+vXA==';
  const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js';
  const JSPDF_INTEGRITY = 'sha512-plOdviVmws4Y3JAvbnpfKb2hVxKM1lCwsi3vmElYRj+tiDLffZ4FVUj5a8vyKJ9pIgl8JCAHEJ4D1iUKBecswg==';
  const MAX_HISTORY_PER_SLOT = 12;
  const SLOT_IDS = ['1', '2', '3'];

  let root;
  let textarea;
  let output;
  let currentSlot = '1';
  let mobileView = 'edit';
  let focusMode = false;
  let dirty = false;
  let applyingUndo = false;
  let saveTimer = 0;
  let renderTimer = 0;
  let toastTimer = 0;
  let renderSequence = 0;
  let renderPromise = Promise.resolve();
  let pdfLibraryPromise = null;
  let previousFocus = null;
  let undoStack = [];
  let redoStack = [];
  let lastUndoCapture = 0;
  let lastSnapshotText = '';

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  const dateTimeFormatter = new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const timeFormatter = new Intl.DateTimeFormat('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  });

  let meta = {
    version: 2,
    titles: { '1': '新しいノート', '2': 'ノート 2', '3': 'ノート 3' },
  };
  let histories = { '1': [], '2': [], '3': [] };
  let settings = {
    paperTheme: 'light',
    lineWrap: true,
    sparks: false,
  };

  function element(id) {
    return document.getElementById(id);
  }

  function safeGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (_) {
      setSaveState('error', '保存領域を利用できません');
      return false;
    }
  }

  function readJson(key, fallback) {
    const raw = safeGet(key);
    if (!raw) return structuredClone(fallback);
    try {
      return JSON.parse(raw);
    } catch (_) {
      return structuredClone(fallback);
    }
  }

  function normalizeState() {
    const loadedMeta = readJson(META_KEY, meta);
    if (loadedMeta && typeof loadedMeta === 'object') {
      SLOT_IDS.forEach((slot) => {
        const value = loadedMeta.titles?.[slot];
        if (typeof value === 'string' && value.trim()) meta.titles[slot] = value.slice(0, 120);
      });
    }

    const loadedHistory = readJson(HISTORY_KEY, histories);
    SLOT_IDS.forEach((slot) => {
      const values = Array.isArray(loadedHistory?.[slot]) ? loadedHistory[slot] : [];
      histories[slot] = values
        .filter((item) => item && typeof item.text === 'string' && typeof item.time === 'string')
        .slice(0, MAX_HISTORY_PER_SLOT)
        .map((item) => ({ time: item.time, text: item.text }));
    });

    const loadedSettings = readJson(SETTINGS_KEY, settings);
    settings.paperTheme = loadedSettings?.paperTheme === 'dark' ? 'dark' : 'light';
    settings.lineWrap = loadedSettings?.lineWrap !== false;
    settings.sparks = loadedSettings?.sparks === true;
  }

  function setSaveState(state, message) {
    const status = element('ne-save-state');
    if (!status) return;
    status.dataset.state = state;
    const label = status.querySelector('.ne-save-label');
    if (label) label.textContent = message;
  }

  function showToast(message, tone = 'normal') {
    const toast = element('ne-toast');
    if (!toast) return;
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.dataset.open = 'true';
    toastTimer = window.setTimeout(() => {
      toast.dataset.open = 'false';
    }, tone === 'error' ? 4200 : 2400);
  }

  function updateMetrics(text) {
    const characters = Array.from(text).length;
    const lines = text.length ? text.split('\n').length : 0;
    const latinWords = text.match(/[A-Za-z0-9_]+(?:['’-][A-Za-z0-9_]+)*/g)?.length || 0;
    const japaneseUnits = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length || 0;
    const words = latinWords + japaneseUnits;
    const readMinutes = Math.max(1, Math.ceil((latinWords / 220) + (japaneseUnits / 500)));
    element('ne-metric-chars').textContent = `${characters.toLocaleString('ja-JP')}文字`;
    element('ne-metric-words').textContent = `${words.toLocaleString('ja-JP')}語`;
    element('ne-metric-lines').textContent = `${lines.toLocaleString('ja-JP')}行`;
    element('ne-metric-read').textContent = `約${readMinutes}分`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function sanitizeHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.querySelectorAll('script, style, iframe, object, embed, form, meta, link').forEach((node) => node.remove());
    template.content.querySelectorAll('*').forEach((node) => {
      [...node.attributes].forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim().toLowerCase();
        if (name.startsWith('on') || name === 'srcdoc') node.removeAttribute(attribute.name);
        if ((name === 'href' || name === 'src' || name === 'xlink:href') && value.startsWith('javascript:')) {
          node.removeAttribute(attribute.name);
        }
      });
      if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
    return template.innerHTML;
  }

  async function renderNow() {
    window.clearTimeout(renderTimer);
    const sequence = ++renderSequence;
    const text = textarea.value;
    updateMetrics(text);

    if (!text.trim()) {
      output.innerHTML = '<div class="ne-empty-preview"><div><strong>プレビューする内容がありません</strong><br><small>左側へMarkdownを入力してください。</small></div></div>';
      element('ne-preview-label').textContent = 'プレビューは最新です';
      return;
    }

    let html;
    if (window.marked?.parse) {
      try {
        window.marked.setOptions({ gfm: true, breaks: false });
        html = window.marked.parse(text);
      } catch (_) {
        html = `<pre>${escapeHtml(text)}</pre>`;
      }
    } else {
      html = `<pre>${escapeHtml(text)}</pre>`;
      element('ne-preview-label').textContent = '簡易表示（Markdownライブラリ未読込）';
    }

    output.innerHTML = sanitizeHtml(html);

    if (window.mermaid?.run) {
      const blocks = [...output.querySelectorAll('pre code.language-mermaid')];
      blocks.forEach((block) => {
        const diagram = document.createElement('div');
        diagram.className = 'mermaid';
        diagram.textContent = block.textContent;
        block.parentElement.replaceWith(diagram);
      });
      if (blocks.length) {
        try {
          await window.mermaid.run({ nodes: output.querySelectorAll('.mermaid'), suppressErrors: true });
        } catch (_) {
          output.querySelectorAll('.mermaid').forEach((diagram) => {
            const pre = document.createElement('pre');
            pre.textContent = diagram.textContent;
            diagram.replaceWith(pre);
          });
        }
      }
    }

    if (sequence !== renderSequence) return;
    if (window.MathJax?.typesetPromise) {
      try {
        window.MathJax.typesetClear?.([output]);
        await window.MathJax.typesetPromise([output]);
      } catch (_) {
        // The source remains readable even if a single equation is invalid.
      }
    }

    if (sequence === renderSequence) element('ne-preview-label').textContent = 'プレビューは最新です';
  }

  function scheduleRender(immediate = false) {
    window.clearTimeout(renderTimer);
    if (immediate) {
      renderPromise = renderNow();
      return renderPromise;
    }
    if (window.innerWidth <= 800 && mobileView !== 'preview') return renderPromise;
    element('ne-preview-label').textContent = '更新中…';
    renderTimer = window.setTimeout(() => {
      renderPromise = renderNow();
    }, 180);
    return renderPromise;
  }

  function saveMetadata() {
    safeSet(META_KEY, JSON.stringify(meta));
  }

  function persistHistory() {
    if (safeSet(HISTORY_KEY, JSON.stringify(histories))) return true;
    SLOT_IDS.forEach((slot) => {
      histories[slot] = histories[slot].slice(0, 5);
    });
    return safeSet(HISTORY_KEY, JSON.stringify(histories));
  }

  function persistSettings() {
    safeSet(SETTINGS_KEY, JSON.stringify(settings));
  }

  function persistCurrent(options = {}) {
    window.clearTimeout(saveTimer);
    const title = element('ne-document-title').value.trim() || `ノート ${currentSlot}`;
    meta.titles[currentSlot] = title.slice(0, 120);
    const textSaved = safeSet(`${SLOT_PREFIX}${currentSlot}`, textarea.value);
    saveMetadata();
    dirty = !textSaved;
    if (textSaved) {
      setSaveState('saved', `保存済み ${timeFormatter.format(new Date())}`);
      if (options.announce) showToast('この端末に保存しました');
    }
    if (options.snapshot) addSnapshot(true);
    updateMetrics(textarea.value);
    return textSaved;
  }

  function queueSave() {
    dirty = true;
    setSaveState('saving', '保存中…');
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => persistCurrent(), 260);
  }

  function currentEditorState() {
    return {
      text: textarea.value,
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
  }

  function pushUndo(force = false) {
    const now = Date.now();
    const state = currentEditorState();
    const last = undoStack.at(-1);
    if (last && last.text === state.text) return;
    if (!force && now - lastUndoCapture < 700 && last) return;
    undoStack.push(state);
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
    lastUndoCapture = now;
    updateUndoButtons();
  }

  function applyEditorState(state) {
    if (!state) return;
    applyingUndo = true;
    textarea.value = state.text;
    textarea.focus();
    textarea.setSelectionRange(state.start, state.end);
    applyingUndo = false;
    onDocumentChanged();
  }

  function undo() {
    const state = undoStack.pop();
    if (!state) return;
    redoStack.push(currentEditorState());
    applyEditorState(state);
    updateUndoButtons();
  }

  function redo() {
    const state = redoStack.pop();
    if (!state) return;
    undoStack.push(currentEditorState());
    applyEditorState(state);
    updateUndoButtons();
  }

  function updateUndoButtons() {
    const undoButton = element('ne-undo');
    const redoButton = element('ne-redo');
    if (undoButton) undoButton.disabled = undoStack.length === 0;
    if (redoButton) redoButton.disabled = redoStack.length === 0;
  }

  function onDocumentChanged() {
    updateMetrics(textarea.value);
    queueSave();
    scheduleRender();
    updateFindCount();
    triggerSparks();
  }

  function mutateText(start, end, replacement, selectionStart, selectionEnd) {
    pushUndo(true);
    textarea.setRangeText(replacement, start, end, 'end');
    if (Number.isInteger(selectionStart)) {
      textarea.setSelectionRange(selectionStart, Number.isInteger(selectionEnd) ? selectionEnd : selectionStart);
    }
    textarea.focus();
    onDocumentChanged();
  }

  function wrapSelection(before, after, placeholder = '') {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end) || placeholder;
    const replacement = `${before}${selected}${after}`;
    const selectionStart = start + before.length;
    const selectionEnd = selectionStart + selected.length;
    mutateText(start, end, replacement, selectionStart, selectionEnd);
  }

  function prefixSelectedLines(prefix) {
    const value = textarea.value;
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const start = value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
    const nextBreak = value.indexOf('\n', selectionEnd);
    const end = nextBreak === -1 ? value.length : nextBreak;
    const block = value.slice(start, end);
    const replacement = block.split('\n').map((line) => `${prefix}${line}`).join('\n');
    mutateText(start, end, replacement, start + prefix.length, start + replacement.length);
  }

  function insertBlock(value) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const beforeBreak = start > 0 && textarea.value[start - 1] !== '\n' ? '\n' : '';
    const afterBreak = end < textarea.value.length && textarea.value[end] !== '\n' ? '\n' : '';
    const replacement = `${beforeBreak}${value}${afterBreak}`;
    mutateText(start, end, replacement, start + beforeBreak.length, start + beforeBreak.length + value.length);
  }

  function executeFormat(command) {
    const formats = {
      bold: () => wrapSelection('**', '**', '太字'),
      italic: () => wrapSelection('*', '*', '斜体'),
      strike: () => wrapSelection('~~', '~~', '取り消し線'),
      inlineCode: () => wrapSelection('`', '`', 'code'),
      inlineMath: () => wrapSelection('$', '$', 'x'),
      link: () => wrapSelection('[', '](https://)', 'リンク名'),
      h1: () => prefixSelectedLines('# '),
      h2: () => prefixSelectedLines('## '),
      h3: () => prefixSelectedLines('### '),
      quote: () => prefixSelectedLines('> '),
      list: () => prefixSelectedLines('- '),
      orderedList: () => prefixSelectedLines('1. '),
      task: () => prefixSelectedLines('- [ ] '),
      codeBlock: () => wrapSelection('```\n', '\n```', 'コード'),
      mathBlock: () => wrapSelection('$$\n', '\n$$', 'x'),
      table: () => insertBlock('| 見出し | 見出し |\n|:---|:---|\n| 内容 | 内容 |'),
      horizontalRule: () => insertBlock('---'),
      undo,
      redo,
    };
    formats[command]?.();
  }

  function indentSelection(outdent = false) {
    const value = textarea.value;
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    if (selectionStart === selectionEnd && !outdent) {
      mutateText(selectionStart, selectionEnd, '  ', selectionStart + 2);
      return;
    }

    const start = value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
    const nextBreak = value.indexOf('\n', selectionEnd);
    const end = nextBreak === -1 ? value.length : nextBreak;
    const lines = value.slice(start, end).split('\n');
    const replacement = lines.map((line) => {
      if (!outdent) return `  ${line}`;
      return line.startsWith('  ') ? line.slice(2) : line.startsWith('\t') ? line.slice(1) : line.replace(/^ /, '');
    }).join('\n');
    mutateText(start, end, replacement, start, start + replacement.length);
  }

  function continueList(event) {
    const cursor = textarea.selectionStart;
    if (textarea.selectionStart !== textarea.selectionEnd) return false;
    const lineStart = textarea.value.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
    const line = textarea.value.slice(lineStart, cursor);
    const match = line.match(/^(\s*)(- \[[ xX]\]|[-*+]|\d+[.)])\s+(.*)$/);
    if (!match) return false;
    event.preventDefault();
    const [, indent, marker, content] = match;
    if (!content.trim()) {
      mutateText(lineStart, cursor, '', lineStart);
      return true;
    }
    let nextMarker = marker;
    if (/^\d/.test(marker)) {
      const number = Number.parseInt(marker, 10) + 1;
      nextMarker = `${number}${marker.endsWith(')') ? ')' : '.'}`;
    } else if (/^- \[/.test(marker)) {
      nextMarker = '- [ ]';
    }
    const addition = `\n${indent}${nextMarker} `;
    mutateText(cursor, cursor, addition, cursor + addition.length);
    return true;
  }

  function loadSlot(slot, options = {}) {
    if (!SLOT_IDS.includes(slot)) return;
    if (!options.initial) {
      persistCurrent();
      addSnapshot(false);
    }
    currentSlot = slot;
    element('ne-slot-select').value = slot;
    element('ne-document-title').value = meta.titles[slot] || `ノート ${slot}`;
    const stored = safeGet(`${SLOT_PREFIX}${slot}`);
    textarea.value = stored === null ? DEFAULT_TEXT : stored;
    undoStack = [];
    redoStack = [];
    dirty = false;
    lastSnapshotText = histories[slot][0]?.text || '';
    updateUndoButtons();
    setSaveState('saved', stored === null ? '新規文書' : 'この端末に保存済み');
    scheduleRender(true);
    renderHistory();
  }

  function addSnapshot(force = false) {
    const text = textarea.value;
    if (!text.trim()) return false;
    const latest = histories[currentSlot][0];
    if (!force && (text === latest?.text || text === lastSnapshotText)) return false;
    histories[currentSlot].unshift({ time: new Date().toISOString(), text });
    histories[currentSlot] = histories[currentSlot].slice(0, MAX_HISTORY_PER_SLOT);
    lastSnapshotText = text;
    persistHistory();
    renderHistory();
    return true;
  }

  function renderHistory() {
    const list = element('ne-history-list');
    if (!list) return;
    list.replaceChildren();
    const entries = histories[currentSlot];
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'ne-history-empty';
      empty.textContent = 'まだ履歴はありません。⌘/Ctrl + Sでいつでもスナップショットを残せます。';
      list.appendChild(empty);
      return;
    }
    entries.forEach((snapshot, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'ne-history-item';
      item.dataset.historyIndex = String(index);
      item.setAttribute('aria-label', `${dateTimeFormatter.format(new Date(snapshot.time))}の状態を復元`);

      const content = document.createElement('div');
      const time = document.createElement('div');
      time.className = 'ne-history-time';
      time.textContent = dateTimeFormatter.format(new Date(snapshot.time));
      const preview = document.createElement('div');
      preview.className = 'ne-history-preview';
      preview.textContent = snapshot.text.replace(/\s+/g, ' ').trim().slice(0, 54) || '空の文書';
      content.append(time, preview);
      const restore = document.createElement('span');
      restore.className = 'ne-history-restore';
      restore.textContent = '復元';
      item.append(content, restore);
      list.appendChild(item);
    });
  }

  function restoreHistory(index) {
    const snapshot = histories[currentSlot][index];
    if (!snapshot) return;
    addSnapshot(true);
    pushUndo(true);
    textarea.value = snapshot.text;
    textarea.setSelectionRange(0, 0);
    persistCurrent();
    scheduleRender(true);
    closeHistory();
    showToast('履歴から復元しました。直前の内容も履歴に保存済みです');
  }

  function openHistory() {
    previousFocus = document.activeElement;
    addSnapshot(false);
    renderHistory();
    const panel = element('ne-history-panel');
    panel.dataset.open = 'true';
    panel.setAttribute('aria-hidden', 'false');
    element('ne-history-scrim').dataset.open = 'true';
    element('ne-open-history').setAttribute('aria-expanded', 'true');
    element('ne-editor-pane').inert = true;
    element('ne-preview-pane').inert = true;
    root.querySelector('.ne-app-header').inert = true;
    root.querySelector('.ne-footer').inert = true;
    window.setTimeout(() => element('ne-close-history').focus(), 20);
  }

  function closeHistory() {
    const panel = element('ne-history-panel');
    panel.dataset.open = 'false';
    panel.setAttribute('aria-hidden', 'true');
    element('ne-history-scrim').dataset.open = 'false';
    element('ne-open-history').setAttribute('aria-expanded', 'false');
    element('ne-editor-pane').inert = false;
    element('ne-preview-pane').inert = false;
    root.querySelector('.ne-app-header').inert = false;
    root.querySelector('.ne-footer').inert = false;
    previousFocus?.focus?.({ preventScroll: true });
  }

  function switchView(view) {
    if (!['edit', 'preview'].includes(view)) return;
    if (view === 'preview' && focusMode) toggleFocus();
    mobileView = view;
    const edit = element('ne-view-edit');
    const preview = element('ne-view-preview');
    edit.setAttribute('aria-pressed', String(view === 'edit'));
    preview.setAttribute('aria-pressed', String(view === 'preview'));
    element('ne-editor-pane').setAttribute('aria-hidden', String(view !== 'edit'));
    element('ne-preview-pane').setAttribute('aria-hidden', String(view !== 'preview'));
    if (view === 'preview') {
      renderPromise = renderNow();
      element('ne-preview-scroll').scrollTop = 0;
    } else {
      window.setTimeout(() => textarea.focus({ preventScroll: true }), 20);
    }
  }

  function openFind() {
    const bar = element('ne-find-bar');
    bar.dataset.open = 'true';
    element('ne-open-find').setAttribute('aria-expanded', 'true');
    element('ne-find-input').focus();
    updateFindCount();
  }

  function closeFind() {
    element('ne-find-bar').dataset.open = 'false';
    element('ne-open-find').setAttribute('aria-expanded', 'false');
    textarea.focus({ preventScroll: true });
  }

  function getMatches() {
    const query = element('ne-find-input').value;
    if (!query) return [];
    const matches = [];
    let index = 0;
    while (index <= textarea.value.length - query.length) {
      const found = textarea.value.indexOf(query, index);
      if (found === -1) break;
      matches.push(found);
      index = found + Math.max(1, query.length);
    }
    return matches;
  }

  function updateFindCount(activeIndex = null) {
    const matches = getMatches();
    let current = activeIndex;
    if (current === null && matches.length) {
      current = matches.findIndex((position) => position >= textarea.selectionStart);
      if (current === -1) current = matches.length - 1;
    }
    element('ne-find-count').textContent = matches.length ? `${(current ?? 0) + 1} / ${matches.length}` : '0 / 0';
    return matches;
  }

  function findNext(reverse = false) {
    const query = element('ne-find-input').value;
    const matches = getMatches();
    if (!query || !matches.length) {
      updateFindCount();
      showToast('一致する文字列がありません', 'error');
      return;
    }
    const cursor = reverse ? textarea.selectionStart - 1 : textarea.selectionEnd;
    let matchIndex;
    if (reverse) {
      matchIndex = matches.findLastIndex((position) => position < cursor);
      if (matchIndex < 0) matchIndex = matches.length - 1;
    } else {
      matchIndex = matches.findIndex((position) => position >= cursor);
      if (matchIndex < 0) matchIndex = 0;
    }
    const position = matches[matchIndex];
    textarea.focus();
    textarea.setSelectionRange(position, position + query.length);
    updateFindCount(matchIndex);
  }

  function replaceCurrent() {
    const query = element('ne-find-input').value;
    if (!query) return;
    const selected = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
    if (selected !== query) findNext(false);
    const current = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
    if (current !== query) return;
    const replacement = element('ne-replace-input').value;
    const start = textarea.selectionStart;
    mutateText(start, textarea.selectionEnd, replacement, start, start + replacement.length);
    findNext(false);
  }

  function replaceAll() {
    const query = element('ne-find-input').value;
    if (!query) return;
    const count = getMatches().length;
    if (!count) {
      showToast('一致する文字列がありません', 'error');
      return;
    }
    pushUndo(true);
    textarea.value = textarea.value.replaceAll(query, element('ne-replace-input').value);
    onDocumentChanged();
    showToast(`${count}件を置換しました`);
  }

  function toggleFocus() {
    focusMode = !focusMode;
    root.classList.toggle('ne-focus-mode', focusMode);
    element('ne-setting-focus').checked = focusMode;
    element('ne-footer-focus').setAttribute('aria-pressed', String(focusMode));
    if (focusMode && window.innerWidth <= 800) switchView('edit');
    showToast(focusMode ? '集中モードを開始しました' : '分割表示に戻しました');
  }

  function applySettings() {
    output.dataset.theme = settings.paperTheme;
    element('ne-editor-pane').dataset.wrap = String(settings.lineWrap);
    element('ne-setting-paper').checked = settings.paperTheme === 'dark';
    element('ne-setting-wrap').checked = settings.lineWrap;
    element('ne-setting-sparks').checked = settings.sparks;
  }

  function triggerSparks() {
    if (!settings.sparks || reduceMotion) return;
    const container = element('ne-particles');
    for (let index = 0; index < 3; index += 1) {
      const particle = document.createElement('i');
      particle.className = 'ne-particle';
      particle.style.left = `${18 + Math.random() * 34}%`;
      particle.style.top = `${30 + Math.random() * 48}%`;
      particle.style.background = index % 2 ? 'hsl(var(--ne-accent-2))' : 'hsl(var(--ne-accent))';
      particle.style.setProperty('--x', `${(Math.random() - .5) * 70}px`);
      particle.style.setProperty('--y', `${-20 - Math.random() * 55}px`);
      container.appendChild(particle);
      window.setTimeout(() => particle.remove(), 760);
    }
  }

  function openDialog(dialogId, focusId) {
    const dialog = element(dialogId);
    if (!dialog?.showModal) return;
    previousFocus = document.activeElement;
    if (dialogId === 'ne-export-dialog') {
      element('ne-export-name').value = sanitizeFilename(meta.titles[currentSlot] || `note-${currentSlot}`);
    }
    dialog.showModal();
    window.setTimeout(() => element(focusId)?.focus(), 20);
  }

  function closeDialog(dialog) {
    if (dialog?.open) dialog.close();
    previousFocus?.focus?.({ preventScroll: true });
  }

  function sanitizeFilename(value) {
    const cleaned = String(value || 'document')
      .normalize('NFKC')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/g, '')
      .slice(0, 80);
    return cleaned || 'document';
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  async function copyText(value, successMessage) {
    try {
      await navigator.clipboard.writeText(value);
    } catch (_) {
      const helper = document.createElement('textarea');
      helper.value = value;
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      document.body.appendChild(helper);
      helper.select();
      document.execCommand('copy');
      helper.remove();
    }
    showToast(successMessage);
  }

  function buildBackup() {
    return {
      schema: BACKUP_SCHEMA,
      version: 2,
      exportedAt: new Date().toISOString(),
      currentSlot,
      slots: SLOT_IDS.map((slot) => ({
        id: slot,
        title: meta.titles[slot] || `ノート ${slot}`,
        text: safeGet(`${SLOT_PREFIX}${slot}`) ?? (slot === currentSlot ? textarea.value : ''),
      })),
      histories,
      settings,
    };
  }

  function exportBackup() {
    persistCurrent();
    const backup = buildBackup();
    downloadBlob(
      new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' }),
      `markdown-studio-backup-${new Date().toISOString().slice(0, 10)}.json`,
    );
    showToast('3つの文書と履歴をバックアップしました');
  }

  function validateBackup(payload) {
    if (!payload || payload.schema !== BACKUP_SCHEMA || ![1, 2].includes(payload.version)) return null;
    if (!Array.isArray(payload.slots)) return null;
    const slots = SLOT_IDS.map((id) => payload.slots.find((slot) => String(slot?.id) === id));
    if (slots.some((slot) => !slot || typeof slot.text !== 'string' || typeof slot.title !== 'string')) return null;
    return { payload, slots };
  }

  async function importBackupFile(file) {
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (_) {
      showToast('JSONバックアップを読み取れませんでした', 'error');
      return;
    }
    const validated = validateBackup(parsed);
    if (!validated) {
      showToast('Markdown Studioのバックアップ形式ではありません', 'error');
      return;
    }

    persistCurrent();
    safeSet(RECOVERY_KEY, JSON.stringify(buildBackup()));
    addSnapshot(true);
    validated.slots.forEach((slot) => {
      safeSet(`${SLOT_PREFIX}${slot.id}`, slot.text);
      meta.titles[slot.id] = slot.title.slice(0, 120) || `ノート ${slot.id}`;
    });
    if (validated.payload.histories && typeof validated.payload.histories === 'object') {
      SLOT_IDS.forEach((slot) => {
        const imported = Array.isArray(validated.payload.histories[slot]) ? validated.payload.histories[slot] : [];
        histories[slot] = imported
          .filter((item) => item && typeof item.text === 'string' && typeof item.time === 'string')
          .slice(0, MAX_HISTORY_PER_SLOT);
      });
      persistHistory();
    }
    saveMetadata();
    currentSlot = SLOT_IDS.includes(String(validated.payload.currentSlot)) ? String(validated.payload.currentSlot) : currentSlot;
    loadSlot(currentSlot, { initial: true });
    showToast('バックアップを復元しました。直前の状態も端末内に保護済みです');
  }

  function recoverBeforeImport() {
    const raw = safeGet(RECOVERY_KEY);
    if (!raw) {
      showToast('復元できる自動バックアップはありません', 'error');
      return;
    }
    const file = new File([raw], 'automatic-recovery.json', { type: 'application/json' });
    importBackupFile(file);
  }

  async function importMarkdownFile(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast('5MBを超える文書は読み込めません', 'error');
      return;
    }
    let text;
    try {
      text = await file.text();
    } catch (_) {
      showToast('ファイルを読み取れませんでした', 'error');
      return;
    }
    addSnapshot(true);
    pushUndo(true);
    textarea.value = text;
    element('ne-document-title').value = file.name.replace(/\.(?:md|markdown|txt)$/i, '').slice(0, 120) || meta.titles[currentSlot];
    persistCurrent({ snapshot: true });
    scheduleRender(true);
    showToast(`${file.name}を現在のスロットへ読み込みました`);
  }

  function standaloneHtml() {
    const title = escapeHtml(meta.titles[currentSlot] || 'Markdown document');
    return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
@page{size:A4;margin:16mm}*{box-sizing:border-box}body{max-width:210mm;margin:0 auto;padding:16mm;color:#18191c;background:#fff;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Mincho ProN","Yu Mincho",serif;line-height:1.85}h1,h2,h3,h4{font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;break-after:avoid}h1{border-bottom:2px solid;padding-bottom:.6rem}h2{border-left:4px solid;padding-left:.7rem}img,svg{max-width:100%;height:auto}table{width:100%;border-collapse:collapse;break-inside:avoid}th,td{padding:.5rem;border:1px solid #d9dce2}pre,blockquote{break-inside:avoid}pre{padding:1rem;overflow:auto;background:#f5f6f8;border-radius:8px;white-space:pre-wrap}code{font-family:ui-monospace,monospace}a{color:#086dc1}@media print{body{padding:0}}
</style></head><body>${output.innerHTML}</body></html>`;
  }

  async function exportCurrent(type) {
    persistCurrent();
    await renderNow();
    const baseName = sanitizeFilename(element('ne-export-name').value || meta.titles[currentSlot]);
    if (type === 'markdown') {
      downloadBlob(new Blob([textarea.value], { type: 'text/markdown;charset=utf-8' }), `${baseName}.md`);
      showToast('Markdownファイルを保存しました');
    } else if (type === 'text') {
      downloadBlob(new Blob([textarea.value], { type: 'text/plain;charset=utf-8' }), `${baseName}.txt`);
      showToast('テキストファイルを保存しました');
    } else if (type === 'html') {
      downloadBlob(new Blob([standaloneHtml()], { type: 'text/html;charset=utf-8' }), `${baseName}.html`);
      showToast('単体で開けるHTMLを保存しました');
    } else if (type === 'copy-markdown') {
      await copyText(textarea.value, 'Markdownをコピーしました');
    } else if (type === 'copy-html') {
      await copyText(output.innerHTML, 'HTMLをコピーしました');
    }
  }

  function loadExternalScript(id, source, integrity) {
    const existing = document.getElementById(id);
    if (existing) {
      return new Promise((resolve, reject) => {
        if (existing.dataset.loaded === 'true') resolve();
        else {
          existing.addEventListener('load', resolve, { once: true });
          existing.addEventListener('error', reject, { once: true });
        }
      });
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.id = id;
      script.src = source;
      script.integrity = integrity;
      script.crossOrigin = 'anonymous';
      script.referrerPolicy = 'no-referrer';
      script.onload = () => {
        script.dataset.loaded = 'true';
        resolve();
      };
      script.onerror = () => reject(new Error(`${id} failed to load`));
      document.head.appendChild(script);
    });
  }

  function ensurePdfLibrary() {
    if (window.html2canvas && window.jspdf?.jsPDF) {
      return Promise.resolve({ html2canvas: window.html2canvas, jsPDF: window.jspdf.jsPDF });
    }
    if (pdfLibraryPromise) return pdfLibraryPromise;
    pdfLibraryPromise = Promise.race([
      Promise.all([
        loadExternalScript('ne-html2canvas', HTML2CANVAS_URL, HTML2CANVAS_INTEGRITY),
        loadExternalScript('ne-jspdf', JSPDF_URL, JSPDF_INTEGRITY),
      ]).then(() => {
        if (!window.html2canvas || !window.jspdf?.jsPDF) throw new Error('PDF libraries unavailable');
        return { html2canvas: window.html2canvas, jsPDF: window.jspdf.jsPDF };
      }),
      new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error('PDF library timeout')), 20_000);
      }),
    ]);
    return pdfLibraryPromise;
  }

  function setProgress(open, title = 'PDFを作成しています', copy = '文書の長さにより少し時間がかかります。') {
    const overlay = element('ne-progress-overlay');
    overlay.dataset.open = String(open);
    overlay.setAttribute('aria-hidden', String(!open));
    element('ne-progress-title').textContent = title;
    element('ne-progress-copy').textContent = copy;
  }

  function canvasContainsInk(canvas) {
    const probe = document.createElement('canvas');
    probe.width = 128;
    probe.height = Math.min(256, Math.max(64, Math.round(canvas.height * probe.width / canvas.width)));
    const context = probe.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!context) return true;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, probe.width, probe.height);
    context.drawImage(canvas, 0, 0, probe.width, probe.height);
    const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
    let inkPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] < 244 || pixels[index + 1] < 244 || pixels[index + 2] < 244) {
        inkPixels += 1;
        if (inkPixels >= 5) return true;
      }
    }
    return false;
  }

  async function exportPdf() {
    const baseName = sanitizeFilename(element('ne-export-name').value || meta.titles[currentSlot]);
    closeDialog(element('ne-export-dialog'));
    setProgress(true);
    let stage;
    try {
      persistCurrent();
      await renderNow();
      await document.fonts?.ready;
      const { html2canvas, jsPDF } = await ensurePdfLibrary();
      stage = document.createElement('div');
      stage.className = 'ne-pdf-stage';
      const clone = output.cloneNode(true);
      clone.removeAttribute('id');
      clone.dataset.theme = 'light';
      stage.appendChild(clone);
      document.body.appendChild(stage);
      const requestedQuality = element('ne-pdf-quality').value === 'high' ? 2 : 1.45;
      const quality = Math.min(requestedQuality, Math.max(.7, 28_000 / Math.max(stage.scrollHeight, 1)));
      const canvas = await html2canvas(stage, {
        scale: quality,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        scrollX: 0,
        scrollY: 0,
        windowWidth: Math.ceil(stage.getBoundingClientRect().width),
        windowHeight: Math.ceil(stage.scrollHeight),
      });
      if (!canvas.width || !canvas.height) throw new Error('PDF canvas is empty');
      if (!canvasContainsInk(canvas)) throw new Error('PDF canvas contains no visible content');

      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
      pdf.setProperties({ title: meta.titles[currentSlot] || baseName, creator: 'dt world Markdown Studio' });
      const imageWidthMm = 190;
      const imageHeightMm = 275;
      const pagePixelHeight = Math.max(1, Math.floor(canvas.width * imageHeightMm / imageWidthMm));
      const pageCount = Math.max(1, Math.ceil(canvas.height / pagePixelHeight));

      for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
        if (pageIndex > 0) pdf.addPage('a4', 'portrait');
        const sourceY = pageIndex * pagePixelHeight;
        const segmentHeight = Math.min(pagePixelHeight, canvas.height - sourceY);
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = canvas.width;
        pageCanvas.height = segmentHeight;
        const context = pageCanvas.getContext('2d', { alpha: false });
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        context.drawImage(canvas, 0, sourceY, canvas.width, segmentHeight, 0, 0, canvas.width, segmentHeight);
        const renderedHeightMm = segmentHeight * imageWidthMm / canvas.width;
        pdf.addImage(pageCanvas.toDataURL('image/jpeg', .95), 'JPEG', 10, 10, imageWidthMm, renderedHeightMm, undefined, 'FAST');
        pdf.setFontSize(8);
        pdf.setTextColor(130, 134, 142);
        pdf.text(`${pageIndex + 1} / ${pageCount}`, 105, 292, { align: 'center' });
        pageCanvas.width = 1;
        pageCanvas.height = 1;
      }
      pdf.save(`${baseName}.pdf`);
      canvas.width = 1;
      canvas.height = 1;
      showToast('PDFを保存しました');
    } catch (error) {
      console.error('Markdown Studio PDF export failed:', error);
      showToast('PDFを作成できませんでした。「印刷でPDF」をお試しください', 'error');
    } finally {
      stage?.remove();
      setProgress(false);
    }
  }

  async function printDocument() {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      showToast('ポップアップを許可して、もう一度お試しください', 'error');
      return;
    }
    printWindow.opener = null;
    await renderNow();
    printWindow.document.open();
    printWindow.document.write(standaloneHtml());
    printWindow.document.close();
    const printWhenReady = () => {
      printWindow.focus();
      printWindow.print();
    };
    if (printWindow.document.readyState === 'complete') window.setTimeout(printWhenReady, 250);
    else printWindow.addEventListener('load', () => window.setTimeout(printWhenReady, 250), { once: true });
  }

  function applyTemplate(templateName) {
    const template = element(`ne-template-${templateName}`);
    if (!template) return;
    addSnapshot(true);
    pushUndo(true);
    textarea.value = template.textContent.trim();
    persistCurrent({ snapshot: true });
    scheduleRender(true);
    showToast('テンプレートを読み込みました。直前の内容は履歴に残っています');
  }

  function handleEditorKeydown(event) {
    const modifier = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (modifier && key === 's') {
      event.preventDefault();
      persistCurrent({ announce: true, snapshot: true });
      return;
    }
    if (modifier && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
      return;
    }
    if (modifier && key === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if (modifier && key === 'b') {
      event.preventDefault();
      executeFormat('bold');
      return;
    }
    if (modifier && key === 'i') {
      event.preventDefault();
      executeFormat('italic');
      return;
    }
    if (modifier && key === 'k') {
      event.preventDefault();
      executeFormat('link');
      return;
    }
    if (modifier && key === 'f') {
      event.preventDefault();
      openFind();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      indentSelection(event.shiftKey);
      return;
    }
    if (event.key === 'Enter') continueList(event);
  }

  function bindEvents() {
    root.addEventListener('pointerdown', (event) => {
      const control = event.target.closest('button, .ne-export-card');
      if (!control || control.disabled) return;
      control.style.transform = 'scale(.96)';
      const clear = () => { control.style.transform = ''; };
      control.addEventListener('pointerup', clear, { once: true });
      control.addEventListener('pointercancel', clear, { once: true });
      control.addEventListener('pointerleave', clear, { once: true });
    });

    root.addEventListener('click', (event) => {
      const button = event.target.closest('[data-ne-action]');
      if (!button) return;
      const action = button.dataset.neAction;
      if (action === 'view-edit') switchView('edit');
      else if (action === 'view-preview') switchView('preview');
      else if (action === 'open-find') openFind();
      else if (action === 'close-find') closeFind();
      else if (action === 'find-next') findNext(false);
      else if (action === 'find-prev') findNext(true);
      else if (action === 'replace-one') replaceCurrent();
      else if (action === 'replace-all') replaceAll();
      else if (action === 'open-history') openHistory();
      else if (action === 'close-history') closeHistory();
      else if (action === 'open-export') openDialog('ne-export-dialog', 'ne-export-name');
      else if (action === 'open-settings') openDialog('ne-settings-dialog', 'ne-setting-wrap');
      else if (action === 'close-dialog') closeDialog(button.closest('dialog'));
      else if (action === 'toggle-focus') toggleFocus();
      else if (action === 'export-pdf') exportPdf();
      else if (action === 'print') printDocument();
      else if (action === 'export-backup') exportBackup();
      else if (action === 'import-markdown') element('ne-import-markdown').click();
      else if (action === 'import-backup') element('ne-import-backup').click();
      else if (action === 'recover-import') recoverBeforeImport();
      else if (action === 'exit') {
        persistCurrent();
        if (history.length > 1) history.back(); else location.href = '/lab/';
      } else if (action?.startsWith('format-')) executeFormat(action.slice('format-'.length));
      else if (action?.startsWith('export-')) exportCurrent(action.slice('export-'.length));
    });

    element('ne-slot-select').addEventListener('change', (event) => loadSlot(event.target.value));
    element('ne-document-title').addEventListener('input', queueSave);
    element('ne-document-title').addEventListener('blur', () => persistCurrent());
    textarea.addEventListener('beforeinput', (event) => {
      if (applyingUndo || event.inputType?.startsWith('history')) return;
      const force = !event.inputType?.startsWith('insertText') || Date.now() - lastUndoCapture > 700;
      pushUndo(force);
    });
    textarea.addEventListener('input', () => {
      if (!applyingUndo) onDocumentChanged();
    });
    textarea.addEventListener('keydown', handleEditorKeydown);

    element('ne-find-input').addEventListener('input', () => updateFindCount());
    element('ne-find-input').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        findNext(event.shiftKey);
      }
    });
    element('ne-replace-input').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        replaceCurrent();
      }
    });

    element('ne-history-list').addEventListener('click', (event) => {
      const item = event.target.closest('[data-history-index]');
      if (item) restoreHistory(Number(item.dataset.historyIndex));
    });
    element('ne-history-scrim').addEventListener('click', closeHistory);

    element('ne-template-select').addEventListener('change', (event) => {
      if (event.target.value) applyTemplate(event.target.value);
      event.target.value = '';
    });
    element('ne-math-select').addEventListener('change', (event) => {
      const value = event.target.value;
      if (value) wrapSelection('$', '$', value);
      event.target.value = '';
    });

    element('ne-setting-paper').addEventListener('change', (event) => {
      settings.paperTheme = event.target.checked ? 'dark' : 'light';
      applySettings();
      persistSettings();
    });
    element('ne-setting-wrap').addEventListener('change', (event) => {
      settings.lineWrap = event.target.checked;
      applySettings();
      persistSettings();
    });
    element('ne-setting-sparks').addEventListener('change', (event) => {
      settings.sparks = event.target.checked;
      persistSettings();
    });
    element('ne-setting-focus').addEventListener('change', () => toggleFocus());

    element('ne-import-markdown').addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) await importMarkdownFile(file);
    });
    element('ne-import-backup').addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) await importBackupFile(file);
    });

    root.querySelectorAll('dialog').forEach((dialog) => {
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) closeDialog(dialog);
      });
      dialog.addEventListener('close', () => previousFocus?.focus?.({ preventScroll: true }));
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (element('ne-history-panel').dataset.open === 'true') {
        event.preventDefault();
        closeHistory();
      } else if (element('ne-find-bar').dataset.open === 'true') {
        event.preventDefault();
        closeFind();
      }
    });

    window.addEventListener('pagehide', () => persistCurrent());
    window.addEventListener('resize', () => {
      if (window.innerWidth > 800) {
        element('ne-editor-pane').setAttribute('aria-hidden', 'false');
        element('ne-preview-pane').setAttribute('aria-hidden', 'false');
      } else {
        switchView(mobileView);
      }
    });
  }

  function initializeLibraries() {
    if (window.mermaid?.initialize) {
      window.mermaid.initialize({
        startOnLoad: false,
        theme: 'neutral',
        securityLevel: 'strict',
        fontFamily: '-apple-system, BlinkMacSystemFont, Hiragino Sans, sans-serif',
      });
    }
    window.addEventListener('mathjax-ready', () => scheduleRender(true), { once: true });
  }

  function isolateOuterChrome() {
    let branch = root;
    while (branch?.parentElement && branch.parentElement !== document.body) {
      [...branch.parentElement.children].forEach((sibling) => {
        if (sibling === branch || ['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName)) return;
        sibling.inert = true;
        sibling.setAttribute('aria-hidden', 'true');
      });
      branch = branch.parentElement;
    }
    [...document.body.children].forEach((sibling) => {
      if (sibling === branch || ['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName)) return;
      sibling.inert = true;
      sibling.setAttribute('aria-hidden', 'true');
    });
  }

  function init() {
    root = element('ne-root');
    if (!root || root.dataset.initialized === 'true') return;
    root.dataset.initialized = 'true';
    textarea = element('ne-input');
    output = element('ne-output');
    document.body.classList.add('portal-body');
    isolateOuterChrome();
    normalizeState();
    initializeLibraries();
    applySettings();
    bindEvents();
    loadSlot('1', { initial: true });
    if (window.innerWidth <= 800) switchView('edit');
    window.setInterval(() => {
      if (dirty) persistCurrent();
      addSnapshot(false);
    }, 60_000);
  }

  window.neApp = {
    init,
    saveNow: () => persistCurrent({ announce: true, snapshot: true }),
    switchView,
    exportPdf,
    exportCurrent,
    exportBackup,
    importBackupFile,
    loadSlot,
    renderNow,
    getState: () => ({ currentSlot, text: textarea?.value || '', meta: structuredClone(meta), settings: structuredClone(settings) }),
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else window.setTimeout(init, 0);
})();

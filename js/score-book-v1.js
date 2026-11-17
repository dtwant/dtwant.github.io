(() => {
  'use strict';

  const APP_KEY = 'score_book';
  const STORAGE_KEY = 'dt_score_book_v1';
  const RECORD_PREFIX = `localStorage:${STORAGE_KEY}:`;
  const VERSION = 1;
  const SETTINGS = '/project-x/sync-settings/';
  const TERMS = { first: '前期', second: '後期', annual: '通年' };
  const FIELD_LABELS = {
    midExam: '中間試験',
    midGrade: '中間成績',
    finalExam: '期末試験',
    finalGrade: '前学期末成績',
    yearGrade: '学年末成績'
  };
  const fieldsFor = term => ['midExam', 'midGrade', 'finalExam', term === 'first' ? 'finalGrade' : 'yearGrade'];
  const labelFor = (term, field) => field === 'midGrade'
    ? (term === 'first' ? '前学期中間成績' : '後学期中間成績')
    : FIELD_LABELS[field];
  const isOfficial = field => field.endsWith('Grade');
  const isScore = value => value === null || (Number.isInteger(value) && value >= 0 && value <= 100);
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const cleanEnvelope = () => ({ version: VERSION, records: {}, fieldUpdatedAt: {} });
  const byId = id => document.getElementById(id);
  const app = byId('sb-app');
  if (!app) return;

  const panel = byId('sb-panel');
  const scroll = byId('sb-scroll');
  const tabs = byId('sb-tabs');
  const dialog = byId('sb-dialog');
  const form = byId('sb-form');
  const dialogFields = byId('sb-fields');
  const viewToggle = byId('sb-view-toggle');
  const tools = byId('sb-tools');
  const status = byId('sb-status');
  const toast = byId('sb-toast');

  const { subjects, seeds } = JSON.parse(byId('sb-seed').content.textContent);
  const subjectById = new Map(subjects.map(subject => [subject.id, subject]));
  const officialAverage = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  let snapshot = cleanEnvelope();
  let termView = 'first';
  let viewOnly = false;
  let editor = null;
  let bulk = null;
  let storagePending = false;
  let storageError = false;
  let conflictedScores = new Set();
  let syncState = 'local';
  let syncRunning = false;
  let savedHere = false;
  let localChangeDuringSync = false;

  // A fullscreen tool covers the Hugo theme. Keep the covered page out of the tab order.
  document.body.append(app, dialog, toast);
  for (const node of document.body.children) {
    if (node === app || node === dialog || node === toast || /^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(node.tagName)) continue;
    node.inert = true;
    node.setAttribute('aria-hidden', 'true');
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function isOffered(subject, term) {
    return (term === 'first' || term === 'second') && (subject.term === term || subject.term === 'annual');
  }

  // A stored null overrides the seed just as a stored score does.
  function scoreOf(id, term, field, data = snapshot) {
    const values = data.records[id]?.[term];
    return values && Object.hasOwn(values, field) ? values[field] : seeds[id]?.[term]?.[field] ?? null;
  }

  function normalizeEnvelope(input, strict = false) {
    if (!isObject(input) || input.version !== VERSION || !isObject(input.records)) {
      throw new Error('スコアブックのJSON形式を確認してください。');
    }
    const result = cleanEnvelope();
    for (const [id, terms] of Object.entries(input.records)) {
      const subject = subjectById.get(id);
      if (!subject || !isObject(terms)) {
        if (strict) throw new Error('科目の形式を確認してください。');
        continue;
      }
      for (const [term, values] of Object.entries(terms)) {
        if (!isOffered(subject, term) || !isObject(values)) {
          if (strict) throw new Error('学期の形式を確認してください。');
          continue;
        }
        for (const [field, value] of Object.entries(values)) {
          if (!fieldsFor(term).includes(field) || !isScore(value)) {
            if (strict) throw new Error('項目と点数（0〜100の整数または未入力）を確認してください。');
            continue;
          }
          const time = input.fieldUpdatedAt?.[id]?.[term]?.[field];
          ((result.records[id] ??= {})[term] ??= {})[field] = value;
          if (typeof time === 'string' && Number.isFinite(Date.parse(time))) {
            ((result.fieldUpdatedAt[id] ??= {})[term] ??= {})[field] = time;
          }
        }
      }
    }
    return result;
  }

  function readStorage() {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? cleanEnvelope() : normalizeEnvelope(JSON.parse(raw));
  }

  function reportStorageError() {
    storageError = true;
    updateSyncStatus();
    showFailure('この端末の記録を読み書きできません。端末の空き容量や保存設定を確認してから、もう一度お試しください。', 'storage');
  }

  function refreshFromStorage() {
    if (editor || bulk) {
      storagePending = true;
      return;
    }
    try {
      snapshot = readStorage();
      storageError = false;
      storagePending = false;
      renderPanel();
      updateSyncStatus();
    } catch {
      if (panel.getAttribute('aria-busy') === 'true') renderPanel();
      reportStorageError();
    }
  }

  function commit(changes) {
    try {
      // A pull or another tab may have saved after the input view opened.
      const latest = readStorage();
      const now = Date.now();
      let modified = false;
      for (const { id, term, field, value, renew } of changes) {
        const values = (latest.records[id] ??= {})[term] ??= {};
        if (!renew && Object.hasOwn(values, field) && values[field] === value) continue;
        const times = (latest.fieldUpdatedAt[id] ??= {})[term] ??= {};
        const previous = Date.parse(times[field] || '');
        times[field] = new Date(Number.isFinite(previous) ? Math.max(now, previous + 1) : now).toISOString();
        values[field] = value;
        modified = true;
      }
      if (modified) localStorage.setItem(STORAGE_KEY, JSON.stringify(latest));
      snapshot = latest;
      storagePending = false;
      storageError = false;
      if (modified) {
        savedHere = true;
        if (syncRunning) localChangeDuringSync = true;
        syncState = syncEnabled() ? 'pending' : 'local';
        window.dispatchEvent(new CustomEvent('dt-d1-local-change', { detail: { appKey: APP_KEY } }));
      }
      updateSyncStatus();
      dismissFailure('storage');
      return true;
    } catch {
      reportStorageError();
      return false;
    }
  }

  function summary(visibleSubjects) {
    const terms = termView === 'annual' ? ['first', 'second'] : [termView];
    const finishTerm = terms.at(-1);
    const finalField = fieldsFor(finishTerm).at(-1);
    const entered = visibleSubjects.filter(({ id }) =>
      terms.some(term => fieldsFor(term).some(field => scoreOf(id, term, field) !== null))).length;
    const completed = visibleSubjects.filter(({ id }) => scoreOf(id, finishTerm, finalField) !== null).length;
    const grades = visibleSubjects.flatMap(({ id }) => terms.flatMap(term => fieldsFor(term)
      .filter(isOfficial).map(field => scoreOf(id, term, field)))).filter(value => value !== null);
    return {
      entered,
      completed,
      average: grades.length ? officialAverage.format(grades.reduce((total, value) => total + value, 0) / grades.length) : '—'
    };
  }

  function stateLabel(subject, term) {
    const terminalTerm = subject.term === 'annual' ? 'second' : term;
    if (scoreOf(subject.id, terminalTerm, fieldsFor(terminalTerm).at(-1)) !== null) return ['complete', '記録済み'];
    const terms = subject.term === 'annual' ? ['first', 'second'] : [term];
    if (terms.some(period => fieldsFor(period).some(field => scoreOf(subject.id, period, field) !== null))) {
      return ['partial', '途中'];
    }
    return ['empty', '未記録'];
  }

  function bulkButton(term, field, annual = false) {
    const label = `${FIELD_LABELS[field]}の点数を入力`;
    const copy = annual ? `${TERMS[term]}・${FIELD_LABELS[field]}を入力` : label;
    return '<button class="sb-button" type="button" data-sb-edit-only' +
      ` data-bulk-term="${term}" data-bulk-field="${field}"${annual ? ` aria-label="${TERMS[term]}の${label}"` : ''}>${copy}</button>`;
  }

  function visibleScore(value, field) {
    const empty = value === null;
    const warning = !empty && value < 60;
    return `<span class="sb-cell-value${empty ? ' is-unset' : ''}${warning ? ' is-warning' : ''}" data-score-field="${field}">${empty ? '—' : value}</span>` +
      (warning ? '<em class="sb-warning">要確認</em>' : '');
  }

  function inputHtml(id, field, value, label, subjectId = '') {
    return `<input class="sb-input" id="${id}" data-score-field="${field}" type="text" inputmode="numeric" autocomplete="off"
      aria-label="${escapeHtml(label)}" aria-describedby="${id}-error" ${subjectId ? `data-input-subject="${subjectId}"` : ''} value="${value ?? ''}">
      <small class="sb-field-error" id="${id}-error" hidden></small>`;
  }

  function scoreCell(subject, term, field, index, annual) {
    const value = scoreOf(subject.id, term, field);
    const label = labelFor(term, field);
    const official = isOfficial(field);
    const editing = bulk?.field === field;
    let period = '';
    if (annual && index === 0) {
      period = viewOnly
        ? `<span class="sb-row-term">${TERMS[term]}</span>`
        : `<button class="sb-row-term" type="button" data-edit-subject="${subject.id}" data-edit-term="${term}"
            data-open-field="midGrade" aria-label="${escapeHtml(subject.name)}の${TERMS[term]}を編集">${TERMS[term]}</button>`;
    }
    let content = visibleScore(value, field);
    if (editing) {
      content = inputHtml(`sb-bulk-${subject.id}`, field, value, `${subject.name} ${label}`, subject.id);
    } else if (!official && !viewOnly && !bulk) {
      content = `<button type="button" class="sb-score-edit" data-edit-subject="${subject.id}" data-edit-term="${term}" data-open-field="${field}"
        aria-label="${escapeHtml(subject.name)} ${TERMS[term]}${label} ${value === null ? '未入力' : value + '点'}を編集">${content}</button>`;
    } else {
      content = `<span class="sb-score-text">${content}</span>`;
    }
    return `<td role="cell" class="sb-cell ${official ? 'is-official' : 'is-exam'}${editing ? ' is-bulk-edit' : ''}"
      headers="sb-col-${index} sb-subject-${subject.id}">${period}<span class="sb-cell-label" aria-hidden="true">${label}</span>${content}</td>`;
  }

  function subjectRows(subject, terms) {
    const { id, name, credits, teachers, category } = subject;
    const annual = terms.length > 1;
    const [state, stateText] = stateLabel(subject, terms[0]);
    const meta = `${category} ・ ${credits}単位<span class="sb-teachers">${escapeHtml(teachers.join('、'))}</span>`;
    const tag = viewOnly || bulk ? 'span' : 'button';
    const edit = tag === 'button' ? ` type="button" data-edit-subject="${id}" data-edit-term="${terms[0]}"` : '';
    const subjectName = `<${tag}${edit} class="sb-subject-name" data-subject-name="${escapeHtml(name)}">${escapeHtml(name)}</${tag}>`;
    const badge = subject.term === 'annual' ? '<span class="sb-badge">通年</span>' : '';
    const statusLabel = (viewOnly || bulk) && state !== 'complete' ? ''
      : `<span class="sb-state is-${state}"><span class="sb-dot" aria-hidden="true"></span>${stateText}</span>`;
    const head = `<th class="sb-subject-head" id="sb-subject-${id}" scope="${annual ? 'rowgroup' : 'row'}"${annual ? ' rowspan="2"' : ''} role="rowheader">
      <div class="sb-identity">${subjectName}${badge}<div class="sb-subject-meta">${meta}</div>${statusLabel}</div></th>`;
    const info = `<td role="cell" class="sb-meta"${annual ? ' rowspan="2"' : ''}>${meta}</td>`;
    return `<tbody role="rowgroup" class="sb-subject${annual ? ' is-annual' : ''}" data-subject-id="${id}">
      ${terms.map((term, index) => `<tr role="row" class="sb-score-row" data-term="${term}">
        ${index === 0 ? head : ''}
        ${fieldsFor(term).map((field, cellIndex) => scoreCell(subject, term, field, cellIndex, annual)).join('')}
        ${index === 0 ? info : ''}
      </tr>`).join('')}</tbody>`;
  }

  function tableHtml(visibleSubjects, terms) {
    const columns = terms.length === 2
      ? ['中間試験', '中間成績', '期末試験', '前学期末・学年末成績']
      : fieldsFor(terms[0]).map(field => labelFor(terms[0], field));
    return `<div class="sb-table-wrap"><table class="sb-table" role="table" aria-labelledby="sb-section-title">
      <colgroup><col class="sb-col-subject"><col class="sb-col-exam"><col class="sb-col-official">
        <col class="sb-col-exam"><col class="sb-col-official"><col class="sb-col-meta"></colgroup>
      <thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">科目名</th>
        ${columns.map((label, index) => `<th scope="col" role="columnheader" id="sb-col-${index}">${label}</th>`).join('')}
        <th scope="col" role="columnheader">担当・単位</th></tr></thead>
      ${visibleSubjects.map(subject => subjectRows(subject, terms)).join('')}
      </table></div>`;
  }

  function renderPanel() {
    panel.setAttribute('aria-labelledby', `sb-tab-${termView}`);
    panel.setAttribute('aria-busy', 'false');
    panel.classList.toggle('is-bulk', Boolean(bulk));
    app.classList.toggle('is-bulk', Boolean(bulk));
    for (const tab of tabs.querySelectorAll('[role="tab"]')) {
      const selected = tab.dataset.term === termView;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    if (bulk) {
      const visibleSubjects = subjects.filter(subject => isOffered(subject, bulk.term) &&
        (termView !== 'annual' || subject.term === 'annual'));
      panel.innerHTML = `<form id="sb-bulk-form" novalidate>
        <div class="sb-bulk-bar"><h2 id="sb-section-title">${TERMS[bulk.term]}の${FIELD_LABELS[bulk.field]}を入力</h2>
          <div class="sb-entry-actions"><button class="sb-button" id="sb-bulk-cancel" type="button">入力をやめる</button>
          <button class="sb-button sb-primary" id="sb-bulk-save" type="submit">点数を保存</button></div></div>
        ${tableHtml(visibleSubjects, [bulk.term])}
      </form>`;
      bulk.inputs = [...panel.querySelectorAll('[data-input-subject]')];
      bulk.original = new Map(bulk.inputs.map(input => [input.dataset.inputSubject, input.value]));
      return;
    }

    const visibleSubjects = subjects.filter(subject => subject.term === termView);
    const totals = summary(visibleSubjects);
    const annual = termView === 'annual';
    const terms = annual ? ['first', 'second'] : [termView];
    const empty = !totals.entered;
    const emptyState = empty ? `<div class="sb-empty"><p>${TERMS[termView]}の記録はまだありません。${viewOnly ? '' : '中間試験の結果が出たら、ここに入力します。'}</p>
      ${viewOnly ? '' : bulkButton(terms[0], 'midExam', annual)}</div>` : '';
    const entryButtons = viewOnly ? '' : `<div class="sb-entry-actions${annual ? ' sb-entry-actions-annual' : ''}" data-sb-edit-only>${terms.map(term =>
      `${!empty || term !== terms[0] ? bulkButton(term, 'midExam', annual) : ''}${bulkButton(term, 'finalExam', annual)}`).join('')}</div>`;
    panel.innerHTML = `<div class="sb-section-heading">
      <div><h2 id="sb-section-title">${TERMS[termView]}</h2>
        <p class="sb-section-summary"><strong>${totals.completed}/${visibleSubjects.length}</strong> 記録済み
          <span>${totals.entered}/${visibleSubjects.length} 入力あり</span>
          <span>公式成績の平均 <strong>${totals.average}</strong>${totals.average === '—' ? '' : ' 点'}</span></p></div>
      ${entryButtons}
    </div>${emptyState}${tableHtml(visibleSubjects, terms)}`;
  }

  function announce(text) {
    byId('sb-live').textContent = text;
  }

  function animatePanel() {
    panel.classList.remove('is-switching');
    // Restart the short transition even for repeated keyboard navigation.
    void panel.offsetWidth;
    panel.classList.add('is-switching');
  }

  function selectTerm(tab) {
    const term = tab.dataset.term;
    if (term === termView || !Object.hasOwn(TERMS, term)) return;
    if (bulk && !discardBulk()) return;
    termView = term;
    renderPanel();
    scroll.scrollTop = 0;
    animatePanel();
  }

  function setViewOnly() {
    if (bulk && !discardBulk()) return;
    viewOnly = !viewOnly;
    app.dataset.readonly = String(viewOnly);
    app.classList.toggle('is-view-only', viewOnly);
    viewToggle.setAttribute('aria-pressed', String(viewOnly));
    viewToggle.setAttribute('aria-label', '表示専用');
    viewToggle.textContent = viewOnly ? '編集表示に戻る' : '表示専用';
    byId('sb-view-indicator').hidden = !viewOnly;
    tools.open = false;
    renderPanel();
    updateSyncStatus();
  }

  function valueFromInput(input) {
    const raw = input.value.trim();
    if (!raw) return null;
    const normalized = raw.replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xFF10));
    return /^\d{1,3}$/.test(normalized) && isScore(Number(normalized)) ? Number(normalized) : undefined;
  }

  function validateInput(input) {
    const value = valueFromInput(input);
    const error = byId(`${input.id}-error`);
    error.hidden = value !== undefined;
    error.textContent = value === undefined ? '0〜100の整数を入力してください。' : '';
    if (value === undefined) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
    return value;
  }

  function renderEditor(focusField) {
    const { id, term } = editor;
    const subject = subjectById.get(id);
    const eligible = subjects.filter(candidate => candidate.term === termView);
    const position = eligible.findIndex(candidate => candidate.id === id) + 1;
    byId('sb-dialog-title').textContent = subject.name;
    byId('sb-dialog-context').textContent = `${TERMS[term]} ・ ${subject.credits}単位`;
    const progress = byId('sb-progress');
    progress.textContent = `${position} / ${eligible.length}`;
    progress.setAttribute('aria-label', `${eligible.length}科目のうち${position}番目`);
    editor.original = new Map();
    dialogFields.innerHTML = fieldsFor(term).map(field => {
      const value = scoreOf(id, term, field);
      const inputId = `sb-edit-${field}`;
      const label = labelFor(term, field);
      editor.original.set(field, value);
      return `<div class="sb-field ${isOfficial(field) ? 'is-official' : 'is-exam'}">
        <label class="sb-field-label" for="${inputId}">${label}</label>${inputHtml(inputId, field, value, label)}
      </div>`;
    }).join('');
    if (!dialog.open) dialog.showModal();
    const focusTarget = focusField ? byId(`sb-edit-${focusField}`) : byId('sb-close');
    focusTarget.focus({ preventScroll: true });
  }

  function openEditor(trigger) {
    if (viewOnly || bulk || editor) return;
    const { editSubject: id, editTerm: term, openField } = trigger.dataset;
    editor = { id, term, trigger, original: null };
    renderEditor(openField);
  }

  function commitEditor(next) {
    const changes = [];
    const { id, term } = editor;
    let firstInvalid = null;
    for (const input of dialogFields.querySelectorAll('input')) {
      const field = input.dataset.scoreField;
      const value = validateInput(input);
      const renew = conflictedScores.has(`${RECORD_PREFIX}${id}:${term}:${field}`);
      if (value === undefined) firstInvalid ??= input;
      else if (value !== editor.original.get(field) || editor.clearAll || renew) {
        changes.push({ id, term, field, value, renew });
      }
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }
    if (!commit(changes)) {
      byId('sb-form-error').hidden = false;
      byId('sb-form-error').textContent = '端末に保存できませんでした。入力は保持されています。もう一度保存してください。';
      return;
    }
    byId('sb-form-error').hidden = true;
    announce('科目の記録を保存しました。');
    if (next) {
      const { id, term, trigger } = editor;
      const eligible = subjects.filter(subject => subject.term === termView);
      const position = eligible.findIndex(subject => subject.id === id);
      const following = [...eligible.slice(position + 1), ...eligible.slice(0, position)];
      const candidate = following.find(subject => fieldsFor(term).some(field => scoreOf(subject.id, term, field) === null));
      if (candidate) {
        editor = { id: candidate.id, term, trigger, original: null };
        renderEditor(fieldsFor(term).find(field => scoreOf(candidate.id, term, field) === null));
        return;
      }
      announce('次に入力する科目はありません。');
    }
    dialog.close();
  }

  function restoreEditorFocus(trigger) {
    if (!trigger) return;
    const { editSubject, editTerm, openField } = trigger.dataset;
    const match = [...panel.querySelectorAll('[data-edit-subject]')].find(button =>
      button.dataset.editSubject === editSubject && button.dataset.editTerm === editTerm && button.dataset.openField === openField);
    (match || tabs.querySelector('[aria-selected="true"]'))?.focus({ preventScroll: true });
  }

  function enterBulk(trigger) {
    if (viewOnly || bulk || editor) return;
    const { bulkTerm: term, bulkField: field } = trigger.dataset;
    bulk = { term, field, scrollTop: scroll.scrollTop };
    renderPanel();
    scroll.scrollTop = 0;
    // Leave the software keyboard closed until the user selects a row.
    byId('sb-bulk-cancel').focus({ preventScroll: true });
  }

  function finishBulk() {
    const { term, field, scrollTop } = bulk;
    bulk = null;
    if (storagePending) refreshFromStorage();
    else renderPanel();
    scroll.scrollTop = scrollTop;
    panel.querySelector(`[data-bulk-term="${term}"][data-bulk-field="${field}"]`)?.focus({ preventScroll: true });
  }

  function discardBulk() {
    if (bulk.inputs.some(input => input.value !== bulk.original.get(input.dataset.inputSubject))
      && !window.confirm('入力中の点数を破棄しますか？')) return false;
    finishBulk();
    return true;
  }

  function commitBulk() {
    const changes = [];
    let firstInvalid = null;
    for (const input of bulk.inputs) {
      const value = validateInput(input);
      const id = input.dataset.inputSubject;
      if (value === undefined) firstInvalid ??= input;
      else if (input.value !== bulk.original.get(id) && value !== scoreOf(id, bulk.term, bulk.field)) {
        changes.push({ id, term: bulk.term, field: bulk.field, value });
      }
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }
    if (!commit(changes)) return;
    finishBulk();
    announce('試験の点数を保存しました。');
  }

  function syncEnabled() {
    try {
      return window.DTD1Runtime?.isEnabled?.(APP_KEY) === true;
    } catch {
      return false;
    }
  }

  const STATUS_TEXT = {
    local: 'この端末のみ',
    loading: '確認中',
    saving: '同期中',
    synced: '保存済み',
    pending: '未同期',
    failed: '未同期',
    'local-error': '端末保存エラー'
  };

  function updateSyncStatus() {
    const state = storageError ? 'local-error' : syncState;
    const label = state === 'local' && savedHere ? '保存済み · この端末' : STATUS_TEXT[state];
    status.dataset.state = state;
    status.disabled = viewOnly;
    byId('sb-retry').hidden = viewOnly || toast.dataset.kind !== 'sync';
    byId('sb-status-label').textContent = label;
    status.setAttribute('aria-label', viewOnly ? label : state === 'local' ? `${label}。同期設定を開く`
      : state === 'failed' || state === 'pending' ? `${label}。同期を再試行` : label);
  }

  function showFailure(message, kind = '') {
    byId('sb-toast-message').textContent = message;
    toast.dataset.kind = kind;
    byId('sb-retry').hidden = viewOnly || kind !== 'sync';
    toast.hidden = false;
  }

  function dismissFailure(kind) {
    if (toast.dataset.kind === kind) toast.hidden = true;
  }

  function onSyncStatus(detail) {
    if (detail?.appKey !== APP_KEY) return;
    syncRunning = detail.status === 'syncing';
    if (detail.status === 'syncing') {
      localChangeDuringSync = false;
      syncState = syncState === 'loading' ? 'loading' : 'saving';
    } else if (!syncEnabled() || detail.status === 'local') {
      syncState = 'local';
      dismissFailure('sync');
    } else if (!detail.ok || detail.status === 'conflict' || Number(detail.conflicts?.length) > 0) {
      const conflict = detail.status === 'conflict' || Number(detail.conflicts?.length) > 0;
      conflictedScores = new Set((detail.conflicts || []).map(record => record.recordKey)
        .filter(key => typeof key === 'string' && key.startsWith(RECORD_PREFIX)));
      syncState = 'failed';
      const names = [...new Set([...conflictedScores].map(key => {
        const [id, term, field] = key.slice(RECORD_PREFIX.length).split(':');
        const subject = subjectById.get(id);
        return subject && `${subject.name} ${labelFor(term, field)}`;
      }).filter(Boolean))];
      const affected = names.length ? ` 対象は${names.join('、')}です。` : '';
      showFailure(conflict
        ? `同じ項目の点数が端末間で競合しています。${affected}残したい点数をこの画面で確認し、科目の「保存」を押してください。`
        : '同期できませんでした。記録はこの端末に保存されています。通信を確認して再試行してください。', 'sync');
    } else {
      conflictedScores.clear();
      syncState = localChangeDuringSync ? 'pending' : 'synced';
      dismissFailure('sync');
    }
    updateSyncStatus();
  }

  function retrySync() {
    if (storageError) {
      refreshFromStorage();
      if (!storageError) dismissFailure('storage');
      return;
    }
    if (!syncEnabled()) {
      window.location.assign(SETTINGS);
      return;
    }
    if (syncRunning || syncState === 'loading') return;
    void window.DTD1Runtime.syncAppNow(APP_KEY);
  }

  function exportBackup() {
    if (viewOnly) return;
    try {
      const data = readStorage();
      for (const [id, terms] of Object.entries(seeds)) {
        for (const [term, fields] of Object.entries(terms)) {
          const values = (data.records[id] ??= {})[term] ??= {};
          for (const [field, value] of Object.entries(fields)) {
            if (!Object.hasOwn(values, field)) values[field] = value;
          }
        }
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'score-book-2026.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      tools.open = false;
      tools.querySelector('summary')?.focus();
    } catch {
      reportStorageError();
    }
  }

  async function importBackup(input) {
    const file = input.files?.[0];
    input.value = '';
    if (!file || viewOnly) return;
    try {
      const incoming = normalizeEnvelope(JSON.parse(await file.text()), true);
      if (viewOnly) return;
      const changes = Object.entries(incoming.records).flatMap(([id, terms]) => Object.entries(terms)
        .flatMap(([term, fields]) => Object.entries(fields).map(([field, value]) => ({ id, term, field, value }))));
      if (!commit(changes)) return;
      if (editor || bulk) storagePending = true;
      else renderPanel();
      tools.open = false;
      tools.querySelector('summary')?.focus();
      dismissFailure('import');
      announce('JSONの記録を取り込みました。');
    } catch (error) {
      const message = error instanceof SyntaxError ? 'JSONファイルを確認してください。' : error.message;
      showFailure(`読み込めませんでした。${message}`, 'import');
    }
  }

  tabs.addEventListener('click', event => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) selectTerm(tab);
  });
  tabs.addEventListener('keydown', event => {
    const candidates = [...tabs.querySelectorAll('[role="tab"]')];
    const i = candidates.indexOf(event.target);
    const offsets = { ArrowLeft: -1, ArrowRight: 1, Home: -i, End: candidates.length - i - 1 };
    if (i < 0 || !Object.hasOwn(offsets, event.key)) return;
    event.preventDefault();
    const target = candidates[(i + offsets[event.key] + candidates.length) % candidates.length];
    selectTerm(target);
    if (termView === target.dataset.term) target.focus();
  });
  panel.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.editSubject) openEditor(button);
    if (button.dataset.bulkTerm) enterBulk(button);
    if (button.id === 'sb-bulk-cancel') discardBulk();
  });
  panel.addEventListener('submit', event => {
    if (event.target.id !== 'sb-bulk-form') return;
    event.preventDefault();
    commitBulk();
  });
  panel.addEventListener('keydown', event => {
    if (!bulk || event.key !== 'Enter' || !bulk.inputs.includes(event.target)) return;
    event.preventDefault();
    const input = event.target;
    if (validateInput(input) === undefined) return;
    const next = bulk.inputs[bulk.inputs.indexOf(input) + 1];
    if (next) next.focus();
    else commitBulk();
  });
  app.addEventListener('input', event => {
    if (bulk && bulk.inputs.includes(event.target)) validateInput(event.target);
  });
  dialog.addEventListener('input', event => {
    if (event.target.matches('.sb-input')) validateInput(event.target);
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (editor) commitEditor(event.submitter?.id === 'sb-save-next');
  });
  byId('sb-close').addEventListener('click', () => dialog.close());
  byId('sb-clear').addEventListener('click', () => {
    if (!editor) return;
    editor.clearAll = true;
    for (const input of dialogFields.querySelectorAll('input')) {
      input.value = '';
      validateInput(input);
    }
    announce('4項目を空欄にしました。反映するには保存してください。');
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  const sheetHandle = dialog.querySelector('.sb-sheet-handle');
  let dragStart = null;
  sheetHandle.addEventListener('pointerdown', event => {
    if (!event.isPrimary) return;
    dragStart = { id: event.pointerId, y: event.clientY };
    sheetHandle.setPointerCapture(event.pointerId);
  });
  sheetHandle.addEventListener('pointerup', event => {
    if (dragStart?.id !== event.pointerId) return;
    if (event.clientY - dragStart.y >= 48) dialog.close();
    dragStart = null;
  });
  sheetHandle.addEventListener('pointercancel', () => { dragStart = null; });
  dialog.addEventListener('close', () => {
    const trigger = editor?.trigger;
    editor = null;
    byId('sb-form-error').hidden = true;
    if (storagePending) refreshFromStorage();
    else renderPanel();
    restoreEditorFocus(trigger);
  });
  viewToggle.addEventListener('click', setViewOnly);
  status.addEventListener('click', retrySync);
  byId('sb-retry').addEventListener('click', retrySync);
  byId('sb-toast-close').addEventListener('click', () => { toast.hidden = true; });
  byId('sb-export').addEventListener('click', exportBackup);
  byId('sb-import-trigger').addEventListener('click', () => byId('sb-import').click());
  byId('sb-import').addEventListener('change', event => { void importBackup(event.target); });
  window.addEventListener('dt-d1-sync-status', event => onSyncStatus(event.detail));
  window.addEventListener('dt-d1-before-reload', event => {
    if (event.detail?.appKey !== APP_KEY) return;
    event.preventDefault();
    refreshFromStorage();
  });
  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY || event.key === null) refreshFromStorage();
    if (window.DTD1Runtime && !syncEnabled()) {
      syncState = 'local';
      dismissFailure('sync');
      updateSyncStatus();
    }
  });

  syncState = syncEnabled() ? 'loading' : 'local';
  refreshFromStorage();
})();

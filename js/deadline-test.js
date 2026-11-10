import {
  APP_KEY,
  BLOB_KEY,
  DONE_KEY,
  PERIOD_TIMES,
  STORAGE_KEY,
  countdownFor,
  loadDeadlineState,
  saveDeadlineState,
  targetTime
} from '/js/deadline-test-core.mjs';

const root = document.querySelector('[data-dmt-root]');

if (root) {
  let state = loadDeadlineState(localStorage);
  let activeTab = 'all';
  let toastTimer = 0;
  let pendingRefresh = false;

  const byId = id => root.querySelector(`#${id}`);
  const list = byId('dmt-list');
  const taskDialog = byId('dmt-task-dialog');
  const configDialog = byId('dmt-config-dialog');
  const form = byId('dmt-form');
  const fields = {
    id: byId('dmt-id'),
    source: byId('dmt-source'),
    title: byId('dmt-title'),
    course: byId('dmt-course'),
    priority: byId('dmt-priority'),
    date: byId('dmt-date'),
    period: byId('dmt-period')
  };

  const escapeHTML = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const localDateString = date => {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };

  const showToast = message => {
    const toast = byId('dmt-toast');
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2400);
  };

  const syncConfigured = () => localStorage.getItem('dt_sync_provider_deadline') === 'd1';

  const updateSyncLabels = () => {
    byId('dmt-config-status').textContent = syncConfigured() ? 'D1同期を使用' : 'ローカルのみ';
    const pill = root.querySelector('.dm-pill');
    if (!pill) return;
    if (!syncConfigured()) pill.textContent = 'LOCAL';
    pill.dataset.appKey = APP_KEY;
  };

  const persist = message => {
    saveDeadlineState(localStorage, state);
    window.dispatchEvent(new CustomEvent('dt-d1-local-change', {
      detail: { appKey: APP_KEY }
    }));
    render();
    if (message) showToast(message);
  };

  const formatDate = dateString => {
    const parts = String(dateString || '').split('-');
    if (parts.length !== 3) return { day: '--', month: '未設定' };
    const date = new Date(`${dateString}T12:00:00`);
    return { day: `${Number(parts[1])}/${Number(parts[2])}`, month: `${'日月火水木金土'[date.getDay()]}曜` };
  };

  const formatDeadline = task => {
    if (!task.date) return '期限未設定';
    const date = new Date(`${task.date}T12:00:00`);
    const dateLabel = Number.isNaN(date.getTime())
      ? task.date
      : `${date.getMonth() + 1}/${date.getDate()}（${'日月火水木金土'[date.getDay()]}）`;
    return `${dateLabel} ${PERIOD_TIMES[task.period] || PERIOD_TIMES.end}`;
  };

  const priorityLabel = priority => ({ high: '優先度・高', mid: '普通', low: '低' }[priority] || '普通');

  const taskMarkup = (task, isDone) => {
    const countdown = isDone
      ? { text: '完了', state: 'safe' }
      : countdownFor(task);
    const date = formatDate(task.date);
    const id = escapeHTML(task.id);
    return `
      <article class="dmt-task${isDone ? ' is-done' : ''}" data-dt-four-edge data-dmt-open="${id}" data-dmt-source="${isDone ? 'done' : 'tasks'}" role="button" tabindex="0" aria-label="${escapeHTML(task.title)}を編集">
        <div class="dmt-task-date"><strong class="dmt-md">${escapeHTML(date.day)}</strong><span class="dmt-wd">${escapeHTML(date.month)}</span><span class="dmt-tm">${PERIOD_TIMES[task.period] || PERIOD_TIMES.end}</span></div>
        <div class="dmt-task-main">
          <div class="dmt-task-title">${escapeHTML(task.title || '無題')}</div>
          <div class="dmt-task-meta">
            ${task.course ? `<span>${escapeHTML(task.course)}</span>` : ''}
            <span>${task.period === 'end' ? '23:59' : `${escapeHTML(task.period)}限 ${PERIOD_TIMES[task.period] || PERIOD_TIMES.end}`}</span>
            <span class="dmt-priority ${escapeHTML(task.priority || 'mid')}">${escapeHTML(priorityLabel(task.priority))}</span>
          </div>
        </div>
        <div class="dmt-task-side">
          <span class="dmt-countdown ${countdown.state}">${escapeHTML(countdown.text)}</span>
          <button type="button" class="dmt-check${isDone ? ' is-done' : ''}" data-dmt-toggle="${id}" data-dmt-done="${isDone}" aria-label="${isDone ? '未完了に戻す' : '完了にする'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg></button>
        </div>
      </article>`;
  };

  const groupFor = task => {
    const countdown = countdownFor(task);
    if (countdown.overdue) return { key: 'overdue', title: '期限切れ', tone: 'danger' };
    if (countdown.diffMs <= 86400000) return { key: 'today', title: '24時間以内', tone: 'danger' };
    if (countdown.diffMs <= 259200000) return { key: 'soon', title: '3日以内', tone: 'warn' };
    return { key: 'later', title: 'それ以降', tone: 'safe' };
  };

  const renderList = () => {
    const urgent = state.tasks.filter(task => countdownFor(task).state === 'danger');
    let displayed = activeTab === 'done' ? [...state.doneTasks] : [...state.tasks];
    if (activeTab === 'urgent') displayed = [...urgent];
    displayed.sort((a, b) => targetTime(a) - targetTime(b));

    byId('dmt-list-summary').textContent = activeTab === 'done' ? '完了した順ではありません' : '';
    if (!displayed.length) {
      const title = activeTab === 'done' ? 'NOTHING DONE — YET' : activeTab === 'urgent' ? 'ALL CLEAR' : 'NO TASKS';
      const message = activeTab === 'done' ? '完了したタスクはまだありません。<br>タスク右下のチェックで完了にできます。' : activeTab === 'urgent' ? '24時間以内に迫った締切はありません。<br>この調子でいきましょう。' : '未完了のタスクはありません。<br>「＋ 新規タスク」から締切を登録できます。';
      list.innerHTML = `<div class="dmt-empty"><div class="dmt-empty-title">${title}</div><p>${message}</p></div>`;
      return;
    }

    if (activeTab === 'done') {
      list.innerHTML = `<h2 class="dmt-group-title safe">完了済み <span>${displayed.length}件</span></h2>${displayed.map(task => taskMarkup(task, true)).join('')}`;
      return;
    }

    const groups = new Map();
    displayed.forEach(task => {
      const group = groupFor(task);
      if (!groups.has(group.key)) groups.set(group.key, { ...group, tasks: [] });
      groups.get(group.key).tasks.push(task);
    });
    list.innerHTML = [...groups.values()].map(group => `
      <section aria-label="${group.title}">
        <h2 class="dmt-group-title ${group.tone}">${group.title} <span>${group.tasks.length}件</span></h2>
        ${group.tasks.map(task => taskMarkup(task, false)).join('')}
      </section>`).join('');
  };

  const renderBoard = () => {
    const board = byId('dmt-board-body');
    const sorted = [...state.tasks].sort((a, b) => targetTime(a) - targetTime(b));
    const task = sorted.find(item => targetTime(item) > Date.now()) || sorted[0];
    if (!task) {
      board.innerHTML = '<div class="dmt-board-empty"><strong>すべて完了しています。</strong><br>新しいタスクを追加すると、ここに次の締切が表示されます。</div>';
      return;
    }

    const countdown = countdownFor(task);
    const remaining = Math.max(0, countdown.diffMs);
    const days = Math.floor(remaining / 86400000);
    const hours = Math.floor((remaining % 86400000) / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    const progress = Number.isFinite(remaining) ? Math.max(0, Math.min(100, remaining / 604800000 * 100)) : 100;
    const cells = [
      [days, 'DAYS', ''],
      [hours, 'HOURS', ''],
      [minutes, 'MIN', ''],
      [seconds, 'SEC', 'seconds']
    ];
    const countHTML = cells.map(([value, label, className], index) => `${index ? `<span class="dmt-count-sep ${className}">:</span>` : ''}<span class="dmt-count-cell ${className}"><strong class="dmt-count-num">${String(value).padStart(2, '0')}</strong><small>${label}</small></span>`).join('');

    board.innerHTML = `
      <div class="dmt-board-course">${escapeHTML(task.course || 'カテゴリなし')} <span class="dmt-when">締切 ${escapeHTML(formatDeadline(task))}</span></div>
      <div class="dmt-board-title">${escapeHTML(task.title || '無題')}</div>
      ${countdown.overdue
        ? '<div class="dmt-count danger"><span class="dmt-count-cell"><strong class="dmt-count-num">OVER</strong><small>期限切れ — すでに対象時刻を過ぎています</small></span></div>'
        : `<div class="dmt-count ${countdown.state}">${countHTML}</div>`}
      <div class="dmt-board-bar ${countdown.state}">
        <div class="dmt-board-track"><div class="dmt-board-fill" style="width:${progress.toFixed(2)}%"></div></div>
        <div class="dmt-board-meta"><span>残り時間（7日を100%として表示）</span><span>${Math.round(progress)}%</span></div>
      </div>`;
  };

  function render() {
    const urgentCount = state.tasks.filter(task => countdownFor(task).state === 'danger').length;
    byId('dmt-count-all').textContent = String(state.tasks.length);
    byId('dmt-count-urgent').textContent = String(urgentCount);
    byId('dmt-count-done').textContent = String(state.doneTasks.length);
    byId('dmt-tab-all').textContent = String(state.tasks.length);
    byId('dmt-tab-urgent').textContent = String(urgentCount);
    byId('dmt-tab-done').textContent = String(state.doneTasks.length);
    root.querySelectorAll('[data-dmt-tab]').forEach(button => {
      const selected = button.dataset.dmtTab === activeTab;
      button.setAttribute(button.getAttribute('role') === 'tab' ? 'aria-selected' : 'aria-pressed', String(selected));
    });
    updateSyncLabels();
    renderBoard();
    renderList();
  }

  const findTask = (id, source) => {
    const collection = source === 'done' ? state.doneTasks : state.tasks;
    return collection.find(task => String(task.id) === String(id));
  };

  const openTaskDialog = (task = null, source = 'tasks') => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    fields.id.value = task?.id ?? '';
    fields.source.value = task ? source : 'tasks';
    fields.title.value = task?.title ?? '';
    fields.course.value = task?.course ?? '';
    fields.priority.value = task?.priority ?? 'mid';
    fields.date.value = task?.date ?? localDateString(tomorrow);
    fields.period.value = task?.period ?? 'end';
    byId('dmt-dialog-title').textContent = task ? 'タスクを編集' : '新規タスク';
    byId('dmt-delete').hidden = !task;
    taskDialog.showModal();
    window.requestAnimationFrame(() => fields.title.focus());
  };

  const closeDialog = dialog => {
    if (dialog.open) dialog.close();
  };

  const refreshFromStorage = () => {
    if (taskDialog.open || configDialog.open) {
      pendingRefresh = true;
      return;
    }
    state = loadDeadlineState(localStorage);
    pendingRefresh = false;
    render();
  };
  [taskDialog, configDialog].forEach(dialog => {
    dialog.addEventListener('close', () => {
      if (pendingRefresh) refreshFromStorage();
    });
  });

  const toggleTask = (id, wasDone) => {
    const source = wasDone ? state.doneTasks : state.tasks;
    const destination = wasDone ? state.tasks : state.doneTasks;
    const index = source.findIndex(task => String(task.id) === String(id));
    if (index < 0) return;
    destination.push(source.splice(index, 1)[0]);
    persist(wasDone ? 'タスクを未完了に戻しました' : 'タスクを完了しました');
  };

  const updateClock = () => {
    const now = new Date();
    byId('dmt-clock').textContent = new Intl.DateTimeFormat('ja-JP', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(now);
    byId('dmt-clock-date').textContent = `${localDateString(now).replaceAll('-', '.')} (${'日月火水木金土'[now.getDay()]})`;
  };

  root.querySelectorAll('[data-dmt-tab]').forEach(button => {
    button.addEventListener('click', () => {
      activeTab = button.dataset.dmtTab;
      render();
    });
  });

  list.addEventListener('click', event => {
    const toggle = event.target.closest('[data-dmt-toggle]');
    if (toggle) {
      event.stopPropagation();
      toggleTask(toggle.dataset.dmtToggle, toggle.dataset.dmtDone === 'true');
      return;
    }
    const taskElement = event.target.closest('[data-dmt-open]');
    if (!taskElement) return;
    const task = findTask(taskElement.dataset.dmtOpen, taskElement.dataset.dmtSource);
    if (task) openTaskDialog(task, taskElement.dataset.dmtSource);
  });

  list.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('[data-dmt-toggle]')) return;
    const taskElement = event.target.closest('[data-dmt-open]');
    if (!taskElement) return;
    event.preventDefault();
    const task = findTask(taskElement.dataset.dmtOpen, taskElement.dataset.dmtSource);
    if (task) openTaskDialog(task, taskElement.dataset.dmtSource);
  });

  byId('dmt-fab').addEventListener('click', () => openTaskDialog());
  byId('dmt-dialog-close').addEventListener('click', () => closeDialog(taskDialog));
  byId('dmt-cancel').addEventListener('click', () => closeDialog(taskDialog));
  byId('dmt-settings').addEventListener('click', () => {
    updateSyncLabels();
    configDialog.showModal();
  });
  byId('dmt-config-close').addEventListener('click', () => closeDialog(configDialog));

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const id = fields.id.value;
    const source = fields.source.value || 'tasks';
    if (pendingRefresh) {
      state = loadDeadlineState(localStorage);
      pendingRefresh = false;
    }
    const task = {
      id: id || Date.now(),
      title: fields.title.value.trim(),
      course: fields.course.value.trim(),
      priority: fields.priority.value,
      date: fields.date.value,
      period: fields.period.value
    };
    if (id) {
      const collection = source === 'done' ? state.doneTasks : state.tasks;
      const index = collection.findIndex(item => String(item.id) === String(id));
      if (index < 0) {
        showToast('他の画面でタスクが移動・削除されています。最新の一覧を確認してください');
        closeDialog(taskDialog);
        render();
        return;
      }
      collection[index] = { ...collection[index], ...task, id: collection[index].id };
    } else {
      state.tasks.push(task);
      activeTab = 'all';
    }
    persist(id ? 'タスクを更新しました' : '新規タスクを追加しました');
    closeDialog(taskDialog);
  });

  byId('dmt-delete').addEventListener('click', () => {
    const id = fields.id.value;
    const source = fields.source.value === 'done' ? 'doneTasks' : 'tasks';
    if (!id || !window.confirm('このタスクを削除しますか？')) return;
    if (pendingRefresh) {
      state = loadDeadlineState(localStorage);
      pendingRefresh = false;
    }
    state[source] = state[source].filter(task => String(task.id) !== String(id));
    persist('タスクを削除しました');
    closeDialog(taskDialog);
  });

  root.querySelector('.dm-pill')?.addEventListener('click', () => {
    if (!syncConfigured()) showToast('Sync SettingsでD1同期を接続できます');
  });

  window.addEventListener('storage', event => {
    if (![STORAGE_KEY, DONE_KEY, BLOB_KEY, 'dt_sync_provider_deadline'].includes(event.key)) return;
    refreshFromStorage();
  });

  window.addEventListener('dt-d1-before-reload', event => {
    if (event.detail?.appKey !== APP_KEY) return;
    event.preventDefault();
    refreshFromStorage();
  });

  window.addEventListener('dt-d1-sync-status', event => {
    if (event.detail?.appKey !== APP_KEY) return;
    if (event.detail.ok && Number(event.detail.pulled) > 0) refreshFromStorage();
  });

  updateClock();
  render();
  window.setInterval(() => {
    updateClock();
    renderBoard();
  }, 1000);
}

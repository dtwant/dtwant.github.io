export const STORAGE_KEY = 'dt_deadline_v5';
export const DONE_KEY = 'dt_deadline_done_v5';
export const BLOB_KEY = 'dt_deadline_blob_id';
export const APP_KEY = 'deadline';

export const PERIOD_TIMES = Object.freeze({
  1: '08:50',
  2: '10:30',
  3: '13:00',
  4: '14:40',
  5: '16:20',
  end: '23:59'
});

function localDateString(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function readArray(storage, key) {
  const raw = storage?.getItem?.(key);
  if (raw === null || raw === undefined) return { exists: false, value: [] };
  try {
    const parsed = JSON.parse(raw);
    return { exists: true, value: Array.isArray(parsed) ? parsed : [] };
  } catch (_) {
    return { exists: true, value: [] };
  }
}

export function loadDeadlineState(storage, now = new Date()) {
  const pending = readArray(storage, STORAGE_KEY);
  const completed = readArray(storage, DONE_KEY);
  if (pending.exists || completed.exists) {
    return { tasks: pending.value, doneTasks: completed.value, seeded: false };
  }

  const tomorrow = new Date(now.getTime());
  tomorrow.setDate(tomorrow.getDate() + 1);
  return {
    tasks: [{
      id: 1,
      title: 'サンプル: 物理学レポート',
      course: '物理学',
      priority: 'high',
      date: localDateString(tomorrow),
      period: 'end'
    }],
    doneTasks: [],
    seeded: true
  };
}

export function saveDeadlineState(storage, state) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
  storage.setItem(DONE_KEY, JSON.stringify(state.doneTasks));
}

export function targetTime(task) {
  if (!task?.date) return Number.POSITIVE_INFINITY;
  const time = PERIOD_TIMES[task.period] || PERIOD_TIMES.end;
  const target = new Date(`${task.date}T${time}:00`).getTime();
  return Number.isFinite(target) ? target : Number.POSITIVE_INFINITY;
}

export function countdownFor(task, now = new Date()) {
  const target = targetTime(task);
  if (!Number.isFinite(target)) {
    return { text: '期限未設定', diffMs: Number.POSITIVE_INFINITY, state: 'safe', overdue: false };
  }
  const diffMs = target - now.getTime();
  if (diffMs <= 0) return { text: '期限切れ', diffMs, state: 'danger', overdue: true };

  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(hours / 24);
  const state = hours <= 24 ? 'danger' : hours <= 72 ? 'warn' : 'safe';
  return {
    text: days >= 1 ? `残り ${days}日` : `残り ${hours}時間`,
    diffMs,
    state,
    overdue: false
  };
}

const STATUS_VALUES = ['', 'knife', 'peach', 'heart'];

export function cycleValue(value) {
  const index = STATUS_VALUES.indexOf(value);
  return STATUS_VALUES[(index < 0 ? 0 : index + 1) % STATUS_VALUES.length];
}

export function memoKey(dateKey, columnId) {
  return `${String(dateKey)}:${String(columnId)}`;
}

export function hasMemo(memo) {
  return Boolean(memo && typeof memo.text === 'string' && memo.text.trim() && !memo.deletedAt);
}

export function setMemo(state, dateKey, columnId, text, meta = {}) {
  const value = typeof text === 'string' ? text.trim() : '';
  const key = memoKey(dateKey, columnId);
  const updatedAt = Number(meta.updatedAt) || Date.now();
  const updatedBy = String(meta.updatedBy || state.deviceId || 'local-device');
  const previous = state.memos && state.memos[key] ? state.memos[key] : {};
  const memo = {
    ...previous,
    ...meta,
    text: value,
    updatedAt,
    updatedBy,
    deletedAt: value ? null : updatedAt
  };
  return {
    ...state,
    memos: { ...(state.memos || {}), [key]: memo },
    updatedAt: Math.max(Number(state.updatedAt) || 0, updatedAt)
  };
}

function compareVersion(left, right) {
  const leftTime = Number(left?.updatedAt) || 0;
  const rightTime = Number(right?.updatedAt) || 0;
  if (leftTime !== rightTime) return leftTime > rightTime ? 1 : -1;
  const leftDevice = String(left?.updatedBy || '');
  const rightDevice = String(right?.updatedBy || '');
  if (leftDevice === rightDevice) return 0;
  return leftDevice > rightDevice ? 1 : -1;
}

function mergeItemMap(localMap, remoteMap) {
  const merged = { ...(localMap || {}) };
  Object.entries(remoteMap || {}).forEach(([id, remoteItem]) => {
    const localItem = merged[id];
    if (!localItem || compareVersion(remoteItem, localItem) > 0) merged[id] = { ...remoteItem };
  });
  return merged;
}

function mergeRecords(localRecords, remoteRecords) {
  const merged = {};
  const dates = new Set([...Object.keys(localRecords || {}), ...Object.keys(remoteRecords || {})]);
  dates.forEach((dateKey) => {
    const localDay = localRecords?.[dateKey] || {};
    const remoteDay = remoteRecords?.[dateKey] || {};
    const day = { ...localDay };
    if (localDay.main || remoteDay.main) {
      day.main = !localDay.main || (remoteDay.main && compareVersion(remoteDay.main, localDay.main) > 0)
        ? { ...remoteDay.main }
        : { ...localDay.main };
    }
    if (localDay.tasks || remoteDay.tasks) day.tasks = mergeItemMap(localDay.tasks, remoteDay.tasks);
    merged[dateKey] = day;
  });
  return merged;
}

export function mergeStates(localState, remoteState) {
  const local = localState && typeof localState === 'object' ? localState : {};
  const remote = remoteState && typeof remoteState === 'object' ? remoteState : {};
  return {
    ...local,
    ...remote,
    version: 1,
    app: 'ritual_grid',
    deviceId: local.deviceId || remote.deviceId || 'local-device',
    updatedAt: Math.max(Number(local.updatedAt) || 0, Number(remote.updatedAt) || 0),
    tasks: mergeItemMap(local.tasks, remote.tasks),
    records: mergeRecords(local.records, remote.records),
    memos: mergeItemMap(local.memos, remote.memos)
  };
}

export function classifyPress(durationMs, movedPx) {
  if (Number(movedPx) > 8) return 'cancel';
  return Number(durationMs) >= 850 ? 'long-press' : 'tap';
}

export { STATUS_VALUES };

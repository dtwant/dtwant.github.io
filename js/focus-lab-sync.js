/* Loss-aware state normalization and merge rules for Focus Lab. */
(function (root) {
  'use strict';

  const DEFAULT_STATE = {
    version: 2,
    mode: 'timer',
    focusPreset: 50,
    customMinutes: 45,
    total: 50 * 60,
    remaining: 50 * 60,
    elapsedStopwatch: 0,
    running: false,
    startedAt: null,
    activeTaskId: null,
    tasks: [],
    logs: {},
    settings: { sound: true, flash: true }
  };

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function normalize(value) {
    if (!isObject(value)) return null;
    return {
      ...DEFAULT_STATE,
      ...value,
      tasks: Array.isArray(value.tasks) ? value.tasks : [],
      logs: isObject(value.logs) ? value.logs : {},
      settings: { ...DEFAULT_STATE.settings, ...(isObject(value.settings) ? value.settings : {}) }
    };
  }

  function mergeTasks(localTasks, remoteTasks) {
    const byId = new Map();
    const withoutId = [];

    for (const task of remoteTasks) {
      if (isObject(task) && task.id) byId.set(task.id, task);
      else withoutId.push(task);
    }
    for (const task of localTasks) {
      if (!isObject(task) || !task.id) {
        withoutId.push(task);
        continue;
      }
      const remoteTask = byId.get(task.id);
      byId.set(task.id, remoteTask
        ? { ...remoteTask, ...task, done: Boolean(remoteTask.done || task.done) }
        : task);
    }
    return [...byId.values(), ...withoutId];
  }

  function mergeLogs(localLogs, remoteLogs) {
    const logs = {};
    for (const date of new Set([...Object.keys(remoteLogs), ...Object.keys(localLogs)])) {
      const remoteLog = isObject(remoteLogs[date]) ? remoteLogs[date] : {};
      const localLog = isObject(localLogs[date]) ? localLogs[date] : {};
      logs[date] = {
        ...remoteLog,
        ...localLog,
        focusSecs: Math.max(Number(remoteLog.focusSecs) || 0, Number(localLog.focusSecs) || 0),
        sessions: Math.max(Number(remoteLog.sessions) || 0, Number(localLog.sessions) || 0),
        doneTasks: Math.max(Number(remoteLog.doneTasks) || 0, Number(localLog.doneTasks) || 0)
      };
    }
    return logs;
  }

  function merge(localValue, remoteValue) {
    const localRaw = isObject(localValue) ? localValue : {};
    const remoteRaw = isObject(remoteValue) ? remoteValue : {};
    const local = normalize(localRaw) || { ...DEFAULT_STATE, settings: { ...DEFAULT_STATE.settings } };
    const remote = normalize(remoteRaw) || { ...DEFAULT_STATE, settings: { ...DEFAULT_STATE.settings } };
    return {
      ...DEFAULT_STATE,
      ...remoteRaw,
      ...localRaw,
      tasks: mergeTasks(local.tasks, remote.tasks),
      logs: mergeLogs(local.logs, remote.logs),
      settings: {
        ...DEFAULT_STATE.settings,
        ...(isObject(remoteRaw.settings) ? remoteRaw.settings : {}),
        ...(isObject(localRaw.settings) ? localRaw.settings : {})
      }
    };
  }

  function forSync(value) {
    const state = normalize(value);
    if (!state) return null;
    return { ...state, running: false, startedAt: null };
  }

  root.FocusLabSync = { normalize, merge, forSync };
})(typeof window !== 'undefined' ? window : globalThis);

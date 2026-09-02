// Task supervision: tracks every background automation's heartbeat and
// auto-restarts any task whose timer stalls. This is the "watchdog of the
// watchdogs" - it guarantees automute/bans/admin/welcome/etc. keep running
// even if an individual scheduler dies or throws without being caught.

import { getLinkStatus } from './link.js';

const CHECK_MS = 15000;            // how often the supervisor runs
const STALL_GRACE_MS = 60000;      // extra time beyond a task's own interval before we consider it stalled

const tasks = new Map();           // id -> { id, name, expected, lastBeat, start, stop, beats, errors, state }

let supervisorTimer = null;
let supervisorStarted = false;

export function registerTask({ id, name, expected, start, stop }) {
  const existing = tasks.get(id);
  if (existing) return existing;
  const task = {
    id,
    name,
    expected: expected || 0,
    lastBeat: Date.now(),
    start: start || null,          // () => any; should (re)start the underlying scheduler
    stop: stop || null,            // () => any; should stop the underlying scheduler
    beats: 0,
    errors: 0,
    state: 'waiting',              // waiting | running | stalled | stopped
    activeTimer: null,
  };
  tasks.set(id, task);
  beat(id);
  return task;
}

// Record that a task just did work. Call this on every successful run of a
// background job.
export function beat(id) {
  const t = tasks.get(id);
  if (!t) return;
  t.lastBeat = Date.now();
  t.beats += 1;
  t.state = 'running';
}

// Record a task failure (does NOT mark it stalled - that's for the supervisor).
export function taskError(id, err) {
  const t = tasks.get(id);
  if (!t) return;
  t.errors += 1;
  console.log(`[tasks] ${id} error: ${err?.message || err}`);
}

function isStalled(t) {
  // A task is only "stalled" if it has gone well past its own expected
  // cadence. interval<=0 (one-shot like lidmap) uses a fixed grace.
  const grace = (t.expected > 0 ? t.expected : STALL_GRACE_MS) + STALL_GRACE_MS;
  return Date.now() - t.lastBeat > grace;
}

function restartTask(t) {
  console.log(`[tasks] ATTEMPTING restart of stalled task "${t.name}" (${t.id})`);
  try {
    if (t.stop) t.stop();
  } catch (e) {
    console.log(`[tasks] stop of ${t.id} failed: ${e.message}`);
  }
  try {
    if (t.start) t.start();
  } catch (e) {
    t.errors += 1;
    console.log(`[tasks] restart of ${t.id} failed: ${e.message}`);
  }
  t.lastBeat = Date.now();
}

export function startSupervisor() {
  if (supervisorStarted) return;
  supervisorStarted = true;
  console.log(`[tasks] supervisor running (heartbeat check every ${CHECK_MS / 1000}s, stall after ${Math.round(STALL_GRACE_MS / 1000)}s)`);
  supervisorTimer = setInterval(() => {
    for (const t of tasks.values()) {
      try {
        if (t.state === 'stopped') continue;
        if (isStalled(t)) {
          t.state = 'stalled';
          restartTask(t);
        }
      } catch (e) {
        console.log(`[tasks] supervisor error on ${t.id}: ${e.message}`);
      }
    }
  }, CHECK_MS);
  return supervisorTimer;
}

export function stopSupervisor() {
  if (supervisorTimer) {
    clearInterval(supervisorTimer);
    supervisorTimer = null;
  }
  supervisorStarted = false;
}

export function getTaskSnapshot() {
  const out = {};
  for (const [id, t] of tasks) {
    out[id] = {
      name: t.name,
      state: t.state,
      beats: t.beats,
      errors: t.errors,
      lastBeatMsAgo: Date.now() - t.lastBeat,
      expectedIntervalMs: t.expected,
    };
  }
  return out;
}

export function getHealthSnapshot() {
  const now = Date.now();
  const taks = [...tasks.values()];
  const stalled = taks.filter((t) => isStalled(t)).map((t) => t.id);
  return {
    link: getLinkStatus(),
    supervisors: {
      running: !!supervisorTimer,
    },
    tasks: Object.keys(tasks).length,
    stalled,
    heartbeat: now,
  };
}

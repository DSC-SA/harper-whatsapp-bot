import { mkdir, readFile, writeFile } from 'fs/promises';
import { config } from '../config.js';

const STATE_FILE = 'data/state.json';

let state = { groups: {}, warns: {}, flood: {}, afk: {} };
let saveTimer = null;

async function load() {
  try {
    const raw = await readFile(STATE_FILE, 'utf8');
    state = { groups: {}, warns: {}, flood: {}, afk: {}, ...(JSON.parse(raw) || {}) };
  } catch {
    state = { groups: {}, warns: {}, flood: {}, afk: {} };
  }
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await mkdir('data', { recursive: true });
      await writeFile(STATE_FILE, JSON.stringify(state), 'utf8');
    } catch {}
  }, 500);
}

export async function initState() {
  await load();
}

export function getGroup(jid) {
  if (!state.groups[jid]) {
    state.groups[jid] = {
      antilink: config.antilinkDefault,
      allowedLinks: [],
      blockedLinks: [],
      antibad: 'off',
      badWords: [],
      antispam: 'off',
      welcome: 'off',
      welcomeMsg: '',
      goodBye: 'off',
      automute: null,
    };
  }
  return state.groups[jid];
}

export function saveGroup(jid, group) {
  state.groups[jid] = group;
  persist();
}

export function getWarns(key) {
  return state.warns[key] || 0;
}

export function setWarns(key, n) {
  state.warns[key] = n;
  persist();
}

export function addWarn(key) {
  const warns = getWarns(key) + 1;
  state.warns[key] = warns;
  persist();
  return warns;
}

export function resetWarns(key) {
  delete state.warns[key];
  persist();
}

export function getFlood(jid, senderJid) {
  return state.flood[`${jid}:${senderJid}`] || [];
}

export function pushFlood(jid, senderJid, ts) {
  const key = `${jid}:${senderJid}`;
  const arr = (state.flood[key] || []).concat(ts).slice(-30);
  state.flood[key] = arr;
  persist();
  return arr;
}

export function resetFlood(jid, senderJid) {
  delete state.flood[`${jid}:${senderJid}`];
  persist();
}

export function getAfk(jid) {
  return state.afk[jid];
}

export function setAfk(jid, data) {
  if (data) state.afk[jid] = data;
  else delete state.afk[jid];
  persist();
}

export function getState() {
  return state;
}
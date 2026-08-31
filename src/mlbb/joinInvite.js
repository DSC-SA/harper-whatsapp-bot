import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const FILE = 'data/mlbbJoinInvites.json';

function load() {
  try {
    if (!existsSync(FILE)) return {};
    return JSON.parse(readFileSync(FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

function save(data) {
  try {
    mkdirSync('data', { recursive: true });
    writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch {}
}

export function markInvited(uid, groupJid) {
  const d = load();
  d[uid] = { group: groupJid, at: Date.now() };
  save(d);
}

export function hasInvite(uid) {
  return !!load()[uid];
}

export function clearInvite(uid) {
  const d = load();
  if (d[uid]) {
    delete d[uid];
    save(d);
  }
}
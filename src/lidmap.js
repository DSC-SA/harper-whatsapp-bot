import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = join('data', 'lid-map.json');
const IS_LID = (j) => String(j || '').endsWith('@lid');
const norm = (j) => String(j || '').replace(/:[0-9]+/, '').toLowerCase();

let db = null;
let saveTimer = null;
const metaCache = new Map();

function defaults() {
  return { lidToPn: {}, pnToLid: {} };
}

export function loadLidMap() {
  if (db) return db;
  try {
    const parsed = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8') || '{}') : {};
    db = { lidToPn: parsed.lidToPn || {}, pnToLid: parsed.pnToLid || {} };
  } catch {
    db = defaults();
  }
  return db;
}

export function recordLidMapping(lid, pn) {
  if (!lid || !pn) return;
  const l = norm(lid);
  if (!l.endsWith('@lid')) return;
  const p = norm(pn);
  const pnJid = p.includes('@') ? p : `${p}@s.whatsapp.net`;
  if (pnJid.endsWith('@lid') || !pnJid.endsWith('@s.whatsapp.net')) return;
  const { lidToPn, pnToLid } = loadLidMap();
  if (lidToPn[l] === pnJid && pnToLid[pnJid] === l) return;
  lidToPn[l] = pnJid;
  pnToLid[pnJid] = l;
  const seenNew = lidToPn[l] === pnJid;
  if (seenNew) console.log(`[harper] mapped lid ${l} -> ${pnJid}`);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      mkdirSync('data', { recursive: true });
      writeFileSync(FILE, JSON.stringify({ lidToPn, pnToLid }, null, 2), 'utf8');
    } catch (err) {
      console.log(`[harper] lidmap save failed: ${err.message}`);
    }
  }, 1500);
}

export function pnFor(jid) {
  const k = norm(jid);
  if (!k.endsWith('@lid')) return k || '';
  return loadLidMap().lidToPn[k] || '';
}

export function lidFor(pnJidOrNum) {
  const j = norm(pnJidOrNum);
  const jid = j.includes('@') ? j : `${j}@s.whatsapp.net`;
  return loadLidMap().pnToLid[jid] || '';
}

export function resolveUserJid(jid) {
  const k = norm(jid);
  if (IS_LID(k)) {
    const pn = loadLidMap().lidToPn[k];
    if (pn) return pn;
  }
  return k;
}

export function recordKeyMappings(key = {}) {
  const pair = (lid, pn) => recordLidMapping(lid, pn);
  pair(key.senderLid, key.senderPn);
  pair(key.participantLid, key.participantPn);
  pair(key.participant, key.participantPn);
}

export async function recordGroupMappings(sock, groupJid) {
  if (!groupJid) return;
  const now = Date.now();
  const cached = metaCache.get(groupJid);
  if (cached && now - cached < 60000) return;
  try {
    const { getGroupMetadata } = await import('./groupCache.js');
    const meta = await getGroupMetadata(sock, groupJid);
    for (const p of meta?.participants || []) {
      const lid = p.lid || (IS_LID(p.id) ? p.id : null);
      const pn = p.jid || (p.id && !IS_LID(p.id) ? p.id : null);
      if (lid && pn) recordLidMapping(lid, pn);
    }
    metaCache.set(groupJid, now);
  } catch {}
}

export async function resolveGroupUser(sock, groupJid, jid) {
  if (jid && IS_LID(jid)) {
    const pn = pnFor(jid);
    if (pn) return pn;
    await recordGroupMappings(sock, groupJid);
    const pn2 = pnFor(jid);
    if (pn2) return pn2;
  }
  return jid;
}
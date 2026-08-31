import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pnFor, lidFor } from './lidmap.js';
import { getGroupMetadata, fetchAllGroups, getGroupIds } from './groupCache.js';

const FILE = 'data/admins.json';
const norm = (j) => String(j || '').replace(/:[0-9]+/, '').toLowerCase();
const isLid = (j) => String(j || '').endsWith('@lid');

let registry = new Map();
let refreshTimer = null;
const pending = new Map();

export function loadAdmins() {
  registry = new Map();
  try {
    if (!existsSync(FILE)) return;
    const parsed = JSON.parse(readFileSync(FILE, 'utf8')) || {};
    for (const [g, a] of Object.entries(parsed)) {
      registry.set(g, { lids: new Set(a.lids || []), pns: new Set(a.pns || []) });
    }
  } catch {}
}

function persist() {
  const out = {};
  for (const [g, a] of registry) {
    out[g] = { lids: [...a.lids], pns: [...a.pns] };
  }
  try {
    mkdirSync('data', { recursive: true });
    writeFileSync(FILE, JSON.stringify(out, null, 2), 'utf8');
  } catch {}
}

export async function refreshGroupAdmins(sock, groupJid) {
  if (!groupJid) return;
  if (pending.has(groupJid)) return pending.get(groupJid);
  const prom = getGroupMetadata(sock, groupJid)
    .then((meta) => {
      const lids = new Set();
      const pns = new Set();
      for (const p of meta?.participants || []) {
        if (!p.admin) continue;
        const pid = String(p.id || '');
        const lid = p.lid || (isLid(pid) ? pid : null);
        const pn = p.jid || (!isLid(pid) ? pid : null);
        if (lid) lids.add(norm(lid));
        if (pn) pns.add(norm(pn));
      }
      registry.set(groupJid, { lids, pns });
      persist();
    })
    .catch(() => {})
    .finally(() => pending.delete(groupJid));
  pending.set(groupJid, prom);
  return prom;
}

export async function refreshAllAdmins(sock) {
  try {
    const groups = await fetchAllGroups(sock);
    const ids = Object.keys(groups || {});
    for (const gid of ids) {
      const existing = registry.get(gid);
      if (existing && (existing.lids?.size || existing.pns?.size)) continue;
      refreshGroupAdmins(sock, gid).catch(() => {});
    }
    console.log(`[harper] admin detection checked across ${ids.length} groups (rate-limit aware)`);
  } catch (e) {
    if (e?.isRateLimited) {
      console.log(`[harper] admin refresh skipped: ${e.message}`);
    } else {
      console.log(`[harper] admin refresh failed: ${e.message}`);
    }
  }
}

export function startAdminRefresh(sock) {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshAllAdmins(sock);
  refreshTimer = setInterval(() => refreshAllAdmins(sock), 600000);
  return refreshTimer;
}

export function groupAdmins(groupJid) {
  const entry = registry.get(groupJid);
  return entry ? [...new Set([...entry.pns, ...entry.lids])] : [];
}

export async function isGroupAdmin(sock, groupJid, participantJid) {
  if (!groupJid) return false;
  const p = norm(participantJid);
  if (!p) return false;
  let entry = registry.get(groupJid);
  if (!entry) {
    await refreshGroupAdmins(sock, groupJid);
    entry = registry.get(groupJid);
  }
  if (!entry) return false;
  if (isLid(p)) {
    if (entry.lids.has(p)) return true;
    const pn = norm(pnFor(p));
    if (pn && entry.pns.has(pn)) return true;
  } else {
    if (entry.pns.has(p)) return true;
    const lid = norm(lidFor(p));
    if (lid && entry.lids.has(lid)) return true;
  }
  return false;
}
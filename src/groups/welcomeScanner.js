import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { config } from '../../config.js';
import { getGroup } from '../state.js';
import { getAllGroupIds, getGroupMetadata } from '../groupCache.js';
import { getCleanUserNumber } from '../helpers.js';
import { resolveUserJid } from '../lidmap.js';
import { sendRichWelcome } from '../welcome.js';

const FILE = 'data/welcomeRoster.json';

let roster = {};
let scannerStarted = false;

function load() {
  try {
    if (!existsSync(FILE)) return {};
    return JSON.parse(readFileSync(FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

function save() {
  try {
    mkdirSync('data', { recursive: true });
    writeFileSync(FILE, JSON.stringify(roster, null, 2), 'utf8');
  } catch {}
}

function ensureGroup(jid) {
  if (!roster[jid]) roster[jid] = [];
}

export function markWelcomeSeen(jid, numbers = []) {
  if (!roster[jid]) roster[jid] = [];
  for (const n of numbers) {
    const num = getCleanUserNumber(n);
    if (num && !roster[jid].includes(num)) roster[jid].push(num);
  }
  save();
}

export async function seedRoster(sock, jid) {
  try {
    const meta = await getGroupMetadata(sock, jid, { fresh: true });
    const nums = (meta?.participants || []).map((p) => getCleanUserNumber(p.jid || p.id));
    markWelcomeSeen(jid, nums);
    console.log(`[welcomeScanner] seeded roster for ${jid}: ${nums.length} members`);
  } catch (e) {
    console.log(`[welcomeScanner] seed failed for ${jid}: ${e.message}`);
  }
}

function participantNumbers(meta) {
  const nums = new Set();
  for (const p of meta?.participants || []) {
    const jid = resolveUserJid(p.jid || p.id) || p.jid || p.id;
    const num = getCleanUserNumber(jid);
    if (num) nums.add(num);
  }
  return nums;
}

async function sweep(sock) {
  let groups;
  try {
    groups = await getAllGroupIds(sock);
  } catch (e) {
    console.log(`[welcomeScanner] group fetch failed: ${e.message}`);
    return;
  }

  for (const jid of groups) {
    if (getGroup(jid).welcome !== 'on') continue;
    let meta;
    try {
      meta = await getGroupMetadata(sock, jid, { fresh: true });
    } catch (e) {
      console.log(`[welcomeScanner] metadata failed for ${jid}: ${e.message}`);
      continue;
    }
    if (!meta?.participants) continue;

    ensureGroup(jid);
    const seen = new Set(roster[jid]);
    const current = participantNumbers(meta);
    const botNum = getCleanUserNumber(sock.user?.id);

    const fresh = [...current].filter((n) => !seen.has(n) && n !== botNum && !config.owner.includes(n));
    if (!fresh.length) continue;

    try {
      await sendRichWelcome(sock, jid, fresh.map((n) => `${n}@s.whatsapp.net`), meta);
      markWelcomeSeen(jid, fresh);
      console.log(`[welcomeScanner] welcomed ${fresh.length} new member(s) in ${jid}`);
    } catch (e) {
      console.log(`[welcomeScanner] welcome failed in ${jid}: ${e.message}`);
    }
  }
}

export function startWelcomeScanner(sock) {
  if (scannerStarted) return;
  scannerStarted = true;
  roster = load();
  const mins = Math.max(1, config.welcomeScanMinutes);
  console.log(`[welcomeScanner] scanning every ${mins}min for missed join welcomes`);
  const tick = async () => {
    try {
      await sweep(sock);
    } catch (e) {
      console.log(`[welcomeScanner] sweep error: ${e.message}`);
    }
  };
  tick();
  return setInterval(tick, mins * 60 * 1000);
}
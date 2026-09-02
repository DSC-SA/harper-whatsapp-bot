import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { replyText, getMentionedJids, getCleanUserNumber, parseNumbers } from '../helpers.js';
import { getGroup } from '../state.js';
import { resolveGroupUser, resolveUserJid, pnFor, lidFor } from '../lidmap.js';
import { config } from '../../config.js';
import { getGroupMetadata, fetchAllGroups } from '../groupCache.js';
import { registerTask, beat, taskError } from '../tasks.js';

const BANS_FILE = 'data/bans.json';
const SCAN_MS = 60000;

export function loadBans() {
  try {
    if (!existsSync(BANS_FILE)) return {};
    return JSON.parse(readFileSync(BANS_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

function saveBans(bans) {
  try {
    mkdirSync('data', { recursive: true });
    writeFileSync(BANS_FILE, JSON.stringify(bans, null, 2), 'utf8');
  } catch {}
}

export function addBan(pn, actor, reason) {
  const bans = loadBans();
  bans[pn] = { at: Date.now(), actor: actor || '', reason: reason || '' };
  saveBans(bans);
}

export function removeBan(pn) {
  const bans = loadBans();
  if (bans[pn]) {
    delete bans[pn];
    saveBans(bans);
  }
}

export function isBanned(pn) {
  return !!loadBans()[pn];
}

const normBot = (id) => String(id || '').replace(/:[0-9]+/, '').toLowerCase();

export async function kickBannedFromGroup(sock, groupJid, botJid, bannedNums) {
  const botPn = normBot(botJid);
  const botLid = lidFor(botPn);
  try {
    const meta = await getGroupMetadata(sock, groupJid);
    const botAdmin = (meta.participants || []).some((p) => {
      const pid = String(p.id || '').replace(/:[0-9]+/, '').toLowerCase();
      const pjid = String(p.jid || '').replace(/:[0-9]+/, '').toLowerCase();
      const plid = String(p.lid || '').replace(/:[0-9]+/, '').toLowerCase();
      const isBot = pjid === botPn || pid === botPn || plid === botLid;
      return isBot && !!p.admin;
    });
    if (!botAdmin) return { skipped: true, kicked: 0 };
    const nums = new Set(bannedNums);
    const lids = new Set();
    for (const n of bannedNums) {
      const l = lidFor(n);
      if (l) lids.add(l);
    }
    let kicked = 0;
    for (const p of meta.participants || []) {
      const pid = String(p.id || '');
      const pidLid = p.lid || (pid.endsWith('@lid') ? pid : '');
      const pidPn = p.jid || (!pid.endsWith('@lid') ? pid : '') || (pidLid ? pnFor(pidLid) : '');
      const num = pidPn ? getCleanUserNumber(pidPn) : '';
      if ((num && nums.has(num)) || (pidLid && lids.has(pidLid))) {
        try {
          await sock.groupParticipantsUpdate(groupJid, [pid], 'remove');
          kicked++;
        } catch {}
      }
    }
    return { skipped: false, kicked };
  } catch {
    return { skipped: true, kicked: 0 };
  }
}

export async function kickBannedEverywhere(sock, bannedNums) {
  const set = new Set(bannedNums);
  let kicked = 0;
  let skipped = 0;
  let scanned = 0;
  try {
    const groups = await fetchAllGroups(sock);
    const gids = Object.keys(groups || {});
    for (const gid of gids) {
      scanned++;
      const r = await kickBannedFromGroup(sock, gid, sock.user?.id, [...set]);
      kicked += r.kicked;
      if (r.skipped) skipped++;
    }
  } catch (e) {
    console.log(`[harper] ban kick-all error: ${e.message}`);
  }
  return { kicked, skipped, scanned };
}

let scanTimer = null;

export function startBanScanner(sock) {
  if (scanTimer) clearInterval(scanTimer);
  const scan = async () => {
    try {
      const pns = Object.keys(loadBans());
      if (!pns.length) {
        beat('bans');
        return;
      }
      const r = await kickBannedEverywhere(sock, pns);
      if (r.kicked > 0 || r.skipped > 0) {
        console.log(`[harper] ban scan: kicked ${r.kicked}, skipped ${r.skipped} (no admin) of ${r.scanned} groups`);
      }
      beat('bans');
    } catch (e) {
      taskError('bans', e);
    }
  };
  scan();
  scanTimer = setInterval(scan, SCAN_MS);

  registerTask({
    id: 'bans',
    name: 'global ban kicker',
    expected: SCAN_MS,
    start: (s = sock) => startBanScanner(s),
    stop: () => {
      if (scanTimer) clearInterval(scanTimer);
      scanTimer = null;
    },
  });
  return scanTimer;
}

export async function kickBannedJoiner(sock, update) {
  const pns = Object.keys(loadBans());
  if (!pns.length) return;
  const nums = new Set(pns);
  const lids = new Set();
  for (const n of pns) {
    const l = lidFor(n);
    if (l) lids.add(l);
  }
  for (const p of update.participants || []) {
    const pid = String(p || '');
    const isLid = pid.endsWith('@lid');
    const num = isLid ? getCleanUserNumber(pnFor(pid) || '') : getCleanUserNumber(pid);
    if ((num && nums.has(num)) || (isLid && lids.has(pid))) {
      try {
        await sock.groupParticipantsUpdate(update.id, [pid], 'remove');
      } catch {}
    }
  }
}

export default [
  {
    name: 'ban',
    aliases: ['banuser'],
    owner: true,
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const mentioned = getMentionedJids(msg) || [];
      const quoted = ctx.quotedSender || null;
      const nums = parseNumbers((ctx.argsText || '').replace(/@[0-9]+/g, ' ')).filter((n) => n.length >= 7);
      const raw = [...new Set([
        ...mentioned,
        ...(quoted ? [quoted] : []),
        ...nums.map((n) => `${n}@s.whatsapp.net`),
      ])].filter(Boolean);
      if (!raw.length) {
        return replyText(sock, msg, `Usage: ${config.prefix}ban @user | reply to a message | ${config.prefix}ban <number>\nAdds the user to the global ban list and auto-kicks them from every group where I'm admin.`);
      }
      const targets = new Set();
      for (const j of raw) {
        const resolved = ctx.groupJid ? await resolveGroupUser(sock, ctx.groupJid, j) : resolveUserJid(j);
        const num = getCleanUserNumber(resolved);
        if (num && num.length >= 7) targets.add(num);
      }
      const self = getCleanUserNumber(sock.user?.id);
      const owners = new Set([...config.owner, self]);
      const banned = [];
      for (const n of targets) {
        if (owners.has(n)) continue;
        addBan(n, getCleanUserNumber(ctx.sender), ctx.argsText.replace(/[0-9@+\s]/g, '').trim());
        banned.push(n);
      }
      if (!banned.length) return replyText(sock, msg, 'No valid targets to ban.');
      await replyText(sock, msg, `Banned ${banned.length} user(s): ${banned.map((n) => `@${n}`).join(', ')}.\nScanning all groups and kicking where I'm admin...`);
      const kicked = await kickBannedEverywhere(sock, banned);
      const gotKicked = kicked.kicked;
      const skipped = kicked.skipped;
      const scanned = kicked.scanned;
      if (skipped) {
        console.log(`[harper] ban: kicked ${gotKicked}, skipped ${skipped} groups (bot not admin)`);
      }
      if (gotKicked > 0) {
        return replyText(sock, msg, `Removed ${banned.length} user(s) (${gotKicked} kick${gotKicked === 1 ? '' : 's'} across ${scanned} groups).${skipped ? `\nSkipped ${skipped} group(s) where I'm not admin.` : ''}`);
      }
      return replyText(sock, msg, `Added to ban list. No groups to remove from (I'm not admin in the ${scanned} group(s) I can see). They'll also be kicked instantly if they join any group where I'm admin.`);
    },
  },
  {
    name: 'unban',
    aliases: ['removeban', 'unbanuser'],
    owner: true,
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const entries = Object.entries(loadBans());
      const arg = (args[0] || '').trim();
      const isIndex = /^\d{1,3}$/.test(arg) && +arg >= 1 && +arg <= entries.length;
      if (isIndex) {
        const [pn] = entries[+arg - 1];
        removeBan(pn);
        return replyText(sock, msg, `Unbanned *@${pn}* (was on the list).`);
      }
      if (!arg && !ctx.quotedSender && !getMentionedJids(msg)?.length) {
        if (!entries.length) return replyText(sock, msg, 'Ban list is empty.');
        const list = entries.map(([n, b], i) => `${i + 1}. @${n}${b.reason ? ` — ${b.reason}` : ''}`).join('\n');
        return replyText(sock, msg, `*Ban list (${entries.length})*\n${list}\n\nReply *${config.prefix}unban <number>* to remove one.`);
      }
      const mentioned = getMentionedJids(msg) || [];
      const quoted = ctx.quotedSender || null;
      const nums = parseNumbers(arg.replace(/@[0-9]+/g, ' ')).filter((n) => n.length >= 7);
      const raw = [...new Set([...mentioned, ...(quoted ? [quoted] : []), ...nums])];
      if (!raw.length) {
        return replyText(sock, msg, `Usage: ${config.prefix}unban <number from the list> | @user | reply | phone number`);
      }
      let removed = 0;
      for (const j of raw) {
        if (String(j).includes('@')) {
          const resolved = ctx.groupJid ? await resolveGroupUser(sock, ctx.groupJid, j) : resolveUserJid(j);
          const num = getCleanUserNumber(resolved);
          if (num) { if (loadBans()[num]) { removeBan(num); removed++; } }
        } else {
          if (loadBans()[j]) { removeBan(j); removed++; }
        }
      }
      return replyText(sock, msg, removed ? `Unbanned ${removed} user(s).` : 'No matching banned users found.');
    },
  },
  {
    name: 'bans',
    aliases: ['banlist'],
    owner: true,
    run: async (ctx, args) => {
      const { sock, msg } = ctx;
      const entries = Object.entries(loadBans());
      if (!entries.length) return replyText(sock, msg, 'Ban list is empty.');
      const text = entries.map(([n, b], i) => `${i + 1}. @${n}${b.reason ? ` — ${b.reason}` : ''}`).join('\n');
      return replyText(sock, msg, `*Ban list (${entries.length})*\n${text}\n\nReply *${config.prefix}unban <number>* to remove one.`);
    },
  },
];
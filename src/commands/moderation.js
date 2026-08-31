import { config } from '../../config.js';
import {
  replyText,
  getMentionedJids,
  getCleanUserNumber,
  parseNumbers,
} from '../helpers.js';
import { resolveGroupUser } from '../lidmap.js';
import { kickBannedEverywhere } from '../groups/bans.js';
import { getGroup, saveGroup, getWarns, setWarns, addWarn, resetWarns } from '../state.js';

const jidForNumber = (n) => `${n}@s.whatsapp.net`;

async function targetJids(ctx) {
  const { sock, msg, jid } = ctx;
  const mentioned = getMentionedJids(msg) || [];
  const quoted = ctx.quotedSender || null;
  const nums = parseNumbers(ctx.argsText || '');
  const fromNums = nums.filter((n) => n.length >= 7).map((n) => jidForNumber(n));
  const set = new Set([...mentioned, ...(quoted ? [quoted] : []), ...fromNums]);
  const raw = [...set].filter(Boolean);
  const resolved = [];
  for (const j of raw) {
    const r = await resolveGroupUser(sock, jid, j);
    if (r && !resolved.includes(r)) resolved.push(r);
  }
  return resolved;
}

async function targetSender(ctx) {
  const { sock, msg, jid } = ctx;
  const raw = ctx.quotedSender || getMentionedJids(msg)?.[0];
  if (!raw) return null;
  return resolveGroupUser(sock, jid, raw);
}

export default [
  {
    name: 'kick',
    aliases: ['remove', 'rm', 'ban'],
    group: true,
    admin: true,
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const targets = await targetJids(ctx);
      if (!targets.length) return replyText(sock, msg, 'Mention or list the members to kick.');
      try {
        await sock.groupParticipantsUpdate(jid, targets, 'remove');
        return replyText(sock, msg, `Kicked ${targets.length} member(s).`);
      } catch (e) {
        return replyText(sock, msg, `Kick failed: ${e.message}`);
      }
    },
  },
  {
    name: 'add',
    group: true,
    admin: true,
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const nums = parseNumbers(args.join(' ')).filter((n) => n.length >= 7);
      if (!nums.length) return replyText(sock, msg, 'Usage: !add 919876543210,919876543211');
      try {
        await sock.groupParticipantsUpdate(jid, nums.map(jidForNumber), 'add');
        return replyText(sock, msg, `Added ${nums.length} member(s).`);
      } catch (e) {
        return replyText(sock, msg, `Add failed: ${e.message}`);
      }
    },
  },
  {
    name: 'promote',
    aliases: ['admin'],
    group: true,
    admin: true,
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const targets = await targetJids(ctx);
      if (!targets.length) return replyText(sock, msg, 'Mention the member to promote.');
      try {
        await sock.groupParticipantsUpdate(jid, targets, 'promote');
        return replyText(sock, msg, `Promoted ${targets.length} member(s).`);
      } catch (e) {
        return replyText(sock, msg, `Promote failed: ${e.message}`);
      }
    },
  },
  {
    name: 'demote',
    aliases: ['unadmin'],
    group: true,
    admin: true,
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const targets = await targetJids(ctx);
      if (!targets.length) return replyText(sock, msg, 'Mention the member to demote.');
      try {
        await sock.groupParticipantsUpdate(jid, targets, 'demote');
        return replyText(sock, msg, `Demoted ${targets.length} member(s).`);
      } catch (e) {
        return replyText(sock, msg, `Demote failed: ${e.message}`);
      }
    },
  },
  {
    name: 'mute',
    aliases: ['lock'],
    group: true,
    admin: true,
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      try {
        await sock.groupSettingUpdate(jid, 'announcement');
        return replyText(sock, msg, 'Group muted. Only admins can chat now.');
      } catch (e) {
        return replyText(sock, msg, `Mute failed: ${e.message}`);
      }
    },
  },
  {
    name: 'unmute',
    aliases: ['unlock'],
    group: true,
    admin: true,
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      try {
        await sock.groupSettingUpdate(jid, 'not_announcement');
        return replyText(sock, msg, 'Group unmuted. Everyone can chat again.');
      } catch (e) {
        return replyText(sock, msg, `Unmute failed: ${e.message}`);
      }
    },
  },
  {
    name: 'welcome',
    group: true,
    admin: true,
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const group = getGroup(jid);
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'on' || sub === 'enable') {
        group.welcome = 'on';
        group.goodbye = 'on';
        saveGroup(jid, group);
        return replyText(sock, msg, 'Welcome/goodbye messages enabled.');
      }
      if (sub === 'off' || sub === 'disable') {
        group.welcome = 'off';
        group.goodbye = 'off';
        saveGroup(jid, group);
        return replyText(sock, msg, 'Welcome/goodbye messages disabled.');
      }
      if (sub === 'set' || sub === 'msg') {
        const text = args.slice(1).join(' ').trim();
        if (!text) return replyText(sock, msg, 'Usage: !welcome set <message>, use {name} for the member.');
        group.welcomeMsg = text;
        saveGroup(jid, group);
        return replyText(sock, msg, `Welcome message set:\n\n${text}`);
      }
      return replyText(sock, msg, 'Usage: !welcome on | off | set <message>');
    },
  },
  {
    name: 'warn',
    aliases: ['vwarn'],
    group: true,
    admin: true,
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const sender = await targetSender(ctx);
      if (!sender) return replyText(sock, msg, 'Reply to a message or mention the user to warn.');
      const key = `${jid}:${getCleanUserNumber(sender)}`;
      const warns = addWarn(key);
      if (warns >= config.maxWarns) {
        setWarns(key, 0);
        try {
          const r = await kickBannedEverywhere(sock, [getCleanUserNumber(sender)]);
          return replyText(sock, msg, `⚠️ Warning limit reached. ${getCleanUserNumber(sender)} removed from ${r.kicked} group(s).`);
        } catch {
          return replyText(sock, msg, `⚠️ Warning limit reached but I could not kick the user.`);
        }
      }
      return replyText(sock, msg, `⚠️ ${getCleanUserNumber(sender)} warned (${warns}/${config.maxWarns}).`);
    },
  },
  {
    name: 'warns',
    group: true,
    admin: true,
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const sender = await targetSender(ctx);
      if (!sender) return replyText(sock, msg, 'Mention the user to check warns.');
      const key = `${jid}:${getCleanUserNumber(sender)}`;
      return replyText(sock, msg, `${getCleanUserNumber(sender)} has ${getWarns(key)}/${config.maxWarns} warns.`);
    },
  },
  {
    name: 'resetwarns',
    aliases: ['clearwarns'],
    group: true,
    admin: true,
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const sender = await targetSender(ctx);
      if (!sender) return replyText(sock, msg, 'Mention the user to clear warns.');
      resetWarns(`${jid}:${getCleanUserNumber(sender)}`);
      return replyText(sock, msg, `Cleared warns for ${getCleanUserNumber(sender)}.`);
    },
  },
  {
    name: 'unwarn',
    aliases: ['removewarn', 'uwn'],
    group: true,
    admin: true,
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const sender = await targetSender(ctx);
      if (!sender) return replyText(sock, msg, 'Reply to a message or mention the user to unwarn.');
      const key = `${jid}:${getCleanUserNumber(sender)}`;
      const current = getWarns(key);
      const all = (args[0] || '').toLowerCase() === 'all' || (args[0] || '').toLowerCase() === '-a';
      if (all) {
        resetWarns(key);
        return replyText(sock, msg, `Cleared all warns for ${getCleanUserNumber(sender)}.`);
      }
      if (current <= 0) return replyText(sock, msg, `${getCleanUserNumber(sender)} has no warns.`);
      setWarns(key, current - 1);
      return replyText(sock, msg, `✓ Removed 1 warn from ${getCleanUserNumber(sender)} (${current - 1}/${config.maxWarns}).`);
    },
  },
];
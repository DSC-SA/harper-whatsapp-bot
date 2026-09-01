import { replyText, getMessageBody, isOwner, getMentionedJids, getCleanUserNumber, parseNumbers } from '../helpers.js';
import { config } from '../../config.js';
import { getGroup, saveGroup, getFlood, pushFlood, resetFlood } from '../state.js';
import { applyPolicy } from './policies.js';

const ACTION_DELAY = 4000;

export function handleSpam(ctx) {
  const { sock, jid, group, sender, isGroup } = ctx;
  if (!isGroup || !group || group.antispam !== 'on' || isOwner(sender)) return;

  const senderNum = getCleanUserNumber(sender);
  const allow = group.spamAllow || [];
  if (allow.includes(senderNum)) return;

  const now = Date.now();
  const windowMs = config.floodWindow * 1000;
  const recent = getFlood(jid, sender).filter((t) => now - t < windowMs);
  pushFlood(jid, sender, now);

  const msgsInWindow = recent.length + 1;
  if (msgsInWindow < config.floodLimit) return;

  resetFlood(jid, sender);
  setTimeout(() => {
    applyPolicy(sock, jid, sender, ctx.msg, 'spam', `flood ${msgsInWindow} msgs in ${config.floodWindow}s`);
  }, ACTION_DELAY);
}

export async function handleBadWord(ctx) {
  const { sock, msg, jid, group, sender, isGroup } = ctx;
  if (!isGroup || !group || group.antibad !== 'on' || isOwner(sender)) return;
  if (!group.badWords.length) return;

  const body = (getMessageBody(msg) || '').toLowerCase();
  const hit = group.badWords.find((w) => body.includes(w.toLowerCase()));
  if (!hit) return;

  try {
    await sock.sendMessage(jid, {
      delete: {
        remoteJid: jid,
        fromMe: false,
        participant: sender,
        id: msg.key.id,
      },
    });
  } catch {}

  applyPolicy(sock, jid, sender, msg, 'antibad', `bad word: ${hit}`);
}

export default [
  {
    name: 'antispam',
    aliases: ['spam'],
    group: true,
    admin: true,
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const sub = (args[0] || '').toLowerCase();
      const group = getGroup(jid);
      if (sub === 'on' || sub === 'enable') {
        group.antispam = 'on';
        saveGroup(jid, group);
        return replyText(sock, msg, `Anti-spam ON (${config.floodLimit} msgs / ${config.floodWindow}s → ${config.spamAction}).`);
      }
      if (sub === 'off' || sub === 'disable') {
        group.antispam = 'off';
        saveGroup(jid, group);
        return replyText(sock, msg, 'Anti-spam OFF.');
      }
      return replyText(sock, msg, 'Usage: !antispam on | off');
    },
  },
  {
    name: 'spamallow',
    aliases: ['spamallow'],
    group: true,
    admin: true,
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const group = getGroup(jid);
      const allow = Array.isArray(group.spamAllow) ? group.spamAllow : [];
      const sub = (args[0] || '').toLowerCase();

      if (sub === 'list') {
        return replyText(sock, msg, `Spam-allowed users: ${allow.length ? allow.map((n) => `@${n}`).join(', ') : 'none'}`);
      }
      if (sub === 'clear') {
        group.spamAllow = [];
        saveGroup(jid, group);
        return replyText(sock, msg, 'Spam allow-list cleared.');
      }

      const mentioned = getMentionedJids(msg).map(getCleanUserNumber).filter(Boolean);
      let targetNum = null;
      if (args[0] && sub !== 'remove' && sub !== 'del') {
        const nums = parseNumbers(args.join(' ')).map((n) => String(n).replace(/[^0-9]/g, '')).filter((n) => n.length);
        if (nums.length) targetNum = nums[0];
      }
      if (!targetNum && mentioned.length) targetNum = mentioned[0];

      if (!targetNum) {
        return replyText(
          sock,
          msg,
          `Usage: ${config.prefix}spamallow @user · ${config.prefix}spamallow <number> · ${config.prefix}spamallow remove @user · ${config.prefix}spamallow list · ${config.prefix}spamallow clear`
        );
      }

      const removing = sub === 'remove' || sub === 'del';
      if (removing) {
        const i = allow.indexOf(targetNum);
        if (i >= 0) allow.splice(i, 1);
        group.spamAllow = allow;
        saveGroup(jid, group);
        return replyText(sock, msg, `@${targetNum} is no longer spam-allowed.`);
      }
      if (!allow.includes(targetNum)) allow.push(targetNum);
      group.spamAllow = allow;
      saveGroup(jid, group);
      return replyText(sock, msg, `@${targetNum} can now spam / is exempt from anti-spam.`);
    },
  },
  {
    name: 'antibad',
    aliases: ['badword'],
    group: true,
    admin: true,
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const sub = (args[0] || '').toLowerCase();
      const group = getGroup(jid);
      if (sub === 'on' || sub === 'enable') {
        group.antibad = 'on';
        saveGroup(jid, group);
        return replyText(sock, msg, `Bad-word filter ON. ${group.badWords.length} word(s).`);
      }
      if (sub === 'off' || sub === 'disable') {
        group.antibad = 'off';
        saveGroup(jid, group);
        return replyText(sock, msg, 'Bad-word filter OFF.');
      }
      return replyText(sock, msg, 'Usage: !antibad on | off | list');
    },
  },
  {
    name: 'word',
    aliases: ['badwords'],
    group: true,
    admin: true,
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const group = getGroup(jid);
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'add') {
        const word = (args.slice(1).join(' ') || '').toLowerCase().trim();
        if (!word) return replyText(sock, msg, 'Usage: !word add <word>');
        if (!group.badWords.includes(word)) group.badWords.push(word);
        saveGroup(jid, group);
        return replyText(sock, msg, `Added bad word: ${word}`);
      }
      if (sub === 'remove' || sub === 'del') {
        const word = (args.slice(1).join(' ') || '').toLowerCase().trim();
        group.badWords = group.badWords.filter((w) => w !== word);
        saveGroup(jid, group);
        return replyText(sock, msg, `Removed word (if present): ${word}`);
      }
      return replyText(sock, msg, `Current bad words:\n${group.badWords.length ? group.badWords.join(', ') : '(none)'}\n\nUse: !word add <word> / remove <word>`);
    },
  },
];
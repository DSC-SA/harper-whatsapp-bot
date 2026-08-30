import { replyText, getMessageBody, isOwner } from '../helpers.js';
import { config } from '../../config.js';
import { getGroup, saveGroup, getFlood, pushFlood, resetFlood } from '../state.js';
import { applyPolicy } from './policies.js';

const ACTION_DELAY = 4000;

export function handleSpam(ctx) {
  const { sock, jid, group, sender, isGroup } = ctx;
  if (!isGroup || !group || group.antispam !== 'on' || isOwner(sender)) return;

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
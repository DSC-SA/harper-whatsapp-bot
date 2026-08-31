import { replyText, getMessageBody, isOwner } from '../helpers.js';
import { config } from '../../config.js';
import { getGroup, saveGroup } from '../state.js';
import { applyPolicy } from './policies.js';

const URL_RE = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|([a-z0-9-]+\.(com|net|org|io|co|me|info|xyz|site|online|club|live|gg|dev|app|link|click|top|vip|pro|store|biz|tv|buzz|cloud|tech|social)\b)/gi;

export async function handleAntilink(ctx) {
  const { sock, msg, jid, group, sender, isGroup } = ctx;
  if (!isGroup || !group || group.antilink !== 'on' || isOwner(sender)) return;

  const body = getMessageBody(msg) || '';
  if (!body) return;

  const found = body.match(URL_RE) || [];
  if (!found.length) return;

  const clean = found
    .map((u) => u.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*/, '').trim())
    .filter(Boolean);

  const blocked = clean.filter(
    (d) => !group.allowedLinks.some((a) => d === a || d.endsWith('.' + a))
  );
  if (!blocked.length) return;

  try {
    await sock.sendMessage(jid, {
      delete: {
        remoteJid: jid,
        fromMe: false,
        participant: msg.key.participant,
        id: msg.key.id,
      },
    });
  } catch (e) {
    console.log(`[harper] antilink delete failed: ${e.message}`);
  }

  await applyPolicy(sock, jid, sender, msg, 'antilink', blocked.join(', '));
}

export default [
  {
    name: 'antilink',
    aliases: ['al'],
    group: true,
    admin: true,
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const sub = (args[0] || '').toLowerCase();
      const group = getGroup(jid);
      if (sub === 'on' || sub === 'enable') {
        group.antilink = 'on';
        saveGroup(jid, group);
        return replyText(sock, msg, `Anti-link ON. Action: ${config.antilinkAction}.`);
      }
      if (sub === 'off' || sub === 'disable') {
        group.antilink = 'off';
        saveGroup(jid, group);
        return replyText(sock, msg, 'Anti-link OFF.');
      }
      return replyText(sock, msg, `Usage: ${config.prefix}antilink on | off`);
    },
  },
  {
    name: 'allowlink',
    aliases: ['whitelist', 'allow'],
    group: true,
    admin: true,
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const dl = cleanDomain(args[0]);
      if (!dl) return replyText(sock, msg, 'Usage: !allowlink <domain>');
      const group = getGroup(jid);
      if (!group.allowedLinks.includes(dl)) group.allowedLinks.push(dl);
      group.blockedLinks = group.blockedLinks.filter((d) => d !== dl);
      saveGroup(jid, group);
      return replyText(sock, msg, `Whitelisted: ${dl}`);
    },
  },
  {
    name: 'blocklink',
    aliases: ['blacklist', 'block'],
    group: true,
    admin: true,
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const dl = cleanDomain(args[0]);
      if (!dl) return replyText(sock, msg, 'Usage: !blocklink <domain>');
      const group = getGroup(jid);
      if (!group.blockedLinks.includes(dl)) group.blockedLinks.push(dl);
      group.allowedLinks = group.allowedLinks.filter((d) => d !== dl);
      saveGroup(jid, group);
      return replyText(sock, msg, `Blacklisted: ${dl}`);
    },
  },
];

function cleanDomain(v) {
  if (!v) return null;
  return String(v).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*/, '').trim();
}
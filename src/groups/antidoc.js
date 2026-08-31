import { replyText, getContent, isOwner, getMentionedJids, getCleanUserNumber, parseNumbers } from '../helpers.js';
import { config } from '../../config.js';
import { getGroup, saveGroup } from '../state.js';
import { applyPolicy } from './policies.js';

export async function handleAntidoc(ctx) {
  const { sock, msg, jid, group, sender, isGroup } = ctx;
  if (!isGroup || !group || group.antidoc !== 'on' || isOwner(sender)) return;

  const c = getContent(msg);
  if (!c || c.type !== 'documentMessage') return;

  const senderNum = getCleanUserNumber(sender);
  const wl = group.docWhitelist || [];
  if (wl.includes(senderNum)) return;

  try {
    await sock.sendMessage(jid, {
      delete: {
        remoteJid: jid,
        fromMe: false,
        participant: sender,
        id: msg.key.id,
      },
    });
  } catch (e) {
    console.log(`[harper] antidoc delete failed: ${e.message}`);
  }

  await applyPolicy(sock, jid, sender, msg, 'antidoc', 'document');
}

function ensureList(group) {
  if (!Array.isArray(group.docWhitelist)) group.docWhitelist = [];
  return group.docWhitelist;
}

export default [
  {
    name: 'antidoc',
    aliases: ['nodocs'],
    group: true,
    admin: true,
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const sub = (args[0] || '').toLowerCase();
      const group = getGroup(jid);
      if (sub === 'on' || sub === 'enable') {
        group.antidoc = 'on';
        saveGroup(jid, group);
        return replyText(sock, msg, 'Document blocker ON. Documents sent here will be removed.');
      }
      if (sub === 'off' || sub === 'disable') {
        group.antidoc = 'off';
        saveGroup(jid, group);
        return replyText(sock, msg, 'Document blocker OFF.');
      }
      return replyText(sock, msg, `Usage: ${config.prefix}antidoc on | off`);
    },
  },
  {
    name: 'whitelistdoc',
    aliases: ['docwl', 'allowdoc'],
    group: true,
    admin: true,
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const group = getGroup(jid);
      const wl = ensureList(group);
      const sub = (args[0] || '').toLowerCase();

      if (sub === 'list') {
        const names = wl.length ? wl.join(', ') : 'none';
        return replyText(sock, msg, `Document whitelist: ${names}`);
      }
      if (sub === 'clear') {
        group.docWhitelist = [];
        saveGroup(jid, group);
        return replyText(sock, msg, 'Document whitelist cleared.');
      }

      const mentioned = getMentionedJids(msg).map(getCleanUserNumber).filter(Boolean);
      let targetNum = null;

      if (args[0] && sub !== 'remove') {
        const nums = parseNumbers(args.join(' ')).map((n) => String(n).replace(/[^0-9]/g, '')).filter((n) => n.length);
        if (nums.length) targetNum = nums[0];
      }

      if (!targetNum && mentioned.length) targetNum = mentioned[0];

      if (!targetNum) {
        return replyText(
          sock,
          msg,
          `Usage: ${config.prefix}whitelistdoc @user · ${config.prefix}whitelistdoc 27680000000 · ${config.prefix}whitelistdoc remove @user`
        );
      }

      commitWl(group, wl, targetNum, sub !== 'remove');
      saveGroup(jid, group);
      return replyText(sock, msg, sub === 'remove'
        ? `Removed @${targetNum} from the document whitelist.`
        : `@${targetNum} can now send documents.`);
    },
  },
];

function commitWl(group, wl, num, add) {
  if (add) {
    if (!wl.includes(num)) wl.push(num);
  } else {
    const i = wl.indexOf(num);
    if (i >= 0) wl.splice(i, 1);
  }
  group.docWhitelist = wl;
}

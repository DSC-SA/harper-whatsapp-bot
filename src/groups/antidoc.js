import { extractMessageContent } from '@whiskeysockets/baileys';
import { replyText, getContent, isOwner } from '../helpers.js';
import { config } from '../../config.js';
import { getGroup, saveGroup } from '../state.js';

export async function handleAntidoc(ctx) {
  const { sock, msg, jid, group, sender, isGroup } = ctx;
  if (!isGroup || !group || group.antidoc !== 'on' || isOwner(sender)) return;

  const inner = extractMessageContent(getContent(msg));
  if (!inner?.documentMessage) return;

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
        return replyText(sock, msg, `Document blocker ON. Documents sent here will be removed.`);
      }
      if (sub === 'off' || sub === 'disable') {
        group.antidoc = 'off';
        saveGroup(jid, group);
        return replyText(sock, msg, 'Document blocker OFF.');
      }
      return replyText(sock, msg, `Usage: ${config.prefix}antidoc on | off`);
    },
  },
];
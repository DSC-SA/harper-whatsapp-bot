import { config } from '../../config.js';
import { replyText } from '../helpers.js';
import { fetchAllGroups } from '../groupCache.js';

export default [
  {
    name: 'chant',
    aliases: ['shoutout', 'broadcast', 'bc'],
    owner: true,
    desc: 'Send a message to every group the bot is in.',
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;

      let text = ctx.argsText || '';
      let targetId = null;

      const gIdx = args.findIndex((a) => a === '--group' || a === '-g');
      if (gIdx >= 0) {
        targetId = args[gIdx + 1];
        text = args.slice(0, gIdx).join(' ').trim();
      }

      text = text.trim();
      if (!text) {
        return replyText(sock, msg, `Usage: ${config.prefix}chant <message>\n${config.prefix}chant <message> --group <gid> (single group only)`);
      }

      const footer = `\n—— ${config.watermark}`;
      const body = `${text}${footer}`;

      if (targetId) {
        try {
          await sock.sendMessage(targetId, { text: body });
          return replyText(sock, msg, `Sent to 1 group.`);
        } catch (e) {
          return replyText(sock, msg, `Failed to send to that group: ${e.message}`);
        }
      }

      let groups = {};
      try {
        groups = await fetchAllGroups(sock);
      } catch (e) {
        return replyText(sock, msg, `Could not fetch groups: ${e.message}`);
      }
      const ids = Object.keys(groups || {});

      if (!ids.length) return replyText(sock, msg, 'The bot is not in any groups.');

      const reply = [];
      reply.push(replyText(sock, msg, `⚡ Broadcasting to ${ids.length} group(s)...`));

      let sent = 0;
      let failed = 0;
      for (const id of ids) {
        try {
          await sock.sendMessage(id, { text: body });
          sent++;
        } catch (e) {
          failed++;
          console.log(`[chant] failed ${id}: ${e.message}`);
        }
        if (sent % 20 === 0) await new Promise((r) => setTimeout(r, 2000));
      }

      await replyText(sock, msg, `Done. Sent to ${sent} group(s)${failed ? `, ${failed} failed.` : '.'}`);
    },
  },
];

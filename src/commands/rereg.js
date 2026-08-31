import { config } from '../../config.js';
import { getCleanUserNumber } from '../helpers.js';
import { getGroupMetadata, getAllGroupIds, fetchAllGroups } from '../groupCache.js';
import { resolveUserJid, recordGroupMappings, resolveGroupUser } from '../lidmap.js';
import { markInvited } from '../mlbb/joinInvite.js';

const WELCOME_TEXT = (prefix) =>
  `👋 *Welcome to the community!*\n\nWe're glad to have you in DawnSphereCommunity.\n\nWould you like to register with us? If yes, please reply with:\n\n*${prefix}yes*`;

export default [
  {
    name: 'rereg',
    aliases: ['reprompt', 'reinvite'],
    owner: true,
    desc: 'Scan all community groups and re-send the welcome/registration prompt to every member.',
    run: async (ctx, args) => {
      const { sock, jid } = ctx;
      const prefix = config.prefix;

      const ack = args?.[0] ? String(args[0]).toLowerCase() : '';
      const onlyGroups = config.mlbbRegGroups.filter(Boolean);

      let groups = [];
      try {
        const all = await fetchAllGroups(sock);
        groups = Object.values(all).map((g) => g.id);
      } catch (e) {
        groups = onlyGroups;
      }

      if (onlyGroups.length) {
        groups = groups.filter((id) => onlyGroups.includes(id));
      }
      if (!groups.length && onlyGroups.length) groups = onlyGroups;

      if (!groups.length) {
        await sock.sendMessage(jid, { text: 'No community/MLBB groups configured. Set MLBB_REG_GROUP.' });
        return;
      }

      await sock.sendMessage(jid, { text: `Scanning ${groups.length} group(s) for members...` });

      const users = new Map();
      for (const gid of groups) {
        try {
          await recordGroupMappings(sock, gid);
          const meta = await getGroupMetadata(sock, gid);
          for (const p of meta?.participants || []) {
            const pid = p.id || '';
            const resolved = await resolveGroupUser(sock, gid, pid);
            const jidT = resolveUserJid(resolved) || pid;
            const num = getCleanUserNumber(jidT);
            if (!num) continue;
            const botNum = getCleanUserNumber(sock.user?.id);
            if (getCleanUserNumber(pid) === botNum || num === botNum) continue;
            if (config.owner.some((o) => getCleanUserNumber(o) === num)) continue;
            if (!users.has(num)) users.set(num, { jid: jidT, group: gid });
          }
        } catch (e) {
          console.log(`[rereg] group ${gid} failed: ${e.message}`);
        }
      }

      if (!users.size) {
        await sock.sendMessage(jid, { text: 'No members found to re-invite.' });
        return;
      }

      const announce = ack === 'silent' ? 0 : 1;

      await sock.sendMessage(jid, {
        text: `Sending the registration prompt to *${users.size}* member(s)${onlyGroups.length ? '' : '...'}`,
      });

      const text = WELCOME_TEXT(prefix);
      let sent = 0;
      let failed = 0;
      for (const [num, u] of users) {
        try {
          const target = u.jid || `${num}@s.whatsapp.net`;
          await sock.sendMessage(target, { text });
          markInvited(num, u.group);
          sent++;
        } catch (e) {
          failed++;
          console.log(`[rereg] DM failed for ${u.jid}: ${e.message}`);
        }
        if (sent % 30 === 0) await new Promise((r) => setTimeout(r, 1500));
      }

      let reply = `Done. Re-invited *${sent}* member(s)${failed ? `, *${failed}* failed.` : '.'}`;
      if (announce) reply += `\n\nThey can reply with *${prefix}yes* to start MLBB registration.`;
      await sock.sendMessage(jid, { text: reply });
    },
  },
];

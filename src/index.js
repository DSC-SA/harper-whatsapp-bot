import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');
process.env.TZ = 'Africa/Johannesburg';
import { config } from '../config.js';
import { initState, getGroup } from './state.js';
import { startServer, startKeepAlive } from './server.js';
import { startClient } from './client.js';
import { handleMessage } from './handler.js';
import { startAutoMutes } from './groups/automute.js';
import { isGroupJid, getCleanUserNumber } from './helpers.js';
import { recordLidMapping, loadLidMap, resolveUserJid } from './lidmap.js';
import { markInvited } from './mlbb/joinInvite.js';
import { startBanScanner, kickBannedJoiner } from './groups/bans.js';
import { loadAdmins, refreshGroupAdmins, startAdminRefresh } from './admins.js';
import { startDataSync } from './filesync.js';
import { fetchAllGroups } from './groupCache.js';
import { sendRichWelcome } from './welcome.js';
import { startWelcomeScanner, markWelcomeSeen } from './groups/welcomeScanner.js';
import { startSupervisor, registerTask, beat } from './tasks.js';

const SKIP_CODES = /EOF|EPIPE|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|SOCKET|EAI_AGAIN/i;
process.on('uncaughtException', (err) => {
  console.log(`[harper] uncaughtException: ${err?.code || ''} ${err?.syscall || ''} ${err?.message || err}`);
  if (!SKIP_CODES.test(`${err?.code || ''} ${err?.syscall || ''} ${err?.message || ''}`)) process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.log(`[harper] unhandledRejection: ${reason?.message || reason}`);
  if (reason?.stack) console.log(reason.stack);
});

async function main() {
  await startDataSync();
  await initState();
  loadAdmins();
  console.log(`[harper] owner list: ${config.owner.join(', ') || '(none)'}`);

  startServer();
  startKeepAlive();
  startSupervisor();

  await startClient({
    onMessage: (sock, msg) => handleMessage(sock, msg),

    onParticipants: async (sock, update) => {
      const jid = update.id;
      if (!isGroupJid(jid)) return;
      const group = getGroup(jid);
      const action = update.action;
      console.log(`[harper] gp update: action=${action} group=${jid} members=${update.participants?.length || 0}`);
      try {
        refreshGroupAdmins(sock, jid);
        if (action === 'add') {
          kickBannedJoiner(sock, update);
        }
        if (action === 'add') {
          const botNum = getCleanUserNumber(sock.user?.id);
          for (const p of update.participants || []) {
            if (getCleanUserNumber(resolveUserJid(p) || p) === botNum) {
              console.log(`[harper] added to a new group: ${jid}`);
            }
          }
        }
        if (action === 'add' && config.mlbbRegGroups.includes(jid)) {
          let meta = null;
          try {
            const { getGroupMetadata } = await import('./groupCache.js');
            meta = await getGroupMetadata(sock, jid);
          } catch {}
          for (const p of update.participants || []) {
            const whoRaw = String(p || '');
            const who = resolveUserJid(whoRaw) || whoRaw;
            const whoNum = getCleanUserNumber(who);
            if (whoNum === getCleanUserNumber(sock.user?.id)) continue;
            if (who === getCleanUserNumber(config.owner[0])) continue;
            let target = who;
            const entry = (meta?.participants || []).find(
              (m) => String(m.id) === whoRaw || String(m.lid || '') === whoRaw
            );
            if (entry?.jid) target = entry.jid;
            else if (entry && !String(entry.id).endsWith('@lid')) target = entry.id;
            const text = `👋 *Welcome to the community!*\n\nWe're glad to have you in DawnSphereCommunity.\n\nWould you like to register with us? If yes, please reply with:\n\n*${config.prefix}yes*`;
            try {
              await sock.sendMessage(target, { text });
              markInvited(getCleanUserNumber(target), jid);
              console.log(`[harper] welcome DM sent to ${target} (joined ${jid})`);
            } catch (e) {
              console.log(`[harper] join DM failed for ${target}: ${e.message}`);
            }
          }
        }
        if (action === 'add' && group.welcome === 'on') {
          let meta = null;
          try {
            const { getGroupMetadata } = await import('./groupCache.js');
            meta = await getGroupMetadata(sock, jid, { fresh: true });
          } catch {}
          await sendRichWelcome(sock, jid, update.participants || [], meta);
          markWelcomeSeen(jid, (update.participants || []).map((p) => getCleanUserNumber(resolveUserJid(p) || p)));
        } else if (action === 'remove' && group.goodbye === 'on') {
          await sock.sendMessage(jid, { text: 'A member has left the group.' });
        }
      } catch (e) {
        console.log(`[harper] welcome handler error: ${e.message}`);
      }
    },

    onConnected: (sock) => {
      startAutoMutes(sock);
      warmLidMap(sock);
      startBanScanner(sock);
      startAdminRefresh(sock);
      startWelcomeScanner(sock);
      registerTask({
        id: 'lidmap',
        name: 'lid->phone map warm',
        expected: 0,
        start: () => warmLidMap(sock),
      });
      beat('lidmap');
    },
  });

  console.log(`[harper] ${config.botName} is running. Prefix: "${config.prefix}"`);
}

async function warmLidMap(sock) {
  try {
    const groups = await fetchAllGroups(sock);
    for (const g of Object.values(groups)) {
      for (const p of g.participants || []) {
        const lid = p.lid || (String(p.id || '').endsWith('@lid') ? p.id : null);
        const pn = p.jid || (p.id && !String(p.id).endsWith('@lid') ? p.id : null);
        if (lid && pn) recordLidMapping(lid, pn);
      }
    }
    console.log(`[harper] lid map warmed: ${Object.keys(loadLidMap().lidToPn).length} known lids`);
  } catch (e) {
    console.log(`[harper] lid map warm failed: ${e.message}`);
  }
}

main().catch((e) => {
  console.error('[harper] fatal error:', e);
  process.exit(1);
});
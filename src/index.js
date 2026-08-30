import { config } from '../config.js';
import { initState, getGroup } from './state.js';
import { startServer, startKeepAlive } from './server.js';
import { startClient } from './client.js';
import { handleMessage } from './handler.js';
import { startAutoMutes } from './groups/automute.js';
import { isGroupJid } from './helpers.js';

async function main() {
  await initState();

  startServer();
  startKeepAlive();

  await startClient({
    onMessage: (sock, msg) => handleMessage(sock, msg),

    onParticipants: async (sock, update) => {
      const jid = update.id;
      if (!isGroupJid(jid)) return;
      const group = getGroup(jid);
      const action = update.action;
      try {
        if (action === 'add' && group.welcome === 'on') {
          const text = (group.welcomeMsg || 'Welcome to the group! {name}')
            .replace(/\{name\}/g, 'everyone');
          await sock.sendMessage(jid, { text, mentions: update.participants });
        } else if (action === 'remove' && group.goodbye === 'on') {
          await sock.sendMessage(jid, { text: 'A member has left the group.' });
        }
      } catch (e) {
        console.log(`[harper] welcome handler error: ${e.message}`);
      }
    },

    onConnected: (sock) => {
      startAutoMutes(sock);
    },
  });

  console.log(`[harper] ${config.botName} is running. Prefix: "${config.prefix}"`);
}

main().catch((e) => {
  console.error('[harper] fatal error:', e);
  process.exit(1);
});
import os from 'os';
import { config } from '../../config.js';
import { formatMs } from '../helpers.js';

export default [
  {
    name: 'ping',
    aliases: ['p'],
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const start = Date.now();
      await sock.sendMessage(jid, { text: 'Pong!' }, { quoted: msg });
      return sock.sendMessage(jid, { text: `Latency: ${Date.now() - start}ms` }, { quoted: msg });
    },
  },
  {
    name: 'alive',
    aliases: ['status'],
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const mem = process.memoryUsage();
      const text = [
        `*${config.botName}* is alive ✨`,
        ``,
        `Uptime: ${formatMs(process.uptime() * 1000)}`,
        `Node:   ${process.version}`,
        `RAM:    ${(mem.rss / 1024 / 1024).toFixed(1)} MB`,
        `Host:   ${os.hostname()}`,
      ].join('\n');
      return sock.sendMessage(jid, { text }, { quoted: msg });
    },
  },
];
import { replyText } from '../helpers.js';
import { getSessionString } from '../session.js';
import { config } from '../../config.js';

export default [
  {
    name: 'mysession',
    aliases: ['session'],
    owner: true,
    run: async (ctx, args) => {
      const { sock, msg } = ctx;
      const s = getSessionString();
      if (!s) return replyText(sock, msg, 'Session string is empty yet. Retry after pairing.');
      const chunk = 64000;
      await replyText(sock, msg, '*Here is your SESSION_ID:*');
      for (let i = 0; i < s.length; i += chunk) {
        await sock.sendMessage(ctx.jid, { text: s.slice(i, i + chunk) }, { quoted: msg });
      }
      await sock.sendMessage(ctx.jid, { text: '*End of session.* Paste it in your SESSION_ID env var.' });
    },
  },
  {
    name: 'pair',
    owner: true,
    run: async (ctx, args) => {
      const { sock, msg } = ctx;
      const number = String(args[0] || '').replace(/[^0-9]/g, '');
      if (number.length < 10) return replyText(sock, msg, 'Usage: !pair <number>\nExample: !pair 919876543210');
      try {
        await replyText(sock, msg, `Requesting pairing code for ${number}...`);
        const code = await sock.requestPairingCode(number);
        return replyText(sock, msg, `Pairing code: *${code?.match?.(/.{1,4}/g)?.join('-') || code}*\nOn your phone: WhatsApp → Link a Device → Link with phone number instead.`);
      } catch (e) {
        return replyText(sock, msg, `Pairing failed: ${e.message}`);
      }
    },
  },
];
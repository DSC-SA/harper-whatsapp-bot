import { replyText } from '../helpers.js';
import { getSessionString, resetSignalSessions } from '../session.js';
import { getVars, setVar } from '../vars.js';
import { config } from '../../config.js';
import { recordLidMapping } from '../lidmap.js';
import { fetchAllGroups, getGroupMetadata } from '../groupCache.js';
import { getRepair } from '../repair.js';

const ALLOWED_VARS = new Set([
  'PREFIX',
  'BOT_NAME',
  'OWNER',
  'SUDO',
  'STICKER_PACK',
  'STICKER_AUTHOR',
  'WATERMARK',
  'HARPER_APP_URL',
  'PUBLIC_URL',
  'KEEP_ALIVE_MIN',
  'DEFAULT_ANTILINK',
  'ANTILINK_ACTION',
  'FLOOD_LIMIT',
  'FLOOD_WINDOW',
  'SPAM_ACTION',
  'SPAM_MUTE_MIN',
  'MAX_WARNS',
  'WARN_MUTE_MIN',
  'MLBB_REG_GROUP',
  'PORT',
]);

export default [
  {
    name: 'setvar',
    aliases: ['var', 'env'],
    owner: true,
    run: async (ctx, args) => {
      const { sock, msg } = ctx;
      const arg = String(args[0] || '').trim().replace(/^=+/, '');
      const list = getVars();

      if (!arg) {
        const entries = Object.entries(list);
        const text = entries.length
          ? `*Current vars:*\n${entries.map(([k, v]) => `_${k}_ = \`${v}\``).join('\n')}`
          : 'No custom vars yet. Usage: `setvar KEY=VALUE` (e.g. `setvar SUDO=<number>`)';
        return replyText(sock, msg, text);
      }

      const idx = arg.indexOf('=');
      if (idx < 1) return replyText(sock, msg, 'Usage: `setvar KEY=VALUE`\nExample: `setvar SUDO=27812345678`\nUse `setvar KEY=` to reset a var.');
      const key = arg.slice(0, idx).trim().toUpperCase();
      const value = arg.slice(idx + 1).trim();

      if (!ALLOWED_VARS.has(key)) {
        return replyText(sock, msg, `Unknown or protected var *${key}*.\nAllowed: ${[...ALLOWED_VARS].join(', ')}`);
      }

      setVar(key, value);

      const applied = value === '' ? `*${key}* reset to default.` : `*${key}* = \`${value}\``;
      const note = key === 'PORT' || key === 'HARPER_APP_URL'
        ? 'Takes effect after restart.'
        : ['PREFIX', 'SUDO', 'OWNER', 'WATERMARK', 'STICKER_PACK', 'STICKER_AUTHOR', 'BOT_NAME'].includes(key)
          ? 'Applied immediately.'
          : 'Effected from the next check.';
      const hint = key === 'SUDO' ? ' (works as owner now)' : '';
      return replyText(sock, msg, `Done. ${applied}${note ? ` ${note}` : ''}${hint}`);
    },
  },
  {
    name: 'mysession',
    aliases: ['session'],
    owner: true,
    run: async (ctx, args) => {
      const { sock, msg } = ctx;
      const s = getSessionString();
      if (!s) return replyText(sock, msg, 'Session string is empty yet. Retry after pairing.');
      const buffer = Buffer.from(s, 'utf8');
      await sock.sendMessage(
        ctx.jid,
        {
          document: buffer,
          fileName: 'harper-session.txt',
          mimetype: 'text/plain',
          caption: 'SESSION_ID — paste the whole file content into the SESSION_ID env var on Koyeb.',
        },
        { quoted: msg }
      );
      return replyText(sock, msg, `Sent as a text file. Copy its full contents into the *SESSION_ID* Koyeb env var (no quotes, keep everything).`);
    },
  },
  {
    name: 'pair',
    owner: true,
    run: async (ctx, args) => {
      const { sock, msg } = ctx;
      const a0 = String(args[0] || '').toLowerCase();
      const number = String(args[0] || '').replace(/[^0-9]/g, '');

      // /pair qr  -> force a fresh QR re-link (surfaces on the web page/console)
      if (a0 === 'qr' || a0 === 'fresh' || a0 === 'scan') {
        const rep = getRepair();
        if (!rep) return replyText(sock, msg, 'Repair bridge not ready yet. Try again in a few seconds.');
        const appUrl = config.appUrl || '(not set - use Koyeb console)';
        await replyText(
          sock,
          msg,
          `*Fresh QR re-link*\n\nI'm about to disconnect and show a brand-new QR.\n\n⚠️ Once I unlink, I can't message here - open this page on your phone browser instead:\n${appUrl}\n\nScan the QR there with the bot phone (Link a Device).\nI'll save the new session automatically once you scan.`
        );
        const ok = rep();
        if (!ok) return replyText(sock, msg, 'A fresh re-pair is already in progress, or I could not disconnect right now.');
        return;
      }

      if (number.length < 10) {
        return replyText(
          sock,
          msg,
          `*Pairing*\n\n• ${config.prefix}pair <number> — get an 8-digit pairing code (bot stays online, type the code into the bot phone).\n• ${config.prefix}pair qr — force a fresh QR re-link (bot briefly disconnects; QR shows on the web page/Koyeb console).`
        );
      }
      try {
        await replyText(sock, msg, `Requesting pairing code for ${number}...`);
        const code = await sock.requestPairingCode(number);
        return replyText(sock, msg, `Pairing code: *${code?.match?.(/.{1,4}/g)?.join('-') || code}*\nOn your phone: WhatsApp → Link a Device → Link with phone number instead.`);
      } catch (e) {
        return replyText(sock, msg, `Pairing failed: ${e.message}`);
      }
    },
  },
{
    name: 'resetsessions',
    aliases: ['resetkeys'],
    owner: true,
    run: async (ctx, args) => {
      const { sock, msg } = ctx;
      try {
        const { removed, credsPreserved } = await resetSignalSessions();
        const counts = Object.entries(removed).map(([k, v]) => `${k}: ${v}`).join(', ');
        return replyText(sock, msg, `Signal sessions cleared (${counts}). Login kept (${credsPreserved}). Sessions rebuild automatically on next messages. Recommend restart.`);
      } catch (e) {
        return replyText(sock, msg, `Failed to reset sessions: ${e.message}`);
      }
    },
  },
{
    name: 'groups',
    owner: true,
    run: async (ctx, args) => {
      const { sock, msg } = ctx;
      try {
        const groups = await fetchAllGroups(sock);
        for (const g of Object.values(groups)) {
          for (const p of g.participants || []) {
            const lid = p.lid || (String(p.id || '').endsWith('@lid') ? p.id : null);
            const pn = p.jid || (p.id && !String(p.id).endsWith('@lid') ? p.id : null);
            if (lid && pn) recordLidMapping(lid, pn);
          }
        }
        const entries = Object.entries(groups)
          .map(([jid, g]) => `${jid}\t${g.subject || '(no name)'}\t${g.participants?.length ?? 0} members`)
          .sort();
        const text = entries.length ? entries.map((l) => l.split('\t').join(' | ')).join('\n') : 'Not in any group.';
        const { mkdirSync, writeFileSync } = await import('node:fs');
        mkdirSync('data', { recursive: true });
        writeFileSync('data/groups.txt', entries.join('\n'), 'utf8');
        return replyText(sock, msg, `*Groups (${entries.length})*\n${text}`);
      } catch (e) {
        return replyText(sock, msg, `Failed to fetch groups: ${e.message}`);
      }
    },
  },
{
    name: 'reboot',
    aliases: ['restart'],
    owner: true,
    run: async (ctx) => {
      const { sock, msg } = ctx;
      await replyText(sock, msg, 'Rebooting Harper...');
      setTimeout(() => process.exit(0), 1200);
    },
  },
];
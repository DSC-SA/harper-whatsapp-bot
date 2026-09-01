import os from 'os';
import { readFileSync } from 'node:fs';
import { config } from '../../config.js';
import { formatMs } from '../helpers.js';

const P = () => config.prefix;
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

const STYLES = ['group', 'protection', 'media', 'mlbb', 'utils'];
const CATS = {
  group: ['kick', 'add', 'promote', 'demote', 'mute', 'unmute', 'warn', 'warns', 'unwarn', 'resetwarns', 'welcome', 'automute', 'amute', 'aunmute'],
  protection: ['antilink', 'whitelist', 'blocklink', 'antispam', 'antibad', 'word', 'antidoc', 'whitelistdoc'],
  media: ['sticker', 'attp', 'toimg', 'stickerinfo', 'vv'],
  mlbb: ['mlbbreg', 'mlbbpf', 'yes'],
  utils: ['ping', 'alive', 'afk', 'menu', 'help', 'pair', 'rereg', 'chant'],
};

function mdTime(d) {
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${String(h).padStart(2, '0')}:${m} ${ap}`;
}
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
const pad = (n) => String(n).padStart(2, '0');

function instanceBox(name, lines) {
  const width = Math.max(`${name} ${config.botName}`.length, ...lines.map((l) => l.length)) + 4;
  const bar = '═'.repeat(width);
  const out = [`╭═══ ${name} ${config.botName} ═══⊷`];
  for (const l of lines) out.push(`┃❃│ ${l}`);
  out.push(`┃❃╰${'─'.repeat(width)}`);
  out.push(`╰${bar}⊷`);
  return out.join('\n');
}

function sectionBox(title, items) {
  const head = `╭─❏ ${title} ❏`;
  const lines = items.map((it) => ` │ ${it}`);
  lines.push(` ╰${'─'.repeat(17)}`);
  return [head, ...lines].join('\n');
}

export default [
  {
    name: 'menu',
    aliases: ['help', 'h'],
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const topic = (args[0] || '').toLowerCase();
      if (HELP[topic]) return sock.sendMessage(jid, { text: HELP[topic] }, { quoted: msg });

      const now = new Date();
      const mem = process.memoryUsage();
      const up = process.uptime();
      const sender = ctx.sender || '';
      const num = String(sender).replace(/:[0-9]+/, '').split('@')[0];
      const username = num || 'Guest';

      const head = instanceBox('═════', [
        `Prefix : ${config.prefix}`,
        `User : ${username}`,
        `Time : ${mdTime(now)}`,
        `Day : ${DAYS[now.getDay()]}`,
        `Date : ${pad(now.getDate())}/${MONTHS[now.getMonth()]}/${now.getFullYear()}`,
        `Version : ${pkg.version}`,
        `Ram : ${(mem.rss / 1024 / 1024).toFixed(0)}MB`,
        `Uptime : ${formatMs(up * 1000)}`,
        `Platform : ${process.platform} (${os.type()})`,
      ]);

      const menu = buildMenu();
      const tail = `${P()}help <command> for details.`;

      return sock.sendMessage(jid, { text: `${head}\n\n${menu}\n${tail}` }, { quoted: msg });
    },
  },
];

const TITLES = { group: 'group', protection: 'protection', media: 'media', mlbb: 'mlbb', utils: 'utils' };

function buildMenu() {
  const blocks = [];
  for (const key of STYLES) {
    const items = CATS[key].map((c) => c.toUpperCase());
    blocks.push(sectionBox(TITLES[key], items));
  }
  return blocks.join('\n\n');
}

const HELP = {
  sticker: `*${P()}sticker* — reply to an image, video or GIF → 512×512 WebP sticker with the ${config.watermark} watermark.
Usage: ${P()}sticker`,
  attp: `*${P()}attp <text>* — colored text sticker. Keep it short.
Usage: ${P()}attp DawnSphere`,
  toimg: `*${P()}toimg* — reply to a sticker to convert it back to an image.`,
  stickerinfo: `*${P()}stickerinfo* — reply to a sticker to see its pack info.`,
  vv: `*${P()}vv* — reply to a *view-once* photo/video to reveal (re-send) it. Works in groups and DMs.`,
  whitelist: `*${P()}whitelist <url|domain>* — allows a domain so anti-link won't block it.
Usage: ${P()}whitelist https://google.com - ${P()}whitelist google.com`,
  allowlink: `*${P()}whitelist <url|domain>* — allows a domain so anti-link won't block it.
Usage: ${P()}whitelist https://google.com`,
  kick: `*${P()}kick* — removes members. Mention them or list numbers.
Usage: ${P()}kick @user`,
  add: `*${P()}add <number[,number]>* — adds members by number.
Usage: ${P()}add 919876543210,919876543211`,
  promote: `*${P()}promote @user* — makes a member an admin.`,
  demote: `*${P()}demote @user* — removes admin rights.`,
  mute: `*${P()}mute* — locks the group so only admins can chat.`,
  unmute: `*${P()}unmute* — reopens the group.`,
  welcome: `*${P()}welcome on|off* — welcome/goodbye notices.
When on, new members get a warm welcome with their profile pic, @mention, and the group name.
Usage: ${P()}welcome on`,
  warn: `*${P()}warn @user|reply* — adds a warning; after MAX_WARNS the user is kicked globally.
*${P()}warns @user* — show count. *${P()}unwarn @user* — remove 1 warn.
*${P()}resetwarns @user* — clear all.`,
  warns: `*${P()}warns @user* — shows a user's warn count.`,
  unwarn: `*${P()}unwarn @user* — removes 1 warning.
*${P()}unwarn all @user* — clears all warnings.`,
  resetwarns: `*${P()}resetwarns @user* — clears all warnings for a user.`,
  automute: `*${P()}automute on <start HH:MM> <end HH:MM>* — daily mute window. Survives restarts.
Usage: ${P()}automute on 22:00 07:00 - ${P()}automute off`,
  amute: `*${P()}amute <time>* — auto-mute ON at a time. Usage: ${P()}amute 18:00`,
  aunmute: `*${P()}aunmute <time>* — auto-unmute at a time. Usage: ${P()}aunmute 06:00`,
  antilink: `*${P()}antilink on|off* — blocks links per ANTILINK_ACTION (warn/kick/mute).
*${P()}whitelist <domain>* — allow a domain. *${P()}blocklink <domain>* — blacklist.
Usage: ${P()}antilink on`,
  antispam: `*${P()}antispam on|off* — flood guard: N msgs in T seconds triggers SPAM_ACTION.
Usage: ${P()}antispam on`,
  antibad: `*${P()}antibad on|off* — reacts to bad words.
*${P()}word add <word>* / *${P()}word remove <word>* — manage the list.`,
  word: `*${P()}word add <word>|remove <word>|list* — manage the bad-word list.`,
  antidoc: `*${P()}antidoc on|off* — deletes documents sent in the group (except whitelisted users).
Usage: ${P()}antidoc on`,
  whitelistdoc: `*${P()}whitelistdoc @user|number* — allows that user to send docs.
*${P()}whitelistdoc remove @user* — revoke it. *${P()}whitelistdoc list|clear* — manage the list.
Usage: ${P()}whitelistdoc @user`,
  blocklink: `*${P()}blocklink <domain>* — blacklists a domain.`,
  mlbbreg: `*${P()}mlbbreg* — starts MLBB registration (DM only). You'll give a Role ID, Zone ID and a verification code from your in-game mail.`,
  mlbbpf: `*${P()}mlbbpf* — generates your MLBB profile card with current stats.`,
  yes: `*${P()}yes* — accept the welcome/registration invite and start MLBB registration (DM).`,
  afk: `*${P()}afk [reason]* — marks you away; Harper notifies anyone who mentions you. Send any message to clear.`,
  ping: `*${P()}ping* — latency check. Access level is changeable with ${P()}zushi/tushi/ope.`,
  alive: `*${P()}alive* — bot status + uptime.`,
  menu: `*${P()}menu* — shows the full command menu. *${P()}help <command>* — details for one command.`,
  pair: `*${P()}pair <number>* — DM only. Requests a pairing code for a phone number.`,
  rereg: `*${P()}rereg [silent]* — scans the community groups and re-sends the welcome/registration prompt to every member (so they can reply *${P()}yes* to register).
Add *silent* to skip the progress messages.
Usage: ${P()}rereg`,
  chant: `*${P()}chant <message>* — broadcasts a message to every group the bot is in (owner only).
Use *${P()}chant <message> --group <gid>* to send to a single group.
Usage: ${P()}chant Shoutout to the community!`,
  setvar: `*${P()}setvar KEY=value* — sets a config var at runtime, instantly, and persists it.
Aliases: ${P()}setvar=KEY=value - ${P()}var - ${P()}env
Usage: ${P()}setvar SUDO=27812345678 - ${P()}setvar PREFIX=/
List current: ${P()}setvar - Reset: ${P()}setvar KEY=`,
  reboot: `*${P()}reboot* — restarts the bot process. Owner only.`,
  zushi: `*${P()}zushi <command>* — makes a command public (anyone can use it).
Usage: ${P()}zushi ping`,
  tushi: `*${P()}tushi <command>* — makes a command admin-only.
Usage: ${P()}tushi ping`,
  ope: `*${P()}ope <command>* — locks a command to the owner only.
Usage: ${P()}ope ping`,
  levels: `*${P()}levels* — lists every command and its current access level. * = overridden.`,
  mysession: `*${P()}mysession* — DM only. Returns your SESSION_ID (base64). Never share it.`,
};

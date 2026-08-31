import { config } from '../../config.js';

export default [
  {
    name: 'menu',
    aliases: ['help', 'h'],
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const topic = (args[0] || '').toLowerCase();
      const text = HELP[topic] || HELP.main;
      return sock.sendMessage(jid, { text }, { quoted: msg });
    },
  },
];

const P = () => config.prefix;

const HELP = {
  main: `╭──────────────────────────╮
│  *${config.botName}*  -  DawnSphereCommunity
│      ── ${config.prefix} prefix ──
╰──────────────────────────╯

✧ MEDIA ✧
  ${P()}sticker · ${P()}toimg · ${P()}attp
  ${P()}stickerinfo · ${P()}vv

✧ MODERATION ✧
  ${P()}kick · ${P()}add · ${P()}promote · ${P()}demote
  ${P()}mute · ${P()}unmute · ${P()}warn · ${P()}warns
  ${P()}resetwarns · ${P()}welcome

✧ PROTECTION ✧
  ${P()}antilink · ${P()}whitelist · ${P()}blocklink
  ${P()}antispam · ${P()}antibad · ${P()}word · ${P()}automute

✧ MLBB ✧
  ${P()}mlbbreg (DM) · ${P()}mlbbpf

✧ UTILITIES ✧
  ${P()}ping · ${P()}alive · ${P()}afk · ${P()}menu

✧ OWNER ✧
  ${P()}setvar · ${P()}reboot
  ${P()}zushi · ${P()}tushi · ${P()}ope · ${P()}levels
  ${P()}mysession · ${P()}pair · ${P()}rereg

▸ *${P()}help <command>* for details.
╰──────────────────────────╯`,

  sticker: `*${P()}sticker* — reply to an image, video or GIF → 512×512 WebP sticker with the ${config.watermark} watermark.
Usage: ${P()}sticker`,
  attp: `*${P()}attp <text>* — colored text sticker. Keep it short.
Usage: ${P()}attp DawnSphere`,
  toimg: `*${P()}toimg* — reply to a sticker to convert it back to an image.`,
  stickerinfo: `*${P()}stickerinfo* — reply to a sticker to see its pack info.`,
  vv: `*${P()}vv* — reply to a *view-once* photo/video to reveal (re-send) it. Works in groups and DMs.`,
  whitelist: `*${P()}whitelist <url|domain>* — allows a domain so anti-link won't block it.
Usage: ${P()}whitelist https://google.com · ${P()}whitelist google.com`,
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
*${P()}welcome set <msg>* — customize (use {name} for the member).
Usage: ${P()}welcome on`,
  warn: `*${P()}warn @user|reply* — adds a warning; after MAX_WARNS the user is kicked.
*${P()}warns @user* — show count. *${P()}resetwarns @user* — clear.`,
  antilink: `*${P()}antilink on|off* — blocks links per ANTILINK_ACTION (warn/kick/mute).
*${P()}allowlink <domain>* — whitelist. *${P()}blocklink <domain>* — blacklist.
Usage: ${P()}antilink on`,
  antispam: `*${P()}antispam on|off* — flood guard: N msgs in T seconds triggers SPAM_ACTION.
Usage: ${P()}antispam on`,
  antibad: `*${P()}antibad on|off* — reacts to bad words.
*${P()}word add <word>* / *${P()}word remove <word>* — manage the list.`,
  automute: `*${P()}automute on <start HH:MM> <end HH:MM>* — daily mute window. Survives restarts.
Usage: ${P()}automute on 22:00 07:00 · ${P()}automute off`,
  afk: `*${P()}afk [reason]* — marks you away; Harper notifies anyone who mentions you. Send any message to clear.`,
  ping: `*${P()}ping* — latency check. Access level is changeable with ${P()}zushi/tushi/ope.`,
  alive: `*${P()}alive* — bot status + uptime.`,
  mlbbreg: `*${P()}mlbbreg* — starts MLBB registration (DM only). You'll give a Role ID, Zone ID and a verification code from your in-game mail.`,
  mlbbpf: `*${P()}mlbbpf* — generates your MLBB profile card with current stats.`,
  setvar: `*${P()}setvar KEY=value* — sets a config var at runtime, instantly, and persists it.
Aliases: ${P()}setvar=KEY=value · ${P()}var · ${P()}env
Usage: ${P()}setvar SUDO=27812345678 · ${P()}setvar PREFIX=/
List current: ${P()}setvar · Reset: ${P()}setvar KEY=`,
  reboot: `*${P()}reboot* — restarts the bot process. Owner only.`,
  zushi: `*${P()}zushi <command>* — makes a command public (anyone can use it).
Usage: ${P()}zushi ping`,
  tushi: `*${P()}tushi <command>* — makes a command admin-only.
Usage: ${P()}tushi ping`,
  ope: `*${P()}ope <command>* — locks a command to the owner only.
Usage: ${P()}ope ping`,
  levels: `*${P()}levels* — lists every command and its current access level. * = overridden.`,
  mysession: `*${P()}mysession* — DM only. Returns your SESSION_ID (base64). Never share it.`,
  pair: `*${P()}pair <number>* — DM only. Requests a pairing code for a phone number.`,
  rereg: `*${P()}rereg [silent]* — scans the community groups and re-sends the welcome/registration prompt to every member (so they can reply *${P()}yes* to register).
Add *silent* to skip the progress messages.
Usage: ${P()}rereg`,
};
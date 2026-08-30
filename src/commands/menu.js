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

const HELP = {
  main: `*DawnSphereCommunity* · Harper
A Baileys-powered WhatsApp bot.
Prefix: *
All stickers carry the DawnSphereCommunity watermark.

*MEDIA*
*!sticker* — reply to image/video/GIF
*!attp <text>* — colored text sticker
*!toimg* — reply to a sticker → image
*!stickerinfo* — reply to a sticker → pack info

*GROUP ADMINS*
*!kick* · *!add* · *!promote* · *!demote* · *!mute* · *!unmute*
*!welcome on|off* + *!welcome set <msg>*
*!warn* · *!warns @user* · *!resetwarns*

*PROTECTION*
*!antilink on|off* · *!allowlink/!blocklink <domain>*
*!antispam on|off*
*!antibad on|off* · *!word add|remove <word>*
*!automute on <HH:MM> <HH:MM>* · *!automute off*

*MLBB*
*!mlbbreg* — register (DM only) · *!mlbbpf* — profile card

*UTILITIES*
*!menu* · *!ping* · *!alive* · *!afk [reason]*

Type *!help <command>* for details.`,

  sticker: `*!sticker* — reply to an image, video or GIF. Creates a 512x512 WebP sticker with the DawnSphereCommunity watermark.
Usage: *!sticker*`,
  attp: `*!attp <text>* — creates a colored text sticker. Keep text short.
Usage: *!attp DawnSphere*`,
  toimg: `*!toimg* — reply to a sticker to convert it back to an image.`,
  stickerinfo: `*!stickerinfo* — reply to a sticker to see its pack info.`,
  kick: `*!kick* — removes members. Mention them or list numbers.
Usage: *!kick @user*`,
  add: `*!add <number[,number]>* — adds members by number.
Usage: *!add 919876543210,919876543211*`,
  promote: `*!promote @user* — makes a member an admin.`,
  demote: `*!demote @user* — removes admin rights.`,
  mute: `*!mute* — locks the group so only admins can chat.`,
  unmute: `*!unmute* — reopens the group.`,
  welcome: `*!welcome on|off* — welcome/goodbye notices.
*!welcome set <msg>* — customize (use {name} for the member).
Usage: *!welcome on*`,
  warn: `*!warn @user|reply* — adds a warning; after MAX_WARNS the user is kicked.
*!warns @user* — show count. *!resetwarns @user* — clear.`,
  antilink: `*!antilink on|off* — blocks links per ANTILINK_ACTION (warn/kick/mute).
*!allowlink <domain>* — whitelist. *!blocklink <domain>* — blacklist.
Usage: *!antilink on*`,
  antispam: `*!antispam on|off* — flood guard: N msgs in T seconds triggers SPAM_ACTION.
Usage: *!antispam on*`,
  antibad: `*!antibad on|off* — deletes messages with bad words.
*!word add <word>* / *!word remove <word>* — manage the list.`,
  automute: `*!automute on <start HH:MM> <end HH:MM>* — daily mute window (announcement mode). Survives restarts.
Usage: *!automute on 22:00 07:00* · *!automute off*`,
  afk: `*!afk [reason]* — marks you away. Harper notifies anyone who mentions you. Send any message to clear.`,
  ping: `*!ping* — latency check.`,
  alive: `*!alive* — bot status + uptime.`,
  mlbbreg: `*!mlbbreg* — starts MLBB registration (DM only). You'll give your Role ID, Zone ID and a verification code from your in-game mail.`,
  mlbbpf: `*!mlbbpf* — generates your MLBB profile card with current stats.`,
};
const str = (v, d) => (v === undefined || v === null || v === '' ? d : String(v));
const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export const config = {
  prefix: str(process.env.PREFIX, '!'),
  botName: str(process.env.BOT_NAME, 'Harper'),
  owner: (process.env.OWNER || '')
    .split(',')
    .map((s) => s.trim().replace(/[^0-9]/g, ''))
    .filter(Boolean),

  stickerPack: str(process.env.STICKER_PACK, 'DawnSphereCommunity'),
  stickerAuthor: str(process.env.STICKER_AUTHOR, 'Harper'),
  watermark: str(process.env.WATERMARK, 'DawnSphereCommunity'),

  sessionId: str(process.env.SESSION_ID, ''),
  sessionDir: str(process.env.SESSION_DIR, 'session'),

  appUrl: str(process.env.HARPER_APP_URL || process.env.PUBLIC_URL, ''),
  port: num(process.env.PORT, 3000),
  keepAliveMinutes: num(process.env.KEEP_ALIVE_MIN, 40),

  antilinkDefault: str(process.env.DEFAULT_ANTILINK, 'off'),
  antilinkAction: str(process.env.ANTILINK_ACTION, 'warn'),

  floodLimit: num(process.env.FLOOD_LIMIT, 6),
  floodWindow: num(process.env.FLOOD_WINDOW, 15),
  spamAction: str(process.env.SPAM_ACTION, 'mute'),
  spamMuteMinutes: num(process.env.SPAM_MUTE_MIN, 30),

  maxWarns: num(process.env.MAX_WARNS, 3),
  warnMuteMinutes: num(process.env.WARN_MUTE_MIN, 30),
};
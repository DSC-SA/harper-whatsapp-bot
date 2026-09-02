import { getVars } from './src/vars.js';

const str = (v, d) => (v === undefined || v === null || v === '' ? d : String(v));
const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const vars = getVars();

const resolve = (key, d) => {
  const fromVars = str(vars[key], null);
  if (fromVars !== null) return fromVars;
  const fromEnv = str(process.env[key], null);
  return fromEnv === null ? d : fromEnv;
};

export const config = {
  get prefix() {
    return resolve('PREFIX', '/');
  },
  get botName() {
    return resolve('BOT_NAME', 'Harper');
  },
  get owner() {
    const src = [
      vars.SUDO ?? process.env.SUDO ?? '',
      vars.OWNER ?? process.env.OWNER ?? '',
    ].join(' ');
    return src
      .split(/[,\s]+/)
      .map((s) => s.trim().replace(/[^0-9]/g, ''))
      .filter(Boolean);
  },

  get stickerPack() {
    return resolve('STICKER_PACK', 'DawnSphereCommunity');
  },
  get stickerAuthor() {
    return resolve('STICKER_AUTHOR', 'Harper');
  },
  get watermark() {
    return resolve('WATERMARK', 'DawnSphereCommunity | DSC');
  },
  get stickerExif() {
    const v = process.env.STICKER_EXIF;
    return v === undefined || v === null ? true : String(v).toLowerCase() !== '0' && String(v).toLowerCase() !== 'false';
  },

  sessionId: str(process.env.SESSION_ID, ''),
  sessionDir: str(process.env.SESSION_DIR, 'session'),
  qrFile: str(process.env.HARPER_QR_FILE, 'data/qr.png'),
  pairFor: str(process.env.PAIRING_CODE_FOR, ''),

  get appUrl() {
    return resolve('HARPER_APP_URL', '') || resolve('PUBLIC_URL', '');
  },
  get port() {
    return num(resolve('PORT', '3000'), 3000);
  },
  get keepAliveMinutes() {
    return num(resolve('KEEP_ALIVE_MIN', '15'), 15);
  },
  get keepAliveSeconds() {
    return num(resolve('KEEP_ALIVE_SEC', String(this.keepAliveMinutes * 60)), this.keepAliveMinutes * 60);
  },
  get welcomeScanMinutes() {
    return num(resolve('WELCOME_SCAN_MIN', '1'), 1);
  },

  get antilinkDefault() {
    return resolve('DEFAULT_ANTILINK', 'on');
  },
  get antilinkAction() {
    return resolve('ANTILINK_ACTION', 'warn');
  },

  get floodLimit() {
    return num(resolve('FLOOD_LIMIT', '10'), 10);
  },
  get floodWindow() {
    return num(resolve('FLOOD_WINDOW', '30'), 30);
  },
  get spamAction() {
    return resolve('SPAM_ACTION', 'mute');
  },
  get spamMuteMinutes() {
    return num(resolve('SPAM_MUTE_MIN', '30'), 30);
  },

  get maxWarns() {
    return num(resolve('MAX_WARNS', '3'), 3);
  },
  get warnMuteMinutes() {
    return num(resolve('WARN_MUTE_MIN', '30'), 30);
  },

  get mlbbRegGroup() {
    return resolve('MLBB_REG_GROUP', '120363404307438604@g.us');
  },

  get mlbbRegGroups() {
    return String(resolve('MLBB_REG_GROUP', '120363404307438604@g.us,120363423706976066@g.us'))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  },
};
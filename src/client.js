import makeWASocket, {
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import qrcodeTerminal from 'qrcode-terminal';
import pino from 'pino';
import { buildAuthState } from './session.js';
import { config } from '../config.js';

const logger = pino({ level: (process.env.LOG_LEVEL || 'warn'), name: 'harper' });

function showQr(qr) {
  qrcodeTerminal.generate(qr, { small: true }, (out) => {
    console.log('[harper] Scan this QR in WhatsApp > Linked Devices to pair:');
    console.log(out);
  });
}

async function makeSock(authState) {
  const { version } = await fetchLatestBaileysVersion();
  return makeWASocket({
    version,
    logger,
    browser: [config.botName, 'Chrome', 'Harper'],
    auth: {
      creds: authState.state.creds,
      keys: makeCacheableSignalKeyStore(authState.state.keys, logger),
    },
    markOnlineOnConnect: true,
    syncFullHistory: false,
  });
}

export async function startClient(handlers) {
  let sock = null;
  let authState = null;
  let reconnectTimer = null;

  const connect = async () => {
    try {
      authState = await buildAuthState();
    } catch (e) {
      console.log(`[harper] failed to build auth state: ${e.message}`);
    }

    sock = await makeSock(authState);

    sock.ev.on('creds.update', authState.saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) showQr(qr);

      if (connection === 'open') {
        console.log(`[harper] connected as ${sock.user?.id || 'unknown'}`);
        handlers?.onConnected?.(sock);
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        console.log(`[harper] connection closed (code=${code})`);

        if (loggedOut) {
          console.log('[harper] logged out. clear SESSION_ID and re-pair.');
          return;
        }

        const baseDelay = code === DisconnectReason.connectionReplaced ? 10000 : 1500;
        const jitter = Math.floor(Math.random() * 1500);
        reconnectTimer = setTimeout(connect, baseDelay + jitter);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      try {
        for (const msg of messages) {
          if (msg.key && msg.key.fromMe) continue;
          if (type !== 'notify') continue;
          await handlers?.onMessage?.(sock, msg);
        }
      } catch (e) {
        console.log(`[harper] message handler error: ${e.message}`);
      }
    });

    sock.ev.on('group-participants.update', (update) => {
      try {
        handlers?.onParticipants?.(sock, update);
      } catch (e) {
        console.log(`[harper] participants handler error: ${e.message}`);
      }
    });

    return sock;
  };

  await connect();
  return {
    getSock: () => sock,
    logger,
  };
}
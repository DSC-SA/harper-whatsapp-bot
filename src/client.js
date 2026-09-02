import {
  makeWASocket,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import pino from 'pino';
import { buildAuthState } from './session.js';
import { config } from '../config.js';
import { recordLidMapping, recordKeyMappings, recordGroupMappings } from './lidmap.js';
import { setLinkStatus } from './link.js';

const logger = pino({ level: (process.env.LOG_LEVEL || 'warn'), name: 'harper' });

function renderQrAscii(qr) {
  const qrObj = QRCode.create(qr);
  const count = qrObj.modules.size;
  const isDark = (r, c) => qrObj.modules.get(r).get(c);
  const lines = [];
  for (let r = 0; r < count; r++) {
    let row = '';
    for (let c = 0; c < count; c++) {
      row += isDark(r, c) ? '\u2588\u2588' : '  ';
    }
    lines.push(row);
  }
  return lines.join('\n');
}

function showQr(qr) {
  console.log('[harper] Scan this QR in WhatsApp > Linked Devices to pair:');
  console.log(renderQrAscii(qr));
  QRCode.toFile(config.qrFile, qr, { width: 640, margin: 2 })
    .then(() => console.log(`[harper] QR image saved: ${config.qrFile} (refreshes until scanned)`))
    .catch(async (e) => {
      try {
        mkdirSync(dirname(config.qrFile), { recursive: true });
        await QRCode.toFile(config.qrFile, qr, { width: 640, margin: 2 });
        console.log(`[harper] QR image saved: ${config.qrFile} (refreshes until scanned)`);
      } catch (e2) {
        console.log(`[harper] failed to write QR image: ${e2.message}`);
      }
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
    keepAliveIntervalMs: 25000,
    connectTimeoutMs: 30000,
    maxMsgRetryCount: 3,
    generateHighQualityLinkPreview: false,
    getMessage: async () => undefined,
    shouldIgnoreJid: () => false,
    retryRequestDelayMs: 5000,
  });
}

export async function startClient(handlers) {
  let sock = null;
  let authState = null;
  let reconnectTimer = null;
  let pairCodeRequested = false;
  let watchdogTimer = null;
  let lastOpenAt = 0;
  let expectingClose = false;

  async function requestPairCode() {
    if (!config.pairFor || authState.state.creds.registered) return;
    if (pairCodeRequested) return;
    pairCodeRequested = true;
    const wsOpen = () => sock?.ws && sock.ws.readyState === 1;
    let attempts = 0;
    const tryOnce = async () => {
      if (!wsOpen()) {
        if (attempts < 20) setTimeout(tryOnce, 3000);
        return;
      }
      try {
        const code = await sock.requestPairingCode(config.pairFor);
        const msg = `[harper] PAIRING CODE for ${config.pairFor}: ${code}  (WhatsApp > Link a Device > Link with phone number instead)`;
        console.log(msg);
        try {
          mkdirSync(dirname(config.qrFile), { recursive: true });
          writeFileSync('data/pairing_code.txt', code, 'utf8');
        } catch {}
      } catch (e) {
        attempts += 1;
        if (attempts < 15) setTimeout(tryOnce, 8000);
        else {
          console.log(`[harper] giving up on pairing code after ${attempts} attempts`);
          pairCodeRequested = false;
        }
      }
    };
    await tryOnce();
  }

  const connect = async () => {
    try {
      authState = await buildAuthState();
    } catch (e) {
      console.log(`[harper] failed to build auth state: ${e.message}`);
    }

    sock = await makeSock(authState);

    await requestPairCode();

    sock.ev.on('creds.update', authState.saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) showQr(qr);

      if (connection === 'open') {
        setLinkStatus('open');
        lastOpenAt = Date.now();
        expectingClose = false;
        console.log(`[harper] connected as ${sock.user?.id || 'unknown'}`);
        handlers?.onConnected?.(sock);
      }

      if (connection === 'close') {
        setLinkStatus('connecting');
        expectingClose = true;
        const code = lastDisconnect?.error?.output?.statusCode;
        const registered = !!(authState?.state?.creds?.registered);
        const errMsg = lastDisconnect?.error?.message || '';
        console.log(`[harper] connection closed (code=${code}, registered=${registered})${errMsg ? ` :: ${errMsg}` : ''}`);

        if (code === DisconnectReason.loggedOut && registered) {
          console.log('[harper] logged out. clear SESSION_ID and re-pair.');
          return;
        }

        const replaced = code === DisconnectReason.connectionReplaced;
        const baseDelay = replaced ? 6000 : 700;
        const jitter = Math.floor(Math.random() * 700);
        console.log(`[harper] scheduling reconnect in ${Math.round((baseDelay + jitter) / 1000)}s`);
        reconnectTimer = setTimeout(() => {
          connect().catch((e) => console.log(`[harper] reconnect error: ${e.message}`));
        }, baseDelay + jitter);
      }
    });

    function startWatchdog() {
      if (watchdogTimer) clearInterval(watchdogTimer);
      watchdogTimer = setInterval(() => {
        try {
          const ws = sock?.ws;
          const registered = !!(authState?.state?.creds?.registered);
          const wsDead = !ws || ws.readyState !== 1;
          const stale = lastOpenAt && Date.now() - lastOpenAt > 45000;
          if (wsDead && !expectingClose && !reconnectTimer) {
            console.log(`[harper] watchdog: socket dead (readyState=${ws ? ws.readyState : 'null'}) -> forcing reconnect`);
            reconnectTimer = setTimeout(() => {
              reconnectTimer = null;
              connect().catch((e) => console.log(`[harper] watchdog reconnect error: ${e.message}`));
            }, 300);
          } else if (!wsDead && !stale && registered && Date.now() - lastOpenAt > 30000) {
            console.log(`[harper] watchdog: connected but idle ${Math.round((Date.now() - lastOpenAt) / 1000)}s, sending ping`);
            try {
              sock.sendNode({ tag: 'iq', attrs: { to: 's.whatsapp.net', type: 'get', xmlns: 'w:p' }, content: [] });
            } catch {}
            lastOpenAt = Date.now();
          }
        } catch (e) {
          console.log(`[harper] watchdog error: ${e.message}`);
        }
      }, 15000);
    }

    startWatchdog();

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      try {
        for (const msg of messages) {
          if (!msg?.key) continue;
          recordKeyMappings(msg.key);
          if (msg.key.fromMe) continue;
          if (type !== 'notify') continue;
          if (process.env.DEBUG_MSG === '1') {
            console.log(`[harper] upsert type=${type} remote=${msg.key.remoteJid} from=${msg.key.participant || msg.key.remoteJid} body=${(msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').slice(0, 40)}`);
          }
          await handlers?.onMessage?.(sock, msg);
        }
      } catch (e) {
        console.log(`[harper] message handler error: ${e.message}`);
      }
    });

    sock.ev.on('contacts.update', (contacts) => {
      try {
        for (const c of contacts || []) {
          if (!c?.lid) continue;
          if (c.phoneNumber) recordLidMapping(c.lid, `${c.phoneNumber}@s.whatsapp.net`);
          else if (c.id && !String(c.id).endsWith('@lid')) recordLidMapping(c.lid, c.id);
        }
      } catch (e) {
        console.log(`[harper] contacts handler error: ${e.message}`);
      }
    });

    sock.ev.on('chats.phoneNumberShare', ({ lid, jid }) => {
      try {
        if (lid && jid) recordLidMapping(lid, jid);
      } catch (e) {
        console.log(`[harper] number share handler error: ${e.message}`);
      }
    });

    sock.ev.on('group-participants.update', (update) => {
      try {
        handlers?.onParticipants?.(sock, update);
        if (update?.id) recordGroupMappings(sock, update.id).catch(() => {});
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
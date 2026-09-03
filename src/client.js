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
import { registerRepair } from './repair.js';

const logger = pino({ level: (process.env.LOG_LEVEL || 'warn'), name: 'harper' });

function renderQrAscii(qr) {
  const qrObj = QRCode.create(qr);
  const size = qrObj.modules.size;
  const isDark = (r, c) => qrObj.modules.get(r, c);
  const lines = [];
  for (let r = 0; r < size; r++) {
    let row = '';
    for (let c = 0; c < size; c++) {
      row += isDark(r, c) ? '\u2588\u2588' : '  ';
    }
    lines.push(row);
  }
  return lines.join('\n');
}

let lastQr = ''; // dedupe: only emit a QR when it actually changes
let lastQrAt = 0; // timestamp of the last accepted QR
const QR_MIN_INTERVAL_MS = 11000; // force a stable window so a scan can land

function showQr(qr) {
  if (!qr) return;
  const now = Date.now();
  // Baileys can re-emit the same/rapid-fire session challenge; re-writing the
  // PNG and spamming the console on every single event races the user's scan
  // (the QR keeps flipping before it can be scanned). Enforce a minimum quiet
  // window so the QR stays scannable for a beat. Only an actual change in the
  // payload and a fresh cooldown is honored.
  if (qr === lastQr) return;
  if (now - lastQrAt < QR_MIN_INTERVAL_MS && lastQrAt !== 0) return;
  lastQr = qr;
  lastQrAt = now;
  console.log('[harper] Scan this QR in WhatsApp > Linked Devices to pair:');
  try {
    console.log(renderQrAscii(qr));
  } catch (e) {
    console.log(`[harper] (qr preview unavailable: ${e.message})`);
  }
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
    defaultQueryTimeoutMs: 60000,
  });
}

const HEARTBEAT_MS = 25000;          // inbound-liveness silence threshold before we probe
const PROBE_MS = 45000;              // how often we actively check the receive path
const WATCHDOG_MS = 10000;           // how often the watchdog loop runs
const PROBE_TIMEOUT_MS = 20000;      // how long we wait for a probe answer before calling it dead
const RESTART_MAX_DELAY_MS = 30000;  // cap on reconnect backoff
const DEAF_RESTARTS_BEFORE_EXIT = 2; // deaf reconnects before we hard-restart the process

const FORCE_FRESH_KEY = 'force_fresh'; // DB blob flag that survives container recycle

async function readForceFresh() {
  try {
    const { loadBlob } = await import('./db.js');
    return !!(await loadBlob(FORCE_FRESH_KEY));
  } catch {
    return false;
  }
}

async function writeForceFresh() {
  try {
    const { saveBlob } = await import('./db.js');
    await saveBlob(FORCE_FRESH_KEY, '1');
  } catch (e) {
    console.log(`[harper] failed to write force-fresh flag: ${e.message}`);
  }
}

async function clearForceFresh() {
  try {
    const { deleteBlob } = await import('./db.js');
    await deleteBlob(FORCE_FRESH_KEY);
  } catch {}
}

export async function startClient(handlers) {
  let sock = null;
  let authState = null;
  let reconnectTimer = null;
  let pairCodeRequested = false;
  let watchdogTimer = null;
  let lastOpenAt = 0;
  let expectingClose = false;

  let lastInboundAt = 0;          // last time any inbound frame arrived (messages/receipts)
  let lastProbeAt = 0;            // last time we ran an active liveness probe
  let probeInFlight = false;      // guard against overlapping probes
  let deafRestarts = 0;           // consecutive deaf-socket reconnect attempts
  let probeFailStreak = 0;        // consecutive probe failures while socket open
  let closing = false;            // true when we're intentionally tearing down
  let forceFreshQR = false;       // when true, the next connect ignores stored session to emit a fresh QR

  function resetLiveness() {
    lastInboundAt = Date.now();
    lastProbeAt = Date.now();
    probeFailStreak = 0;
  }

  // Touched by every inbound event - this is the ONLY signal that truly proves
  // WhatsApp is delivering messages to us. If this ever goes quiet for too long,
  // we are deaf even if the raw websocket still reports OPEN.
  const markInbound = () => {
    if (!lastInboundAt) lastInboundAt = Date.now();
    else {
      const prev = lastInboundAt;
      lastInboundAt = Date.now();
      if (prev !== 0 && Date.now() - prev > HEARTBEAT_MS) {
        console.log(`[harper] liveness: inbound resumed after ${Math.round((Date.now() - prev) / 1000)}s silence`);
      }
    }
    probeFailStreak = 0;
  };

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

  // Tear down a socket PROPERLY. Never use sock.ws.close() - that leaks timers,
  // listeners and leaves Baileys internally stuck, which itself causes zombies.
  function teardown(code) {
    if (!sock) return;
    closing = true;
    clearInterval(watchdogTimer);
    watchdogTimer = null;
    const s = sock;
    sock = null;
    try {
      s.end(code || new Error('harper teardown'));
    } catch (e) {
      console.log(`[harper] teardown end() error: ${e.message}`);
    }
  }

  function scheduleReconnect(delayMs) {
    if (reconnectTimer) return;
    const base = Math.min(delayMs || 1000, RESTART_MAX_DELAY_MS);
    const jitter = Math.floor(Math.random() * 700);
    console.log(`[harper] scheduling reconnect in ${Math.round((base + jitter) / 1000)}s`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect().catch((e) => console.log(`[harper] reconnect error: ${e.message}`));
    }, base + jitter);
  }

  const connect = async () => {
    closing = false;

    // A forced fresh re-pair survives across a container recycle via a DB blob
    // flag. After the hard exit+recycle the process boots, sees the flag, and
    // builds a clean unregistered auth state that emits a brand-new QR - this
    // clears any stale Baileys WebSocket state that made in-process re-links
    // get stuck in "connecting" without ever emitting a QR.
    if (await readForceFresh()) {
      await clearForceFresh();
      forceFreshQR = true;
    }

    try {
      authState = await buildAuthState(forceFreshQR);
    } catch (e) {
      console.log(`[harper] failed to build auth state: ${e.message}`);
    }

    sock = await makeSock(authState);

    // Once the fresh socket is built (QR emitted on connect), the one-shot
    // repair flag is done; any later auto-reconnect uses the normal path.
    forceFreshQR = false;

    // Auto-calling requestPairingCode() when unpaired keeps the socket churning
    // out fresh session challenges - the QR regenerates endlessly and a scan
    // never lands. QR pairing is the default; a pairing code is only requested
    // explicitly via the /pair command.

    sock.ev.on('creds.update', authState.saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) showQr(qr);

      if (connection === 'open') {
        setLinkStatus('open');
        lastOpenAt = Date.now();
        expectingClose = false;
        resetLiveness();
        console.log(`[harper] connected as ${sock.user?.id || 'unknown'}`);
        handlers?.onConnected?.(sock);
      }

      if (connection === 'close') {
        setLinkStatus('connecting');
        expectingClose = true;
        const code = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.status;
        const registered = !!(authState?.state?.creds?.registered);
        const errMsg = lastDisconnect?.error?.message || '';
        const errReason = lastDisconnect?.error?.data?.reason || lastDisconnect?.error?.reason || '';
        const errDesc = lastDisconnect?.error?.data && JSON.stringify(lastDisconnect.error.data);
        console.log(
          `[harper] connection closed (code=${code}, registered=${registered})` +
          (errMsg ? ` :: ${errMsg}` : '') +
          (errReason ? ` [reason=${errReason}]` : '') +
          (errDesc ? ` [data=${errDesc}]` : '')
        );

        if (code === DisconnectReason.loggedOut && registered) {
          console.log('[harper] logged out. clear SESSION_ID and re-pair.');
          return;
        }
        if (code === DisconnectReason.connectionReplaced) {
          console.log('[harper] connection replaced (conflict). Another instance with this session is live.');
          return;
        }
        // Not logged out/replaced; reconnect (700ms) so a fresh QR handshake can
        // start again. Forcing a new session challenge is handled by the retry.
        scheduleReconnect(700);
      }
    });

    // ============================================================
    // Multi-layer liveness watchdog.
    //
    // Layer 1 (raw WS):     treat a non-OPEN websocket as dead.
    // Layer 2 (inbound):    if NO inbound frames (messages/receipts)
    //                       arrive for HEARTBEAT_MS, we may be deaf
    //                       even though the socket reports OPEN.
    // Layer 3 (active probe): an onWhatsApp(self) request/distinct.
    //                       It MUST traverse the receive path; if it
    //                       doesn't answer we are definitively deaf.
    //
    // Recovery: first try a clean in-process reconnect (with backoff).
    // If those keep coming up deaf (Koyeb keeps the socket muted), the
    // only reliable fix is a full process restart - so we exit(1) and
    // let the supervisor (Docker/Koyeb) recycle the container.
    // ============================================================
    function startWatchdog() {
      if (watchdogTimer) clearInterval(watchdogTimer);

      const runProbe = async () => {
        const s = sock;
        if (!s) return;
        const ownNumber = s.user?.id?.split(':')[0]?.split('@')[0];
        if (!ownNumber) return;
        probeInFlight = true;
        try {
          await Promise.race([
            s.onWhatsApp(ownNumber),
            new Promise((_, rej) => setTimeout(() => rej(new Error('probe timeout')), PROBE_TIMEOUT_MS)),
          ]);
          lastInboundAt = Date.now();
          lastProbeAt = Date.now();
          probeFailStreak = 0;
        } catch (e) {
          probeFailStreak += 1;
          console.log(`[harper] liveness probe FAILED (${probeFailStreak} streak): ${e.message}`);
        } finally {
          probeInFlight = false;
        }
      };

      watchdogTimer = setInterval(() => {
        try {
          const s = sock;
          const registered = !!(authState?.state?.creds?.registered);
          const now = Date.now();

          // ---- Layer 1: hard transport death ---------------------
          // NOTE: while unregistered (awaiting QR pairing), the socket is still
          // negotiating and must NOT be torn down as "dead" - doing so regenerates
          // a fresh QR each cycle and the user can never scan it. So Layer 1 only
          // applies to a fully registered, previously-open session.
          const ws = s?.ws;
          if (registered && (!ws || ws.readyState !== 1) && !expectingClose && !reconnectTimer && !closing) {
            console.log(`[harper] watchdog: socket dead (readyState=${ws ? ws.readyState : 'null'}) -> forcing reconnect`);
            teardown(new Error('dead socket'));
            scheduleReconnect(300);
            return;
          }

          if (!s || !registered || expectingClose || closing || reconnectTimer) return;

          // ---- Layer 2: deaf-socket detection (no inbound flow) --
          const silent = now - lastInboundAt;
          if (silent > HEARTBEAT_MS && !probeInFlight) {
            const sinceProbe = now - lastProbeAt;

            // Send a raw keepalive ping to keep NAT/Koyeb edge awake;
            // this also resets Baileys' own lastDateRecv staleness clock.
            if (sinceProbe > 20000) {
              try {
                s.sendNode({ tag: 'iq', attrs: { to: 's.whatsapp.net', type: 'get', xmlns: 'w:p' }, content: [{ tag: 'ping', attrs: {} }] });
              } catch {}
            }

            // Every PROBE_MS of silence, actively test the receive path.
            if (silent > PROBE_MS) {
              console.log(`[harper] watchdog: silent ${Math.round(silent / 1000)}s, probing receive path`);
              runProbe().catch(() => {});
            }
          }

          // ---- Layer 3: deaf recovery -----------------------------
          if (probeFailStreak >= 2) {
            console.log(`[harper] DEAF SOCKET confirmed (${probeFailStreak} failed probes, internet-flow silent) - restarting connection`);
            probeFailStreak = 0;
            deafRestarts += 1;
            teardown(new Error('deaf socket'));
            if (deafRestarts >= DEAF_RESTARTS_BEFORE_EXIT) {
              console.log(`[harper] ${deafRestarts} deaf reconnects - in-process recovery not helping, hard-restarting process`);
              process.exit(1);
            }
            scheduleReconnect(2000);
          }
        } catch (e) {
          console.log(`[harper] watchdog error: ${e.message}`);
        }
      }, WATCHDOG_MS);
    }

    startWatchdog();

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      markInbound();
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

    sock.ev.on('message-receipt.update', () => markInbound());
    sock.ev.on('messages.update', () => markInbound());

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
  const handle = {
    getSock: () => sock,
    logger,
    // Force a fresh re-link: persist a DB flag and hard-restart the process. The
    // recycled container boots, sees the flag, builds a clean unregistered auth
    // state and emits a fresh QR. (Disk markers don't survive Koyeb's container
    // recycle, so the flag lives in Postgres.) The stored session is NOT wiped;
    // it's simply not used on the next boot.
    forceFreshPair: () => {
      if (closing || forceFreshQR) return false;
      console.log('[harper] FORCED fresh re-pair requested - hard-restarting to show a fresh QR');
      writeForceFresh().then(() => {
        teardown(new Error('forced re-pair'));
        setLinkStatus('connecting');
        setTimeout(() => process.exit(1), 300);
      });
      return true;
    },
  };
  registerRepair(handle.forceFreshPair);
  return handle;
}
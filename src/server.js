import express from 'express';
import axios from 'axios';
import { createReadStream, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { getLinkStatus } from './link.js';
import { getHealthSnapshot, getTaskSnapshot } from './tasks.js';
import { triggerRepair } from './repair.js';

export function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'ok', name: config.botName, uptime: process.uptime(), time: new Date().toISOString(), whatsapp: getLinkStatus() });
  });

  app.get('/status', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ status: getLinkStatus() });
  });

  app.get('/system', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ health: getHealthSnapshot(), tasks: getTaskSnapshot() });
  });

  app.post('/repair', (req, res) => {
    const secret = config.repairToken;
    const got = req.query.token || req.get('x-repair-token') || '';
    if (!secret || got !== secret) {
      return res.status(403).json({ error: 'forbidden' });
    }
    triggerRepair().then((r) => res.json(r)).catch((e) => res.status(500).json({ error: e.message }));
  });

  app.get('/qr.png', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const file = resolve(config.qrFile);
    if (!existsSync(file)) {
      return res.status(404).json({ error: 'No QR yet. Waiting for a QR to be generated...' });
    }
    res.set('Content-Type', 'image/png');
    createReadStream(file).pipe(res);
  });

  app.get('/', (req, res) => {
    const base = (config.appUrl || '').replace(/\/+$/, '');
    const qrUrl = `${base}/qr.png`;
    const statusEndpoint = `${base}/status`;
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${config.botName} — Link bot</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; background:#0f172a; color:#e2e8f0; margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; }
  .card { background:#1e293b; padding:32px; border-radius:16px; text-align:center; max-width:460px; width:100%; box-shadow:0 10px 40px rgba(0,0,0,.4); }
  h1 { margin:0 0 4px; font-size:22px; }
  .sub { color:#94a3b8; margin:0 0 20px; font-size:14px; }
  .qr { display:none; background:#fff; padding:16px; border-radius:12px; width:min(340px,80vw); margin:0 auto; }
  .qr img { width:100%; display:block; image-rendering:pixelated; }
  .ok { display:none; color:#4ade80; font-size:20px; font-weight:600; padding:40px 0; }
  .wait { display:none; color:#fbbf24; font-size:15px; padding:24px 0; }
  .hint { margin-top:16px; color:#94a3b8; font-size:13px; line-height:1.5; }
</style>
</head>
<body>
  <div class="card">
    <h1>${config.botName}</h1>
    <p class="sub">DawnSphereCommunity - DSC</p>
    <div class="qr"><img id="qrImg" alt="QR code"></div>
    <div class="ok" id="okBox">&#9989; Bot is connected &amp; ready.</div>
    <div class="wait" id="waitBox">Generating QR... please wait.</div>
    <p class="hint" id="hint">Open WhatsApp on the phone that owns the bot number &rarr; <b>Linked Devices</b> &rarr; <b>Link a Device</b> &rarr; scan this QR.<br>Page auto-refreshes until connected.</p>
    <script>
      var qr = '${qrUrl}';
      var statusUrl = '${statusEndpoint}';
      var img = document.getElementById('qrImg');
      var qrBox = document.querySelector('.qr');
      var okBox = document.getElementById('okBox');
      var waitBox = document.getElementById('waitBox');
      var lastSrc = '';
      function setQrSrc() {
        var s = qr.split('?')[0] + '?t=' + Date.now();
        img.src = s;
        lastSrc = s;
      }
      img.onload = function () {
        waitBox.style.display = 'none';
        qrBox.style.display = 'block';
        okBox.style.display = 'none';
      };
      img.onerror = function () {
        qrBox.style.display = 'none';
        waitBox.style.display = 'block';
        okBox.style.display = 'none';
      };
      fetch(statusUrl).then(function (r) { return r.json(); }).then(function (j) {
        if (j.status === 'open') { qrBox.style.display = 'none'; waitBox.style.display = 'none'; okBox.style.display = 'block'; }
      }).catch(function () {});
      setQrSrc();
      setInterval(function () {
        fetch(statusUrl).then(function (r) { return r.json(); }).then(function (j) {
          if (j.status === 'open') { qrBox.style.display = 'none'; waitBox.style.display = 'none'; okBox.style.display = 'block'; }
          else { okBox.style.display = 'none'; if (img.complete && img.naturalWidth > 0) { qrBox.style.display = 'block'; } }
        }).catch(function () {});
        if (!(img.complete && img.naturalWidth > 0) || img.currentSrc !== lastSrc) setQrSrc();
      }, 3000);
    </script>
  </div>
</body>
</html>`);
  });

  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`[harper] http server listening on :${config.port}`);
  });
  server.on('clientError', (_err, socket) => {
    if (socket) socket.destroy();
  });
  server.on('connection', (socket) => {
    socket.on('error', () => {});
  });
  return server;
}

export function startKeepAlive() {
  const url = config.appUrl;
  if (!url) {
    console.log('[harper] keepalive disabled (set HARPER_APP_URL to your public URL)');
    return null;
  }
  const seconds = Math.max(15, config.keepAliveSeconds);
  const base = url.replace(/\/+$/, '');
  console.log(`[harper] keepalive every ${seconds}s -> ${base}/health`);
  const tick = async () => {
    try {
      await axios.get(`${base}/health`, { timeout: 10000 });
    } catch (e) {
      console.log(`[harper] keepalive ping failed: ${e.message}`);
    }
  };
  tick();
  return setInterval(tick, seconds * 1000);
}
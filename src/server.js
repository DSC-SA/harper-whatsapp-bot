import express from 'express';
import axios from 'axios';
import { config } from '../config.js';

export function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'ok', name: config.botName, uptime: process.uptime(), time: new Date().toISOString() });
  });

  app.get('/', (req, res) => res.send(`${config.botName} is running.`));

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
  const minutes = Math.max(1, config.keepAliveMinutes);
  const base = url.replace(/\/+$/, '');
  console.log(`[harper] keepalive every ${minutes}min -> ${base}/health`);
  const tick = async () => {
    try {
      await axios.get(`${base}/health`, { timeout: 15000 });
    } catch (e) {
      console.log(`[harper] keepalive ping failed: ${e.message}`);
    }
  };
  tick();
  return setInterval(tick, minutes * 60 * 1000);
}
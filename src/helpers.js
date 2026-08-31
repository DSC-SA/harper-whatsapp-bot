import {
  downloadMediaMessage,
  extractMessageContent,
  getContentType,
  isJidGroup,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { config } from '../config.js';
import { resolveUserJid } from './lidmap.js';

const logger = pino({ level: 'silent' });

export const isGroupJid = (jid = '') => isJidGroup(jid);

export function getContent(body) {
  if (!body.message) return null;
  const c = extractMessageContent(body.message);
  if (!c) return null;
  const type = getContentType(c);
  if (!type) return null;
  return { type, content: c, media: c[type] };
}

export function getMessageBody(msg) {
  const { content } = getContent(msg) || {};
  if (!content) return '';
  if (content.conversation) return content.conversation;
  if (content.extendedTextMessage?.text) return content.extendedTextMessage.text;
  if (content.imageMessage?.caption) return content.imageMessage.caption;
  if (content.videoMessage?.caption) return content.videoMessage.caption;
  if (content.templateMessage?.hydratedTemplate?.hydratedContentText) return content.templateMessage.hydratedTemplate.hydratedContentText;
  if (content.listMessage?.description) return content.listMessage.description;
  return '';
}

export function getSenderJid(msg) {
  return msg.key?.participant || msg.key?.remoteJid || '';
}

export function getQuoted(msg) {
  const { content } = getContent(msg) || {};
  return content?.extendedTextMessage?.contextInfo?.quotedMessage || null;
}

export function getMentionedJids(msg) {
  const { content } = getContent(msg) || {};
  return content?.extendedTextMessage?.contextInfo?.mentionedJid || [];
}

const mediaTypes = new Set([
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'stickerMessage',
  'documentMessage',
  'documentWithCaptionMessage',
  'ptvMessage',
]);

export function typeHasMedia(type) {
  return mediaTypes.has(type);
}

function mediaHasUrl(msg) {
  const { content } = getContent(msg) || {};
  if (!content) return false;
  for (const k of Object.keys(content)) {
    const m = content[k];
    if (m && typeof m === 'object' && (m.url || m.directPath)) return true;
  }
  return false;
}

export async function downloadMedia(msg, sock) {
  if (!mediaHasUrl(msg) && sock?.updateMediaMessage && msg?.message) {
    try {
      await Promise.race([
        sock.updateMediaMessage(msg),
        new Promise((_, rej) => setTimeout(() => rej(new Error('updateMediaMessage timed out')), 12000)),
      ]);
    } catch {}
  }
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await downloadMediaMessage(msg, 'buffer', {}, {
        logger,
        rethrowRequest: true,
        logDownloading: true,
        reuploadRequest: async (m) => {
          if (sock?.updateMediaMessage) return sock.updateMediaMessage(m);
          throw new Error('no sock available to refresh media');
        },
      });
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
  throw lastErr;
}

export async function replyText(sock, msg, text, options = {}) {
  const remoteJid = msg.key.remoteJid;
  return sock.sendMessage(remoteJid, { text }, { quoted: msg, ...options });
}

export async function sendText(sock, jid, text, options = {}) {
  return sock.sendMessage(jid, { text }, options);
}

let metadataCache = new Map();

export async function getGroupMetadata(sock, groupJid, fresh = false) {
  if (!fresh && metadataCache.has(groupJid)) {
    const entry = metadataCache.get(groupJid);
    if (Date.now() - entry.ts < 10000) return entry.meta;
  }
  const meta = await sock.groupMetadata(groupJid);
  metadataCache.set(groupJid, { ts: Date.now(), meta });
  return meta;
}

const normalize = (jid = '') => String(jid).replace(/:[0-9]+/, '');

export async function isGroupAdmin(sock, groupJid, participantJid) {
  try {
    const meta = await getGroupMetadata(sock, groupJid);
    const target = normalize(participantJid);
    return (meta.participants || []).some(
      (p) => normalize(p.id) === target && !!p.admin
    );
  } catch {
    return false;
  }
}

export function isOwner(senderJid) {
  const resolved = getCleanUserNumber(resolveUserJid(senderJid));
  const raw = getCleanUserNumber(senderJid);
  return config.owner.some((o) => o === resolved || o === raw || resolved.endsWith(o) || raw.endsWith(o));
}

export function normalizeJid(jid = '') {
  return String(jid).replace(/:[0-9]+/, '');
}

export function getCleanUserNumber(jid = '') {
  return normalizeJid(jid).split('@')[0];
}

export function parseNumbers(text) {
  return (text.match(/[0-9]+/g) || []).map((n) => n.replace(/^0+/, ''));
}

export function formatMs(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (sec) parts.push(`${sec}s`);
  return parts.join(' ') || `${s}s`;
}

export function randomId(prefix = 'DC') {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}
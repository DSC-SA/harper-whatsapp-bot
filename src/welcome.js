import axios from 'axios';
import { getCleanUserNumber } from './helpers.js';
import { resolveUserJid } from './lidmap.js';

function resolveParticipantJid(meta, whoRaw) {
  const entry = (meta?.participants || []).find(
    (m) => String(m.id) === whoRaw || String(m.lid || '') === whoRaw
  );
  if (entry?.jid) return entry.jid;
  if (entry && !String(entry.id || '').endsWith('@lid')) return entry.id;
  return resolveUserJid(whoRaw) || whoRaw;
}

export async function sendRichWelcome(sock, jid, participants, meta) {
  const groupName = meta?.subject || 'this group';
  for (const p of participants) {
    const whoRaw = String(p || '');
    const mention = resolveParticipantJid(meta, whoRaw);
    const num = getCleanUserNumber(mention);
    if (!num || num === getCleanUserNumber(sock.user?.id)) continue;

    const text = `👋 *Welcome @${num} to ${groupName}!*\n\nWe're so glad to have you here. Please read the pinned rules, introduce yourself, and enjoy your stay with us. 🎉`;

    let image = null;
    try {
      const url = await sock.profilePictureUrl(mention, 'image');
      if (url) {
        const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
        image = Buffer.from(resp.data);
      }
    } catch {}

    const content = image
      ? { image, caption: text, mentions: [mention] }
      : { text, mentions: [mention] };
    try {
      await sock.sendMessage(jid, content);
    } catch (e) {
      console.log(`[harper] rich welcome failed for ${num}: ${e.message}`);
    }
  }
}
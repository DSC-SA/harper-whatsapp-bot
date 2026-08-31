import { extractMessageContent, getContentType } from '@whiskeysockets/baileys';
import { replyText, getContent, downloadMedia } from '../helpers.js';
import { config } from '../../config.js';

function unwrap(msg) {
  let m = msg;
  for (let i = 0; i < 4; i++) {
    const inner = extractMessageContent(m?.message || m);
    if (!inner || inner === m) return inner || m;
    m = inner;
  }
  return m;
}

function findMedia(inner) {
  const type = getContentType(inner);
  if (!type) return null;
  return { type, content: inner[type] };
}

export default [
  {
    name: 'vv',
    aliases: ['reveal', 'viewonce'],
    run: async (ctx, args) => {
      const { sock, msg, jid, quotedSender } = ctx;
      let target = msg;

      const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      if (quoted) {
        target = { message: quoted, key: { remoteJid: jid, participant: quotedSender || msg.key.participant } };
      }

      let inner = unwrap(target);
      let media = findMedia(inner);

      if (!media || !['imageMessage', 'videoMessage'].includes(media.type)) {
        return replyText(sock, msg, 'Reply to a *view-once* photo or video to reveal it.');
      }

      const buf = await downloadMedia(
        { ...target, message: { [media.type]: media.content } },
        sock
      ).catch(() => null);

      if (!buf) return replyText(sock, msg, 'Could not download the view-once media (it may have expired or already been opened).');

      const caption = media.content.caption || '';
      const send = media.type === 'imageMessage'
        ? { image: buf, caption }
        : { video: buf, caption };

      await sock.sendMessage(jid, send);
      return { done: true };
    },
  },
];

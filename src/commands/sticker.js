import { getContent, downloadMedia, replyText } from '../helpers.js';
import { config } from '../../config.js';
import {
  imgToSticker,
  gifToAnimatedSticker,
  videoToSticker,
  stickerToPng,
  attpToSticker,
  probeDuration,
} from '../media/sticker.js';

const STICKER_OPTS = {
  watermark: config.watermark,
  packname: config.stickerPack,
  author: config.stickerAuthor,
};

function getQuotedMessageObject(msg) {
  const { content } = getContent(msg) || {};
  const ci = content?.extendedTextMessage?.contextInfo;
  if (!ci?.quotedMessage) return null;
  return {
    key: {
      remoteJid: ci.remoteJid || msg.key.remoteJid,
      participant: ci.participant,
      fromMe: false,
      id: ci.stanzaId || 'unknown',
    },
    message: ci.quotedMessage,
  };
}

function mediaTypeOf(msgObj) {
  const { content, type } = getContent(msgObj) || {};
  if (!content || !type) return null;
  if (type === 'imageMessage') return 'image';
  if (type === 'videoMessage') return 'video';
  if (type === 'ptvMessage') return 'video';
  if (type === 'gifMessage') return 'gif';
  if (type === 'stickerMessage') return 'sticker';
  if (type === 'documentMessage') return 'document';
  return null;
}

const isGif = (msgObj) => {
  const { content } = getContent(msgObj) || {};
  const vm = content?.videoMessage || content?.gifMessage || {};
  return vm.gifPlayback === true || vm.mimetype?.includes('gif');
};

const MAX_VIDEO_SECONDS = 15;

export default [
  {
    name: 'sticker',
    aliases: ['stiker', 's'],
    desc: 'Reply to image/video/GIF to make a watermarked sticker.',
    run: async (ctx, args) => {
      const { sock, msg } = ctx;
      let source = null;
      let quoting = false;
      if (mediaTypeOf(msg)) {
        source = msg;
      } else {
        const quoted = getQuotedMessageObject(msg);
        if (quoted && mediaTypeOf(quoted)) {
          source = quoted;
          quoting = true;
        }
      }
      if (!source) return replyText(sock, msg, 'Reply to (or attach) an image, video or GIF.');

      const mediaType = mediaTypeOf(source);
      if (!mediaType || mediaType === 'document') {
        return replyText(sock, msg, 'That message has no image/video/GIF media.');
      }

      await replyText(sock, msg, 'Making your sticker...');
      try {
        const buffer = await downloadMedia(source, ctx.sock);
        let sticker;
        if (mediaType === 'video') {
          sticker = isGif(source)
            ? await gifToAnimatedSticker(buffer, STICKER_OPTS)
            : await (async () => {
                const dur = await probeDuration(buffer);
                return dur !== null && dur <= MAX_VIDEO_SECONDS
                  ? await gifToAnimatedSticker(buffer, STICKER_OPTS)
                  : await videoToSticker(buffer, STICKER_OPTS);
              })();
        } else {
          sticker = await imgToSticker(buffer, STICKER_OPTS);
        }
        if (process.env.HARPER_DEBUG_DUMP === '1') {
          const { mkdirSync, writeFileSync } = await import('node:fs');
          mkdirSync('data/debug', { recursive: true });
          const tag = Date.now();
          writeFileSync(`data/debug/down_${tag}.bin`, buffer);
          writeFileSync(`data/debug/sticker_${tag}.webp`, sticker);
          console.log(`[sticker] debug dump ${tag}: down=${buffer.length}B sticker=${sticker.length}B`);
        }
        return sock.sendMessage(ctx.jid, { sticker }, { quoted: msg });
      } catch (e) {
        console.log(`[sticker] "${mediaType}" failed: ${e.message}`);
        return replyText(sock, msg, `Sticker failed: ${e.message}`);
      }
    },
  },
  {
    name: 'attp',
    aliases: ['atp'],
    run: async (ctx, args) => {
      const { sock, msg } = ctx;
      const text = args.join(' ');
      if (!text) return replyText(sock, msg, `Usage: ${config.prefix}attp <text>`);
      try {
        const sticker = await attpToSticker(text, STICKER_OPTS);
        return sock.sendMessage(ctx.jid, { sticker }, { quoted: msg });
      } catch (e) {
        console.log(`[attp] failed: ${e.message}`);
        return replyText(sock, msg, `Attp failed: ${e.message}`);
      }
    },
  },
  {
    name: 'toimg',
    aliases: ['toimage'],
    run: async (ctx, args) => {
      const { sock, msg } = ctx;
      const quoted = getQuotedMessageObject(msg);
      if (!quoted || mediaTypeOf(quoted) !== 'sticker') {
        return replyText(sock, msg, 'Reply to a sticker, please.');
      }
      try {
        const buffer = await downloadMedia(quoted, ctx.sock);
        const png = await stickerToPng(buffer);
        return sock.sendMessage(ctx.jid, { image: png }, { quoted: msg });
      } catch (e) {
        console.log(`[toimg] failed: ${e.message}`);
        return replyText(sock, msg, `Failed: ${e.message}`);
      }
    },
  },
  {
    name: 'stickerinfo',
    aliases: ['scinfo', 'info'],
    run: async (ctx, args) => {
      const { sock, msg } = ctx;
      const quoted = getQuotedMessageObject(msg);
      if (!quoted || mediaTypeOf(quoted) !== 'sticker') {
        return replyText(sock, msg, 'Reply to a sticker, please.');
      }
      const s = quoted.message.stickerMessage || (getContent(quoted)?.content || {}).stickerMessage;
      return replyText(
        sock,
        msg,
        `*Sticker pack info*\nMimetype: ${s?.mimetype || 'unknown'}\nAnimated: ${s?.isAnimated ? 'yes' : 'no'}`
      );
    },
  },
];
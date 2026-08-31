import sharp from 'sharp';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFile, writeFile, unlink } from 'fs/promises';
import { randomId } from '../helpers.js';
import { config } from '../../config.js';

const SIZE = 512;

export function buildStickerExif(packname, author) {
  const data = JSON.stringify({
    'sticker-pack-id': randomId('DC'),
    'sticker-pack-name': packname,
    'sticker-pack-publisher': author,
    emojis: ['🙂'],
  });
  const exif = Buffer.concat([
    Buffer.from([
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x16, 0x00, 0x00, 0x00,
    ]),
    Buffer.from(data, 'utf-8'),
  ]);
  exif.writeUIntLE(Buffer.byteLength(data, 'utf-8'), 14, 4);
  return exif;
}

export function watermarkSvg(text, opts = {}) {
  const size = opts.size || SIZE;
  const barH = Math.max(28, Math.round(size * 0.08));
  const fontSize = Math.max(14, Math.round(size * 0.045));
  const margin = Math.max(10, Math.round(size * 0.03));
  const esc = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <rect x="0" y="${size - barH}" width="${size}" height="${barH}" fill="rgba(0,0,0,0.5)"/>
      <text x="${margin}" y="${size - barH / 2 + fontSize / 3.2}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff">${esc}</text>
    </svg>`
  );
}

export function attachExif(webp, exif) {
  if (exif.length % 2) exif = Buffer.concat([exif, Buffer.from([0])]);
  let dims = { w: 512, h: 512 };
  let vp8x = -1;
  let off = 12;
  const lim = 8 + webp.readUInt32LE(4);
  while (off + 8 <= lim) {
    const id = webp.toString('latin1', off, off + 4);
    const size = webp.readUInt32LE(off + 4);
    if (id === 'VP8X') {
      vp8x = off;
      const p = off + 8;
      dims = {
        w: (webp[p + 4] | (webp[p + 5] << 8) | (webp[p + 6] << 16)) + 1,
        h: (webp[p + 7] | (webp[p + 8] << 8) | (webp[p + 9] << 16)) + 1,
      };
      break;
    }
    if (id === 'VP8 ' || id === 'VP8L') {
      const p = off + 8;
      if (id === 'VP8L') {
        const v = webp.readUInt32LE(p + 1);
        dims = { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 };
      } else {
        dims = {
          w: Math.max((webp[p + 6] | (webp[p + 7] << 8)) & 0x3fff, 1),
          h: Math.max((webp[p + 8] | (webp[p + 9] << 8)) & 0x3fff, 1),
        };
      }
      break;
    }
    off += 8 + size + (size % 2);
  }

  const exifHdr = Buffer.alloc(8);
  exifHdr.write('EXIF', 0, 'latin1');
  exifHdr.writeUInt32LE(exif.length, 4);
  const exifChunk = Buffer.concat([exifHdr, exif]);

  let out;
  if (vp8x === -1) {
    const vp8xChunk = Buffer.alloc(18);
    vp8xChunk.write('VP8X', 0, 'latin1');
    vp8xChunk.writeUInt32LE(10, 4);
    vp8xChunk[8] = 0x08;
    const wm1 = dims.w - 1;
    const hm1 = dims.h - 1;
    vp8xChunk[12] = wm1 & 0xff;
    vp8xChunk[13] = (wm1 >> 8) & 0xff;
    vp8xChunk[14] = (wm1 >> 16) & 0xff;
    vp8xChunk[15] = hm1 & 0xff;
    vp8xChunk[16] = (hm1 >> 8) & 0xff;
    vp8xChunk[17] = (hm1 >> 16) & 0xff;
    out = Buffer.concat([webp.subarray(0, 12), vp8xChunk, webp.subarray(12), exifChunk]);
  } else {
    out = Buffer.from(webp);
    out[vp8x + 8] |= 0x08;
    out = Buffer.concat([out, exifChunk]);
  }
  out.writeUInt32LE(out.length - 8, 4);
  return out;
}

async function applyExif(webp, packname, author) {
  if (!config.stickerExif) return webp;
  try {
    return attachExif(webp, buildStickerExif(packname, author));
  } catch {
    return webp;
  }
}

export async function imgToSticker(buffer, { watermark, packname, author, quality = 90 } = {}) {
  let out = await sharp(buffer, { animated: false })
    .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality, alphaQuality: 90 })
    .toBuffer();
  if (watermark) {
    out = await sharp(out)
      .composite([{ input: watermarkSvg(watermark), top: 0, left: 0 }])
      .webp({ quality, alphaQuality: 90 })
      .toBuffer();
  }
  return applyExif(out, packname, author);
}

export async function ffmpegRun(args, input) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    let err = '';
    proc.stdout.on('data', (d) => chunks.push(d));
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited ${code}: ${err.slice(-400)}`));
    });
    if (input) proc.stdin.write(input);
    proc.stdin.end();
  });
}

export async function probeDuration(buffer) {
  return new Promise((resolve) => {
    const proc = spawn(
      ffmpegPath,
      ['-i', 'pipe:0', '-t', '0.001', '-f', 'null', 'pipe:1'],
      { stdio: ['pipe', 'ignore', 'pipe'] }
    );
    let err = '';
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      const m = /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/.exec(err);
      if (!m) return resolve(null);
      proc.stdin.end();
      resolve(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
    });
    if (buffer) proc.stdin.write(buffer);
    proc.stdin.end();
  });
}

async function ffmpegAnimated(buffer, { fps = 16, qmax = 50, watermark } = {}) {
  const tag = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const outFile = join(tmpdir(), `harper_${tag}.webp`);
  const wmFile = watermark ? join(tmpdir(), `harper_wm_${tag}.png`) : null;
  const videoFilter = `fps=${fps},scale=${SIZE}:${SIZE}:force_original_aspect_ratio=increase,crop=${SIZE}:${SIZE},setsar=1,settb=AVTB,setpts=PTS-STARTPTS`;
  const args = ['-y'];
  if (wmFile) {
    const wmPng = await sharp(watermarkSvg(watermark, { size: SIZE })).png().toBuffer();
    await writeFile(wmFile, wmPng);
    args.push('-i', 'pipe:0', '-i', wmFile);
    args.push('-filter_complex', `[0:v]${videoFilter}[v];[v][1:v]overlay=0:0[vout]`, '-map', '[vout]');
  } else {
    args.push('-i', 'pipe:0');
    args.push('-vf', videoFilter);
  }
  args.push(
    '-loop', '0',
    '-an',
    '-threads', '0',
    '-c:v', 'libwebp',
    '-lossless', '0',
    '-compression_level', '2',
    '-qmin', '20',
    '-qmax', `${qmax}`,
    outFile
  );
  await ffmpegRun(args, buffer);
  try {
    return await readFile(outFile);
  } finally {
    await unlink(outFile).catch(() => {});
    if (wmFile) await unlink(wmFile).catch(() => {});
  }
}

export async function gifToAnimatedSticker(buffer, { watermark, packname, author } = {}) {
  let webp = await ffmpegAnimated(buffer, { fps: 16, qmax: 50, watermark });
  if (webp.length > 800 * 1024) {
    const lighter = await ffmpegAnimated(buffer, { fps: 8, qmax: 40, watermark });
    if (lighter.length < webp.length) webp = lighter;
  }
  webp = await applyExif(webp, packname, author);
  if (webp.length > 999 * 1024) {
    throw new Error('Animated sticker is too large (>999KB). Try a shorter video.');
  }
  return webp;
}

export async function gifToStaticSticker(buffer, opts) {
  const args = [
    '-y', '-i', 'pipe:0',
    '-frames:v', '1',
    '-vf', `scale=${SIZE}:${SIZE}:force_original_aspect_ratio=decrease,pad=${SIZE}:${SIZE}:(ow-iw)/2:(oh-ih)/2:color=#00000000`,
    '-f', 'image2pipe', '-c:v', 'png', 'pipe:1',
  ];
  const png = await ffmpegRun(args, buffer);
  return imgToSticker(png, opts);
}

export async function videoToSticker(buffer, opts) {
  return gifToStaticSticker(buffer, opts);
}

export async function stickerToPng(stickerBuffer) {
  return sharp(stickerBuffer).png().toBuffer();
}

export async function attpToSticker(text, { watermark, packname, author, size = 0.5 } = {}) {
  const fontSize = Math.round(SIZE * size);
  const lines = String(text).split('\n').slice(0, 4).map((l) => l.trim()).filter(Boolean);
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
       <defs>
         <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
           <stop offset="0" stop-color="#7F00FF"/>
           <stop offset="0.5" stop-color="#E100FF"/>
           <stop offset="1" stop-color="#00DBDE"/>
         </linearGradient>
       </defs>
       <rect width="${SIZE}" height="${SIZE}" fill="url(#g)"/>
       ${lines
         .map((l, i) => {
           const fc = Math.max(10, fontSize - i * 10);
           const y = SIZE / 2 - ((lines.length - 1) * fc) / 2 + i * fc + fc * 0.32;
           return `<text x="50%" y="${y}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="${fc}" font-weight="700" fill="#ffffff">${escapeXml(l)}</text>`;
         })
         .join('')}
     </svg>`
  );
  let out = await sharp(svg).webp({ quality: 90 }).toBuffer();
  if (watermark) {
    out = await sharp(out)
      .composite([{ input: watermarkSvg(watermark), top: 0, left: 0 }])
      .webp({ quality: 90 })
      .toBuffer();
  }
  return applyExif(out, packname, author);
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
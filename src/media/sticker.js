import sharp from 'sharp';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import webpmux from 'node-webpmux';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFile, unlink } from 'fs/promises';
import { randomId } from '../helpers.js';

const { Image } = webpmux;
const SIZE = 512;

export function buildStickerExif(packname, author) {
  const json = JSON.stringify({
    'sticker-pack-id': randomId('DC'),
    'sticker-pack-name': packname,
    'sticker-pack-publisher': author,
    'emojis': ['🙂'],
  });
  const asciiHex = [...json].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('00');
  const key = Buffer.from(`00${asciiHex}00`, 'hex');
  return Buffer.concat([
    Buffer.from([
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00,
      0x00, 0x08, 0x00, 0x01, 0x01, 0x00, 0x0e, 0x00, 0x00, 0x00, 0x01, 0x00,
      0x00, 0x01, 0x01, 0x00, 0x0f, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
      0x00, 0x00,
    ]),
    key,
  ]);
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

async function applyExif(webp, packname, author) {
  try {
    const img = new Image();
    await img.load(webp);
    img.exif = buildStickerExif(packname, author);
    return await img.save(null);
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

export async function gifToAnimatedSticker(buffer, { watermark, packname, author } = {}) {
  const outFile = join(tmpdir(), `harper_${Date.now()}_${Math.random().toString(36).slice(2)}.webp`);
  const args = [
    '-y', '-i', 'pipe:0',
    '-vf', `scale=${SIZE}:${SIZE}:force_original_aspect_ratio=decrease,pad=${SIZE}:${SIZE}:(ow-iw)/2:(oh-ih)/2:color=#00000000`,
    '-loop', '0',
    '-an',
    '-c:v', 'libwebp',
    '-lossless', '0',
    '-qmin', '20',
    '-qmax', '60',
    outFile,
  ];
  await ffmpegRun(args, buffer);
  try {
    const webp = await readFile(outFile);
    return applyExif(webp, packname, author);
  } finally {
    await unlink(outFile).catch(() => {});
  }
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
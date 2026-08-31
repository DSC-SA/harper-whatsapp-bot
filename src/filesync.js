import { watch } from 'node:fs';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { connectDb, saveBlob, deleteBlob, getAllBlobs } from './db.js';

const DATA_DIR = 'data';
const SYNC_FILE = /^[^.\/](.*\.(json|txt))$/;
const SCAN_MS = 5 * 60 * 1000;

const timers = new Map();

function wanted(name) {
  return SYNC_FILE.test(String(name || '')) && String(name) !== 'groups.txt';
}

async function pushFile(name) {
  try {
    const data = await fsp.readFile(join(DATA_DIR, name), 'utf8');
    await saveBlob(name, data);
  } catch {}
}

async function pullAll() {
  try {
    const blobs = await getAllBlobs();
    let pulled = 0;
    for (const [name, { data, updatedAt }] of blobs) {
      if (!wanted(name)) continue;
      const abs = join(DATA_DIR, name);
      try {
        const st = await fsp.stat(abs);
        if (st.mtimeMs >= updatedAt) continue;
      } catch {}
      try {
        await fsp.writeFile(abs, data, 'utf8');
        pulled++;
      } catch {}
    }
    if (pulled) console.log(`[harper] db -> disk: restored ${pulled} file(s)`);
  } catch {}
}

async function fullPush() {
  try {
    const files = await fsp.readdir(DATA_DIR);
    let pushed = 0;
    for (const name of files) {
      if (!wanted(name)) continue;
      try {
        const st = await fsp.stat(join(DATA_DIR, name));
        if (st.isFile()) {
          await pushFile(name);
          pushed++;
        }
      } catch {}
    }
    if (pushed) console.log(`[harper] disk -> db: synced ${pushed} file(s)`);
  } catch {}
}

function startWatcher() {
  try {
    const w = watch(DATA_DIR, (evt, name) => {
      if (!name || !wanted(name)) return;
      const key = String(name);
      clearTimeout(timers.get(key));
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          if (evt === 'rename') {
            fsp
              .access(join(DATA_DIR, key))
              .then(() => pushFile(key))
              .catch(() => deleteBlob(key));
          } else {
            pushFile(key);
          }
        }, 800)
      );
    });
    w.on('error', () => {});
  } catch {}
}

export async function startDataSync() {
  const ok = await connectDb();
  if (!ok) return;
  await pullAll();
  startWatcher();
  setInterval(fullPush, SCAN_MS);
}
import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';
import * as WAProto from '@whiskeysockets/baileys/WAProto/index.js';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import { config } from '../config.js';

const proto = WAProto.proto || WAProto.default?.proto;

const STATE_FILE = join(config.sessionDir, 'state.json');

function decodeSessionString(str) {
  try {
    return JSON.parse(Buffer.from(str, 'base64').toString('utf8'), BufferJSON.reviver);
  } catch {
    return null;
  }
}

function encodeSessionString(obj) {
  return Buffer.from(JSON.stringify(obj, BufferJSON.replacer)).toString('base64');
}

let sessionString = config.sessionId || '';

export function getSessionString() {
  return sessionString;
}

let writeFailures = 0;

async function writeState(creds, keysObj) {
  try {
    await mkdir(config.sessionDir, { recursive: true });
    await writeFile(
      STATE_FILE,
      JSON.stringify({ creds, keys: keysObj }, BufferJSON.replacer),
      'utf8'
    );
    writeFailures = 0;
  } catch {
    writeFailures += 1;
  }
}

export async function buildAuthState() {
  let sessionString = config.sessionId;
  if (!sessionString) {
    const { loadBlob } = await import('./db.js');
    const dbSession = await loadBlob('harper_session');
    if (dbSession) sessionString = dbSession;
  }
  if (sessionString) {
    const sh = createHash('sha256').update(sessionString).digest('hex').slice(0,12);
    console.log(`[harper] SESSION_ID loaded${config.sessionId ? ' from env' : ' from database'}: len=${sessionString.length} sha256=${sh}`);
  } else {
    console.log(`[harper] SESSION_ID empty; reading from disk: ${config.sessionDir}`);
  }
  let creds = null;
  let keysObj = {};

  const fromEnv = sessionString ? decodeSessionString(sessionString) : null;
  let fromDisk = null;
  if (!fromEnv) {
    try {
      fromDisk = JSON.parse(await readFile(STATE_FILE, 'utf8'), BufferJSON.reviver);
    } catch {
      fromDisk = null;
    }
  }

  const source = fromEnv || fromDisk;
  if (source) {
    creds = source.creds || null;
    if (source.keys) keysObj = source.keys;
  }
  if (!creds) creds = initAuthCreds();

  const store = {
    get: async (type, ids) => {
      const data = {};
      for (const id of ids) {
        let value = keysObj[type]?.[id];
        if (type === 'app-state-sync-key' && value) {
          value = proto.Message.AppStateSyncKeyData.fromObject(value);
        }
        data[id] = value;
      }
      return data;
    },
    set: async (data) => {
      for (const category in data) {
        if (!keysObj[category]) keysObj[category] = {};
        for (const id in data[category]) {
          const value = data[category][id];
          if (value === null || value === undefined) delete keysObj[category][id];
          else keysObj[category][id] = value;
        }
      }
    },
  };

  const saveCreds = async () => {
    sessionString = encodeSessionString({ creds, keys: keysObj });
    await writeState(creds, keysObj);
    try {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      const { dirname } = await import('node:path');
      const f = 'data/session_string.txt';
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, sessionString, 'utf8');
    } catch {}
  };

  const state = { creds, keys: store };

  return { state, saveCreds };
}

export function clearSession() {
  sessionString = '';
}

export async function resetSignalSessions() {
  const parsed = JSON.parse(await readFile(STATE_FILE, 'utf8'), BufferJSON.reviver);
  if (!parsed?.creds) throw new Error('no creds in session state');
  const keys = parsed.keys || {};
  const removed = {
    session: Object.keys(keys.session || {}).length,
    'sender-key': Object.keys(keys['sender-key'] || {}).length,
  };
  delete keys.session;
  delete keys['sender-key'];
  parsed.keys = keys;
  sessionString = encodeSessionString({ creds: parsed.creds, keys });
  await mkdir(config.sessionDir, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify({ creds: parsed.creds, keys }, BufferJSON.replacer), 'utf8');
  return { removed, credsPreserved: true };
}
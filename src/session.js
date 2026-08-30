import { initAuthCreds, BufferJSON, proto } from '@whiskeysockets/baileys';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { config } from '../config.js';

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
  let creds = null;
  let keysObj = {};

  const fromEnv = config.sessionId ? decodeSessionString(config.sessionId) : null;
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
  };

  const state = { creds, keys: store };

  return { state, saveCreds };
}

export function clearSession() {
  sessionString = '';
}
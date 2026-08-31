import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const SEC_FILE = 'data/security.json';
let levels = {};

export function loadSecurity() {
  try {
    if (existsSync(SEC_FILE)) {
      const parsed = JSON.parse(readFileSync(SEC_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') levels = parsed;
    }
  } catch {}
  return levels;
}

export function getOverride(name) {
  return levels[name] || null;
}

export function setLevel(name, level) {
  levels[name] = level;
  saveSecurity();
}

export function resetLevel(name) {
  delete levels[name];
  saveSecurity();
}

export function listOverrides() {
  return { ...levels };
}

function saveSecurity() {
  try {
    mkdirSync('data', { recursive: true });
    writeFileSync(SEC_FILE, JSON.stringify(levels, null, 2), 'utf8');
  } catch {}
}

loadSecurity();
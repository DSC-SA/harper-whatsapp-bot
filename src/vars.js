import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const VARS_FILE = 'data/vars.json';
let vars = {};

export function loadVars() {
  try {
    if (existsSync(VARS_FILE)) {
      const parsed = JSON.parse(readFileSync(VARS_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') vars = parsed;
    }
  } catch {}
  return vars;
}

export function getVars() {
  return vars;
}

export function setVar(key, value) {
  key = String(key).trim().toUpperCase();
  if (!key) return false;
  if (value === undefined || value === null || String(value).trim() === '') delete vars[key];
  else vars[key] = String(value).trim();
  saveVars();
  return true;
}

export function saveVars() {
  try {
    mkdirSync('data', { recursive: true });
    writeFileSync(VARS_FILE, JSON.stringify(vars, null, 2), 'utf8');
  } catch {}
}

loadVars();
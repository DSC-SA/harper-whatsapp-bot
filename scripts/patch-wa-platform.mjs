// Postinstall patch for @whiskeysockets/baileys < 7 (e.g. 6.7.x).
// WhatsApp began rejecting UserAgent.Platform.WEB (value 14) for new device
// pairing in Feb 2026, returning <failure reason='405' .../> (Connection
// Failure). The fix (Baileys PR #2365/#2377, merged into 7.0.0-rc.9+) changes
// the client payload platform to MACOS (value 24). Baileys 6.7.x still ships
// WEB, so we patch it in place here (idempotent).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, '..', 'node_modules', '@whiskeysockets', 'baileys', 'lib', 'Utils', 'validate-connection.js');

try {
  const src = readFileSync(file, 'utf8');
  if (src.includes('Platform.MACOS')) {
    console.log('[patch] validate-connection.js already patched (MACOS)');
    process.exit(0);
  }
  const patched = src.replace(
    'platform: proto.ClientPayload.UserAgent.Platform.WEB,',
    'platform: proto.ClientPayload.UserAgent.Platform.MACOS,'
  );
  if (patched === src) {
    console.log('[patch] WARNING: target line not found; no change made');
    process.exit(1);
  }
  writeFileSync(file, patched, 'utf8');
  console.log('[patch] validate-connection.js patched: Platform.WEB -> Platform.MACOS');
  process.exit(0);
} catch (e) {
  console.log(`[patch] ERROR: ${e.message}`);
  process.exit(1);
}
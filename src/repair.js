// Bridge so owner commands can trigger a forced fresh re-pair without
// importing the whole client lifecycle. startClient registers the real
// forceFreshPair here when it boots.
let fn = null;

export function registerRepair(f) {
  fn = f;
}

export function getRepair() {
  return fn;
}

// Force a fresh re-pair over HTTP (token-gated). Returns true if the
// repair was triggered, false if one is already in progress.
export async function triggerRepair() {
  if (!fn) return { ok: false, reason: 'not_ready' };
  return { ok: !!fn(), reason: fn() ? 'triggered' : 'in_progress' };
}

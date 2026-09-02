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

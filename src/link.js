let status = 'connecting';

export function setLinkStatus(s) {
  status = s;
}

export function getLinkStatus() {
  return status;
}

// The installed app keeps its interface on-device and connects only its API to the PC.
const KEY = 'marginalia.pc-connection';

export function isNativeApp() {
  return !!globalThis.Capacitor?.isNativePlatform?.() || globalThis.location?.protocol === 'capacitor:';
}

export function getConnection() {
  try { return JSON.parse(globalThis.localStorage?.getItem(KEY) || '{}'); }
  catch { return {}; }
}

export function setConnection(connection) {
  globalThis.localStorage.setItem(KEY, JSON.stringify({
    origin: connection.origin, token: connection.token, library: connection.library || '',
  }));
}

export function parsePairingLink(value) {
  let url;
  try { url = new URL(value.trim()); }
  catch { throw new Error('Paste the complete pairing link from Read on iPad on your PC.'); }
  const parts = url.hostname.split('.').map(Number);
  const ipv4 = parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255);
  const privateAddress = ipv4 && (parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || parts[0] === 127);
  if (!['http:', 'https:'].includes(url.protocol) || !privateAddress || url.username || url.password ||
      url.pathname !== '/connect' || url.search || !/^[a-f0-9]{64}$/.test(url.hash.slice(1))) {
    throw new Error('Use the private home-network pairing link shown in Read on iPad on your PC.');
  }
  return { origin: url.origin, token: url.hash.slice(1) };
}

export function resolveApiUrl(path) {
  if (!path.startsWith('/api/')) throw new Error('Invalid reader API address.');
  if (!isNativeApp()) return path;
  const { origin } = getConnection();
  if (!origin) throw new Error('Connect to your PC first. Saved profiles remain available without it.');
  return new URL(path, origin).href;
}

export function requestHeaders() {
  const { token } = getConnection();
  return isNativeApp() && token ? { 'X-Marginalia-Device': token } : {};
}

export function serverScope() {
  if (!isNativeApp()) return globalThis.location?.origin || 'browser';
  const { origin, library } = getConnection();
  return library ? `library:${library}` : origin || 'unpaired';
}

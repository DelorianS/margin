// HTTP client, durable device copies and per-device reading preferences.
import { resolveApiUrl, requestHeaders, serverScope, getConnection, setConnection, isNativeApp } from './connection.js';
import { DeviceStorage, createDeviceRepository, isCacheable, cacheKey } from './device-storage.js';

export class ApiError extends Error {
  constructor(message, { status, code, sourceUrl } = {}) { super(message); this.status = status; this.code = code; this.sourceUrl = sourceUrl; }
}

async function request(method, url, body, { signal, timeoutMs = method === 'GET' ? isNativeApp() && url === '/api/health' ? 2000 : 6500 : null } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const aborted = new Promise((resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(new DOMException(signal?.aborted ? 'Request cancelled.' : 'The PC connection timed out.', 'AbortError')), { once: true });
  });
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = timeoutMs ? setTimeout(abort, timeoutMs) : null;
  try {
    return await Promise.race([aborted, (async () => {
      const r = await fetch(resolveApiUrl(url), {
        method, headers: { ...requestHeaders(), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined, signal: controller.signal,
      });
      const text = await r.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
      if (!r.ok) throw new ApiError(data?.error || `Request failed (${r.status})`, { status: r.status, code: data?.code, sourceUrl: data?.sourceUrl });
      return data;
    })()]);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

const identitiesKey = 'marginalia.device-libraries';
function identities() { try { return JSON.parse(globalThis.localStorage?.getItem(identitiesKey) || '{}'); } catch { return {}; } }
function deviceScope() {
  const scope = serverScope();
  if (scope.startsWith('library:')) return scope;
  const identity = identities()[scope];
  return identity ? `library:${identity}` : scope;
}

function setLibraryIdentity(identity) {
  if (typeof identity !== 'string' || !identity) return;
  if (isNativeApp() && getConnection().origin) { setConnection({ ...getConnection(), library: identity }); return; }
  try { globalThis.localStorage?.setItem(identitiesKey, JSON.stringify({ ...identities(), [serverScope()]: identity })); } catch { /* Settings may be unavailable in private mode. */ }
}

const unavailable = error => !error.status || [401, 403, 502, 503, 504].includes(error.status);
const offlineMessage = 'Your PC is unavailable. Saved chapters and profiles still work; connect to your PC for AI and new downloads.';

// Dependencies are injectable so offline/reconnect behaviour can be verified
// without a running PC or a model request.
export function createApiClient({ transport = request, repository = createDeviceRepository(new DeviceStorage(), deviceScope), onIdentity = setLibraryIdentity } = {}) {
  let online = null, connectionError = null, pairingRequired = false, syncPromise = null, backgroundSyncAt = 0, failedAt = 0, lastFailure = null;
  const notify = () => {
    if (globalThis.window?.dispatchEvent && globalThis.CustomEvent) window.dispatchEvent(new CustomEvent('marginalia:connection', { detail: { online, error: connectionError } }));
  };
  const connected = value => { const changed = online !== value; online = value; if (value) { connectionError = null; pairingRequired = false; } if (changed) notify(); };
  const disconnected = error => {
    online = false;
    if (error !== lastFailure) { failedAt = Date.now(); lastFailure = error; }
    pairingRequired = error.status === 401 || error.status === 403;
    connectionError = pairingRequired ? 'Pair with your PC again to sync. Your device copies are still available.' : offlineMessage; notify();
  };
  const cache = async (url, data) => {
    try { await repository.cache(url, data); }
    catch (error) { repository.storage.error = error.message; notify(); }
  };

  async function syncPending() {
    if (syncPromise) return syncPromise;
    syncPromise = (async () => {
      let edits;
      try { edits = await repository.pending(); } catch { return { synced: 0, pending: 0 }; }
      if (!edits.length) return { synced: 0, pending: 0 };
      const startingScope = repository.scope();
      // Check the library before sending any queued edit: another PC/library can
      // have the same numeric character IDs.
      const health = await transport('GET', '/api/health');
      if (repository.scope() !== startingScope) return { synced: 0, pending: (await repository.pending()).length };
      const before = await repository.pending();
      onIdentity(health.library);
      edits = await repository.pending();
      if (before.length && !edits.some(e => before.some(old => old.storageKey === e.storageKey))) return { synced: 0, pending: edits.length };
      let synced = 0;
      for (const edit of edits) {
        const sendingScope = repository.scope();
        const response = await transport('PATCH', edit.url, edit.body);
        if (repository.scope() !== sendingScope) return { synced, pending: (await repository.pending()).length };
        await repository.acceptEdit(edit, response);
        synced++;
      }
      connected(true); notify();
      return { synced, pending: (await repository.pending()).length };
    })().catch(error => { if (unavailable(error)) disconnected(error); throw error; }).finally(() => { syncPromise = null; });
    return syncPromise;
  }

  async function req(method, url, body) {
    const startingScope = repository.scope();
    try {
      // A failed PC probe should not make every saved chapter/profile wait for
      // another network timeout. Health checks always remain available to retry.
      if (online === false && Date.now() - failedAt < 5000 && url !== '/api/health' &&
          (method === 'GET' || method === 'PATCH' && /^\/api\/characters\/\d+$/.test(url))) throw lastFailure;
      // Preserve edit order: an older saved change must never replay over a new
      // edit that was just sent while reconnecting.
      if (method === 'PATCH' && /^\/api\/characters\/\d+$/.test(url)) await syncPending();
      if (repository.scope() !== startingScope) throw new ApiError('The PC library changed. Open this character from the current library first.', { status: 409, code: 'CONNECTION_CHANGED' });
      const data = await transport(method, url, body);
      if (repository.scope() !== startingScope) throw new ApiError('The PC connection changed. Open this page again.', { status: 409, code: 'CONNECTION_CHANGED' });
      if (url === '/api/health') onIdentity(data.library);
      connected(true);
      if (method === 'GET') {
        await cache(url, data);
        if (Date.now() - backgroundSyncAt > 5000) { backgroundSyncAt = Date.now(); void syncPending().catch(() => {}); }
        if (isCacheable(url)) {
          try { const stored = await repository.cached(url); if (stored !== undefined) return stored; } catch { /* Use the live result if device storage is unavailable. */ }
        }
      } else if (method === 'PATCH' && /^\/api\/characters\/\d+$/.test(url)) {
        // Persist appearance changes to every already-saved chapter view.
        try {
          const entry = await repository.queue(url, body);
          const edit = (await repository.pending()).find(e => e.id === entry.id);
          if (edit) await repository.acceptEdit(edit, data);
        } catch { /* An online edit still succeeded if there was no device copy. */ }
        if (body.chapter) await cache(`${url}?chapter=${body.chapter}`, data);
      } else if (method === 'DELETE' && /^\/api\/characters\/\d+$/.test(url)) {
        try { await repository.invalidateCharacter(url.split('/').at(-1)); } catch { /* Best effort cache cleanup. */ }
      } else if (method === 'DELETE' && /^\/api\/novels\/\d+$/.test(url)) {
        try { await repository.invalidateNovel(url.split('/').at(-1)); notify(); } catch { /* Best effort cache cleanup. */ }
      } else if (method === 'POST' && /^\/api\/characters\/\d+\/merge$/.test(url)) {
        try { await repository.invalidateCharacter(url.split('/')[3]); } catch { /* Best effort cache cleanup. */ }
      }
      return data;
    } catch (error) {
      if (error.status === 404 && method === 'GET') {
        const path = cacheKey(url).split('?')[0];
        try {
          if (/^\/api\/characters\/\d+$/.test(path)) await repository.invalidateCharacter(path.split('/').at(-1));
          if (/^\/api\/novels\/\d+$/.test(path)) await repository.invalidateNovel(path.split('/').at(-1));
        } catch { /* Preserve the server's real 404 if cache cleanup fails. */ }
      }
      if (!unavailable(error)) throw error;
      disconnected(error);
      if (method === 'GET') {
        try { const saved = await repository.cached(url, { offline: true }); if (saved !== undefined) return saved; } catch { /* No device copy. */ }
        if (/^\/api\/jobs(?:\?|$)/.test(url)) return [];
        if (url === '/api/llm/status') return { ok: false, offline: true, models: [], error: 'PC offline · saved profiles available' };
        if (url === '/api/network') return { enabled: false, local: false, addresses: [], offline: true };
        // Clear the cast when there is no snapshot at this chapter; keeping the
        // previous list could expose characters learned in a later chapter.
        if (/^\/api\/novels\/\d+\/characters\?/.test(url)) return [];
      }
      if (method === 'PATCH' && /^\/api\/characters\/\d+$/.test(url)) {
        const result = await repository.queue(url, body); notify();
        return result;
      }
      throw new ApiError(method === 'GET' && isCacheable(url) ? 'This chapter or profile has not been saved on this device. Connect to your PC and save it first.' : offlineMessage, { code: 'PC_OFFLINE' });
    }
  }

  const client = {
    get: u => req('GET', u), post: (u, b = {}) => req('POST', u, b), put: (u, b) => req('PUT', u, b), patch: (u, b) => req('PATCH', u, b), del: u => req('DELETE', u),
    syncPending,
    setLibraryIdentity: onIdentity,
    async deviceStatus() { return { online, error: connectionError, pairingRequired, ...await repository.status() }; },
    async saveForOffline(novelId, { chapter, onProgress, signal } = {}) {
      if (!Number.isSafeInteger(Number(novelId)) || Number(novelId) < 1 || !Number.isSafeInteger(Number(chapter)) || Number(chapter) < 1) throw new Error('Choose a novel and chapter to save.');
      onProgress?.({ phase: 'downloading' });
      const startingScope = repository.scope();
      try {
        const snapshot = await transport('GET', `/api/novels/${novelId}/device-snapshot?chapter=${chapter}`, undefined, { signal, timeoutMs: 120000 });
        if (signal?.aborted) throw new DOMException('Save cancelled.', 'AbortError');
        if (repository.scope() !== startingScope) throw new ApiError('The PC connection changed. Save again from the new connection.', { status: 409, code: 'CONNECTION_CHANGED' });
        onIdentity(snapshot.library);
        onProgress?.({ phase: 'saving', chapters: snapshot.chapters?.length, characters: snapshot.characters?.length });
        const result = await repository.saveSnapshot(snapshot, { signal });
        try { await globalThis.navigator?.storage?.persist?.(); } catch { /* Some iOS versions do not support this hint. */ }
        connected(true); notify(); onProgress?.({ phase: 'done', ...result });
        return result;
      } catch (error) { if (unavailable(error)) disconnected(error); throw error; }
    },
    // Capacitor's native HTTP bridge may return a buffered response rather than
    // a ReadableStream; both paths retain the existing NDJSON event protocol.
    stream(url, body, onEvent) {
      const ctrl = new AbortController();
      const requestId = isNativeApp() ? globalThis.crypto?.randomUUID?.() : null;
      if (requestId) ctrl.signal.addEventListener('abort', () => {
        void request('POST', `/api/streams/${requestId}/cancel`, {}, { timeoutMs: 15000 }).catch(() => {});
      }, { once: true });
      (async () => {
        try {
          if (isNativeApp()) {
            const startingScope = repository.scope();
            const health = await request('GET', '/api/health', undefined, { signal: ctrl.signal });
            if (ctrl.signal.aborted) { onEvent({ type: 'aborted' }); return; }
            if (repository.scope() !== startingScope) throw new ApiError('The PC connection changed. Open this novel again.', { status: 409 });
            onIdentity(health.library);
            if (repository.scope() !== startingScope) throw new ApiError('The PC library changed. Open this novel again.', { status: 409 });
          }
          const r = await fetch(resolveApiUrl(url), { method: 'POST', headers: { ...requestHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ ...body, ...(requestId ? { clientRequestId: requestId } : {}) }), signal: ctrl.signal });
          if (ctrl.signal.aborted) { onEvent({ type: 'aborted' }); return; }
          if (!r.ok) { let msg = `Request failed (${r.status})`; try { msg = (await r.json()).error || msg; } catch { /* Empty error response. */ } onEvent({ type: 'error', message: msg }); return; }
          connected(true);
          const emitLine = line => { if (!line.trim() || ctrl.signal.aborted) return; let event; try { event = JSON.parse(line); } catch { return; } onEvent(event); };
          if (!r.body?.getReader) { const text = await r.text(); for (const line of text.split('\n')) emitLine(line); return; }
          const reader = r.body.getReader(), dec = new TextDecoder();
          let buf = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            if (ctrl.signal.aborted) { await reader.cancel(); break; }
            buf += dec.decode(value, { stream: true });
            let i;
            while ((i = buf.indexOf('\n')) >= 0) { emitLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
          }
          buf += dec.decode();
          emitLine(buf);
        } catch (error) {
          if (error.name === 'AbortError') onEvent({ type: 'aborted' });
          else { disconnected(error); onEvent({ type: 'error', message: 'AI needs your PC. Keep it awake and the reader running, then try again.' }); }
        } finally { onEvent({ type: 'end' }); }
      })();
      return ctrl;
    },
  };
  return client;
}

export const api = createApiClient();

// ---- preferences (per-browser conveniences; everything important lives on the server) ----
const KEY = 'marginalia.prefs';
const DEFAULTS = {
  theme: 'paper',
  font: 'serif',
  size: 19,
  leading: 1.75,
  measure: 40,
  align: 'left',
  marks: 'first',          // first | all | underline | off
  dialogue: 'inline',      // inline | separate
  panelOpen: true,
  panelTab: 'ask',
  answerMode: 'explain',
  recapLookback: 10,
};

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}

export const prefs = {
  ...load(),
  set(patch) {
    Object.assign(this, patch);
    const out = {};
    for (const k of Object.keys(DEFAULTS)) out[k] = this[k];
    try { localStorage.setItem(KEY, JSON.stringify(out)); } catch { /* storage unavailable */ }
    applyPrefs();
  },
};

export function applyPrefs() {
  const r = document.documentElement;
  r.dataset.theme = prefs.theme;
  r.style.setProperty('--read-size', `${prefs.size}px`);
  r.style.setProperty('--read-leading', prefs.leading);
  r.style.setProperty('--read-measure', `${prefs.measure}rem`);
}

const localKey = key => isNativeApp() ? `marginalia.${deviceScope()}.${key}` : `marginalia.${key}`;
export const local = {
  get(key, fallback = null) { try { const v = localStorage.getItem(localKey(key)); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(localKey(key), JSON.stringify(value)); } catch { /* ignore */ } },
};

// App shell: routing, shared state (LLM status, background jobs), global shortcuts.
import { api, applyPrefs } from './api.js';
import { closeAllLayers, fill } from './ui.js';
import { pairingRequired } from './network.js';
import { getConnection, isNativeApp } from './connection.js';
import { deviceWelcome, installDeviceStatus } from './device.js';
import { renderLibrary } from './library.js';
import { renderReader } from './reader.js';

applyPrefs();

// ---- event bus -------------------------------------------------------------------
const listeners = new Map();
export const bus = {
  on(evt, fn) { (listeners.get(evt) || listeners.set(evt, new Set()).get(evt)).add(fn); return () => listeners.get(evt)?.delete(fn); },
  emit(evt, data) { listeners.get(evt)?.forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); },
};

// ---- LLM status --------------------------------------------------------------------
export const llm = { status: null };
export async function refreshLlm() {
  try { llm.status = await api.get('/api/llm/status'); }
  catch { llm.status = { ok: false, error: 'Server unreachable', models: [] }; }
  bus.emit('llm', llm.status);
  return llm.status;
}

// ---- jobs poller ------------------------------------------------------------------
let jobs = [];
let pollTimer = null;
const known = new Map();
export const getJobs = () => jobs;

export async function pollJobs() {
  clearTimeout(pollTimer);
  try {
    jobs = await api.get('/api/jobs');
    for (const j of jobs) {
      const prev = known.get(j.id);
      if (prev !== j.status && ['done', 'error', 'cancelled'].includes(j.status)) bus.emit('job-finished', j);
      // Refresh as original text and optional character analysis become available.
      if (prev === 'running' && j.status === 'running' && known.get(`${j.id}:done`) !== j.done) bus.emit('job-progress', j);
      known.set(j.id, j.status);
      known.set(`${j.id}:done`, j.done);
    }
    bus.emit('jobs', jobs);
  } catch { /* server restarting */ }
  const active = jobs.some(j => j.status === 'running' || j.status === 'queued');
  pollTimer = setTimeout(pollJobs, active ? 1500 : 5000);
}

// ---- router -------------------------------------------------------------------------
const app = document.getElementById('app');
let current = null;

export function navigate(hash, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', hash); else location.hash = hash;
  if (replace) route();
}

async function route() {
  const hash = location.hash || '#/';
  const m = hash.match(/^#\/read\/(\d+)(?:\/(\d+))?/);
  // Same novel already open (e.g. browser back between chapters): let the reader handle it.
  if (m && current?.handle?.(Number(m[1]), m[2] ? Number(m[2]) : null)) return;
  closeAllLayers();
  if (current) { try { (current.destroy || current)(); } catch { /* ignore */ } current = null; }
  fill(app);
  window.scrollTo(0, 0);
  const view = m ? await renderReader(app, Number(m[1]), m[2] ? Number(m[2]) : null) : await renderLibrary(app);
  current = view || null;
}

window.addEventListener('hashchange', route);
async function start() {
  installDeviceStatus();
  if (isNativeApp() && !getConnection().origin) { fill(app, deviceWelcome()); return; }
  try { await api.get('/api/health'); } catch { /* Keep the saved library available with the PC off. */ }
  try { await api.get('/api/network'); }
  catch (e) {
    if (!isNativeApp() && (e.status === 401 || e.status === 403)) { fill(app, pairingRequired()); return; }
  }
  refreshLlm(); pollJobs(); route(); setInterval(refreshLlm, 30000);
  const reconnect = () => { if (document.visibilityState !== 'hidden') {
    api.get('/api/health').then(() => api.syncPending()).catch(() => {}); refreshLlm(); pollJobs();
  } };
  window.addEventListener('online', reconnect);
  document.addEventListener('visibilitychange', reconnect);
}
start();

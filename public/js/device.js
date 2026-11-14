import { api } from './api.js';
import { getConnection, isNativeApp, parsePairingLink, setConnection } from './connection.js';
import { h, icon, modal, toast, fill } from './ui.js';

export function deviceWelcome() {
  return h('main', { class: 'pairing-required device-welcome stack' },
    h('span', { class: 'brand-mark' }, icon('feather')), h('h1', null, 'Your stories, with you.'),
    h('p', null, 'Keep your Marginalia library, character cards and profiles on your iPhone or iPad, with the same reading experience.'),
    h('p', { class: 'hint' }, 'Connect to your PC once to save your stories. Saved chapters and profiles work with the PC off. Ask, recaps and new analysis use your PC while it is on.'),
    h('button', { class: 'btn primary lg', onclick: () => openDeviceSettings() }, icon('link'), 'Connect to my PC'));
}

async function connect(link) {
  const candidate = parsePairingLink(link);
  const ctrl = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { ctrl.abort(); reject(new DOMException('Connection timed out', 'AbortError')); }, 12000);
  });
  try {
    await Promise.race([timeout, (async () => {
    const headers = { 'content-type': 'application/json', 'X-Marginalia-Device': candidate.token };
    const paired = await fetch(`${candidate.origin}/api/network/pair`, {
      method: 'POST', headers, body: JSON.stringify({ token: candidate.token }), signal: ctrl.signal,
    });
    if (!paired.ok) throw new Error('This pairing link has expired. Copy the current link from your PC.');
    const health = await fetch(`${candidate.origin}/api/health`, { headers, signal: ctrl.signal });
    if (!health.ok) throw new Error('The PC could not confirm this library. Try the latest pairing link.');
    const info = await health.json();
    if (ctrl.signal.aborted) throw new DOMException('Connection timed out', 'AbortError');
    if (info.app !== 'marginalia-reader' || !info.library || !info.homeNetwork) throw new Error('This address is not your home-network Marginalia reader.');
    setConnection({ ...candidate, library: info.library });
    await api.setLibraryIdentity?.(info.library);
    })()]);
  } catch (e) {
    if (e.name === 'AbortError' || e instanceof TypeError) throw new Error('Cannot reach the PC. Keep it awake, start Marginalia, and connect both devices to the same home network. Allow Local Network access in iPhone/iPad Settings.');
    throw e;
  } finally { clearTimeout(timer); }
}

export async function openDeviceSettings() {
  const status = h('div', { class: 'callout', role: 'status' }, 'Checking saved data…');
  const link = h('input', { class: 'input', type: 'url', id: 'device-pair-link', placeholder: 'http://192.168.…:4380/connect#…',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: false });
  const feedback = h('p', { class: 'hint', role: 'status' });
  const connection = getConnection();
  const refreshStatus = async () => {
    const state = await api.deviceStatus();
    const savedCount = new Set(state.savedNovels.map(novel => novel.novelId)).size;
    fill(status, icon(state.online ? 'link' : 'book', 'sm'), h('span', null,
      !state.storageAvailable ? 'Device storage is unavailable. Free some space and reopen the app before saving.' :
      `${savedCount} ${savedCount === 1 ? 'story' : 'stories'} saved on this device. ${state.pending ? `${state.pending} profile ${state.pending === 1 ? 'change' : 'changes'} waiting to sync.` : 'No profile changes waiting to sync.'}`));
  };
  const body = h('div', { class: 'stack' },
    status,
    connection.origin ? h('p', { class: 'hint device-address' }, 'PC address: ', connection.origin) : null,
    h('p', null, 'On your PC, start Marginalia and open Read on iPad. Copy its full pairing link below. Both devices must be on the same home network.'),
    h('div', { class: 'field' }, h('label', { for: 'device-pair-link' }, 'PC pairing link'), link,
      h('span', { class: 'hint' }, 'The link changes whenever the PC reader restarts. Saved stories stay on this device when you reconnect to the same library.')),
    feedback,
    h('div', { class: 'divider' }),
    h('p', { class: 'hint' }, 'Use Save on device in a story’s Contents to save downloaded chapters and character profiles up to your current chapter. Opened chapters and profiles are also saved automatically. Profile appearance edits made offline sync when you reconnect.'),
    h('p', { class: 'hint' }, 'AI works while the PC is awake and Marginalia is running. Saved information remains available away from home. Removing the app also removes its saved data.'));
  modal({ title: 'PC & saved data', description: 'Your reading experience, saved on this device.', body,
    footer: close => [h('button', { class: 'btn', onclick: close }, 'Done'),
      h('button', { class: 'btn primary', onclick: async e => {
        const button = e.currentTarget;
        button.disabled = true; feedback.textContent = 'Connecting to your PC…';
        try {
          await connect(link.value);
          close(); toast('Connected to your PC');
          // Start fresh so an open story cannot keep IDs from another PC library.
          location.hash = '#/'; location.reload();
        } catch (error) { feedback.textContent = error.message; }
        finally { button.disabled = false; }
      } }, 'Connect')],
  });
  refreshStatus().catch(() => { status.textContent = 'Saved data could not be checked. Reopen the app to try again.'; });
}

export async function saveStoryOnDevice(novelId, chapter) {
  const message = h('p', { role: 'status' }, 'Saving downloaded chapters and profiles…');
  const ctrl = new AbortController();
  let finished = false;
  const cancelButton = h('button', { class: 'btn', onclick: () => { if (!finished) ctrl.abort(); closeDialog(); } }, 'Cancel');
  let closeDialog = () => {};
  modal({ title: 'Save on device', description: `Character profiles are saved as of Chapter ${chapter}.`,
    onClose: () => { if (!finished) ctrl.abort(); },
    body: h('div', { class: 'stack' }, message,
      h('p', { class: 'hint' }, 'Only chapters already downloaded on your PC are copied. This does not start AI analysis or fetch chapters from the source site. Earlier character profiles are saved separately when opened.')),
    footer: close => { closeDialog = close; return cancelButton; },
  });
  try {
    const result = await api.saveForOffline(novelId, { chapter, signal: ctrl.signal,
      onProgress: progress => { if (progress?.message) message.textContent = progress.message; } });
    message.textContent = `Saved on this device. Downloaded chapters through Chapter ${chapter} and character profiles as of that chapter are ready for offline use.`;
    toast('Story and profiles saved on device');
    return result;
  } catch (e) { message.textContent = e.name === 'AbortError' ? 'Saving cancelled.' : e.message; }
  finally { finished = true; cancelButton.textContent = 'Done'; }
}

export function installDeviceStatus() {
  if (!isNativeApp()) return;
  document.documentElement.dataset.deviceApp = 'true';
  const banner = h('button', { class: 'device-status', hidden: true, onclick: openDeviceSettings, 'aria-live': 'polite' });
  document.body.append(banner);
  let updateId = 0;
  const update = async () => {
    const id = ++updateId, state = await api.deviceStatus();
    if (id !== updateId) return;
    const message = state.storageError ? 'Device storage needs attention' : state.pairingRequired ? 'Reconnect PC · saved stories available' :
      !state.online ? state.pending ? `PC offline · ${state.pending} profile ${state.pending === 1 ? 'change' : 'changes'} saved` : 'PC offline · saved stories available' : state.pending ? `${state.pending} profile changes waiting to sync` : '';
    banner.hidden = !message || !getConnection().origin;
    banner.textContent = message;
  };
  window.addEventListener('marginalia:connection', () => update().catch(() => {}));
  update().catch(() => {});
}

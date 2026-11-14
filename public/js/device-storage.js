// Device copies are kept separately from the PC library. Profile snapshots are
// keyed by their exact chapter so an offline fallback cannot reveal later facts.
import { abilityKey, RANKS, sequenceRank } from './ranks.js';

const clone = value => value === undefined ? undefined : structuredClone(value);
const OFFLINE_FIELDS = new Set(['name', 'aliases', 'color', 'icon', 'description', 'hidden', 'customization', 'abilityOverrides', 'sequenceCorrection', 'chapter']);

export function cacheKey(value) {
  const url = new URL(value, 'http://marginalia.invalid');
  url.searchParams.delete('refresh');
  url.searchParams.sort();
  const query = url.searchParams.toString();
  return url.pathname.replace(/\/$/, '') + (query ? `?${query}` : '');
}

export function isCacheable(value) {
  const url = new URL(value, 'http://marginalia.invalid');
  if (/^\/api\/novels(?:\/\d+(?:\/chapters\/\d+)?)?$/.test(url.pathname)) return true;
  if (/^\/api\/(?:novels\/\d+\/characters|characters\/\d+)$/.test(url.pathname)) return /^[1-9]\d*$/.test(url.searchParams.get('chapter') || '');
  return url.pathname === '/api/network';
}

export function offlinePatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !OFFLINE_FIELDS.has(key))) throw new Error('This change needs a connection to your PC.');
  const patch = clone(value);
  if (patch.name !== undefined && (typeof patch.name !== 'string' || !patch.name.trim())) throw new Error('A character needs a name.');
  if (patch.aliases !== undefined && (!Array.isArray(patch.aliases) || patch.aliases.some(alias => typeof alias !== 'string'))) throw new Error('Use text for character aliases.');
  if (patch.icon && (typeof patch.icon !== 'string' || patch.icon.length > 400000)) throw new Error('That image is too large.');
  if (patch.customization !== undefined && (!patch.customization || typeof patch.customization !== 'object' || Array.isArray(patch.customization))) throw new Error('Choose valid profile styling.');
  if (patch.sequenceCorrection !== undefined && !/^Sequence [0-9]$/.test(patch.sequenceCorrection)) throw new Error('Choose a valid Sequence.');
  if (patch.abilityOverrides !== undefined && (!Array.isArray(patch.abilityOverrides) || patch.abilityOverrides.length > 300 || patch.abilityOverrides.some(a => !a || typeof a.name !== 'string' || !['auto', ...RANKS.map(r => r.id)].includes(a.rank) || !['auto', 'ability', 'item'].includes(a.kind)))) throw new Error('Choose valid ability ranks and types.');
  if ((patch.abilityOverrides !== undefined || patch.sequenceCorrection !== undefined) && (!Number.isSafeInteger(Number(patch.chapter)) || Number(patch.chapter) < 1)) throw new Error('Choose a chapter for your profile changes.');
  return patch;
}

export function overlayCharacter(character, patch, chapter) {
  const out = clone(character);
  for (const key of ['name', 'aliases', 'color', 'icon', 'description', 'hidden', 'customization']) if (patch[key] !== undefined) out[key] = clone(patch[key]);
  if (out.name) out.name = out.name.trim();
  out.locked = true;
  if (Number(patch.chapter) <= chapter && out.profile) {
    if (patch.abilityOverrides) {
      const overrides = new Map(patch.abilityOverrides.map(a => [abilityKey(a.name), a]));
      out.profile.abilityDetails = (out.profile.abilityDetails || []).map(a => {
        const o = overrides.get(abilityKey(a.name));
        if (!o) return a;
        const rank = o.rank === 'auto' ? a.originalRank || 'unranked' : o.rank;
        return { ...a, rank, kind: o.kind === 'auto' ? a.originalKind || 'ability' : o.kind,
          rankOverride: o.rank, kindOverride: o.kind, rankSource: o.rank === 'auto' ? rank === 'unranked' ? 'unknown' : 'story' : 'reader' };
      });
    }
    // Later confirmed states may supersede a correction. Apply locally only at
    // its actual cutoff; the PC recalculates all later views when it reconnects.
    if (patch.sequenceCorrection && Number(patch.chapter) === chapter) {
      out.profile.power = patch.sequenceCorrection;
      out.profile.sequence = sequenceRank({ name: patch.sequenceCorrection });
    }
  }
  return out;
}

export class DeviceStorage {
  constructor(indexedDB = globalThis.indexedDB) { this.indexedDB = indexedDB; this.database = null; this.error = null; }
  async open() {
    if (!this.indexedDB) throw new Error('Device storage is unavailable. Allow website storage to save an offline copy.');
    if (!this.database) this.database = new Promise((resolve, reject) => {
      const request = this.indexedDB.open('marginalia-device', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('records', { keyPath: 'key' });
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); this.database = null; };
        resolve(request.result);
      };
      request.onerror = () => reject(request.error || new Error('Could not open device storage.'));
      request.onblocked = () => reject(new Error('Close other Marginalia windows, then try saving again.'));
    }).catch(error => { this.database = null; this.error = error.message; throw error; });
    return this.database;
  }
  async get(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('records', 'readonly');
      const request = transaction.objectStore('records').get(key);
      request.onsuccess = () => resolve(request.result?.value);
      request.onerror = () => reject(request.error);
    });
  }
  async entries(prefix) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('records', 'readonly');
      const request = transaction.objectStore('records').openCursor();
      const rows = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return resolve(rows);
        if (cursor.key.startsWith(prefix)) rows.push({ key: cursor.key, value: cursor.value.value });
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  }
  async commit({ put = [], remove = [], signal } = {}) {
    if (signal?.aborted) throw new DOMException('Save cancelled.', 'AbortError');
    const db = await this.open();
    if (signal?.aborted) throw new DOMException('Save cancelled.', 'AbortError');
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('records', 'readwrite');
      const abort = () => { try { transaction.abort(); } catch { /* A completed transaction cannot be cancelled. */ } };
      signal?.addEventListener('abort', abort, { once: true });
      const records = transaction.objectStore('records');
      for (const record of put) records.put(record);
      for (const key of remove) records.delete(key);
      transaction.oncomplete = () => { signal?.removeEventListener('abort', abort); this.error = null; resolve(); };
      transaction.onabort = transaction.onerror = () => {
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) { reject(new DOMException('Save cancelled.', 'AbortError')); return; }
        this.error = transaction.error?.name === 'QuotaExceededError' ? 'Your device is full. Free some space, then save again.' : transaction.error?.message || 'Could not save on this device.';
        reject(new Error(this.error));
      };
    });
  }
}

export function createDeviceRepository(storage, scope) {
  let lastEditTime = 0;
  const prefix = () => `${scope()}\u0000`;
  const key = url => `${prefix()}cache:${cacheKey(url)}`;
  const checkScope = expected => {
    if (scope() !== expected) throw Object.assign(new Error('The PC connection changed. Try again from the current library.'), { status: 409, code: 'CONNECTION_CHANGED' });
  };
  const pending = async () => {
    const expected = scope(), records = await storage.entries(`${prefix()}edit:`);
    checkScope(expected);
    return records.map(record => ({ ...record.value, storageKey: record.key })).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  };

  function applyEdits(url, value, edits) {
    const path = new URL(url, 'http://marginalia.invalid');
    const chapter = Number(path.searchParams.get('chapter'));
    if (!chapter || !/^\/api\/(?:characters\/\d+|novels\/\d+\/characters)$/.test(path.pathname)) return clone(value);
    const one = character => edits.filter(e => Number(e.characterId) === Number(character.id)).reduce((c, e) => overlayCharacter(c, e.body, chapter), character);
    return Array.isArray(value) ? value.map(one) : value ? one(value) : value;
  }

  return {
    storage,
    scope,
    pending,
    async cached(url, { offline = false } = {}) {
      const expected = scope();
      const record = await storage.get(key(url));
      checkScope(expected);
      if (record === undefined) return undefined;
      const edits = await pending(); checkScope(expected);
      if (offline && /^\/api\/novels(?:\/\d+)?$/.test(cacheKey(url))) {
        const project = async novel => {
          const base = `${prefix()}cache:/api/novels/${novel.id}/chapters/`;
          const rows = await storage.entries(base); checkScope(expected);
          const numbers = rows.map(r => Number(r.key.slice(base.length))).filter(Number.isSafeInteger).sort((a, b) => a - b);
          if (!numbers.length) return null;
          const saved = new Set(numbers), last = Number(novel.last_chapter) || numbers.at(-1);
          return { ...clone(novel), last_chapter: numbers.filter(n => n <= last).at(-1) || numbers[0],
            min_chapter: numbers[0], max_chapter: numbers.at(-1), chapters_fetched: numbers.length,
            ...(novel.chapters ? { chapters: novel.chapters.filter(c => saved.has(Number(c.number))) } : {}) };
        };
        if (Array.isArray(record)) return (await Promise.all(record.map(project))).filter(Boolean);
        return await project(record) || clone(record);
      }
      return applyEdits(url, record, edits);
    },
    async cache(url, value) {
      if (!isCacheable(url)) return;
      const expected = scope();
      const put = [{ key: key(url), value: clone(value) }];
      const parsed = new URL(url, 'http://marginalia.invalid');
      const chapter = parsed.searchParams.get('chapter');
      if (/^\/api\/novels\/\d+\/characters$/.test(parsed.pathname) && chapter && Array.isArray(value)) {
        for (const character of value) {
          const detailKey = key(`/api/characters/${character.id}?chapter=${chapter}`);
          const old = await storage.get(detailKey);
          checkScope(expected);
          // Lists have no timeline; keep an existing full card when possible.
          put.push({ key: detailKey, value: { ...clone(character), timeline: old?.timeline || [] } });
        }
      }
      await storage.commit({ put });
      checkScope(expected);
    },
    async saveSnapshot(snapshot, { signal } = {}) {
      const expected = scope();
      if (signal?.aborted) throw new DOMException('Save cancelled.', 'AbortError');
      const cutoff = Number(snapshot.chapter), novelId = Number(snapshot.novel?.id);
      if (!Number.isSafeInteger(cutoff) || cutoff < 1 || !Number.isSafeInteger(novelId) || !Array.isArray(snapshot.chapters) || !Array.isArray(snapshot.characters) || !Array.isArray(snapshot.profiles)) throw new Error('The PC returned an incomplete device copy.');
      const novel = clone(snapshot.novel);
      novel.chapters = (novel.chapters || []).filter(c => Number(c.number) <= cutoff);
      novel.last_chapter = Math.min(Number(novel.last_chapter) || cutoff, cutoff);
      const existing = await storage.get(key('/api/novels')) || [];
      checkScope(expected);
      const shelf = existing.filter(n => n.id !== novelId);
      shelf.unshift(novel);
      const put = [{ key: key('/api/novels'), value: shelf }, { key: key(`/api/novels/${novelId}`), value: novel },
        { key: `${prefix()}saved:${novelId}:${cutoff}`, value: { novelId, title: novel.title, chapter: cutoff, savedAt: snapshot.savedAt || Date.now(), chapters: snapshot.chapters.filter(c => c.number <= cutoff).length, characters: snapshot.characters.length } },
        { key: key(`/api/novels/${novelId}/characters?chapter=${cutoff}`), value: snapshot.characters.filter(c => !c.firstChapter || c.firstChapter <= cutoff) }];
      for (const chapter of snapshot.chapters) if (Number.isSafeInteger(chapter.number) && chapter.number <= cutoff && chapter.number >= 1) put.push({ key: key(`/api/novels/${novelId}/chapters/${chapter.number}`), value: clone(chapter) });
      for (const profile of snapshot.profiles) if (!profile.firstChapter || profile.firstChapter <= cutoff) {
        put.push({ key: key(`/api/characters/${profile.id}?chapter=${cutoff}`), value: { ...clone(profile), timeline: (profile.timeline || []).filter(t => t.chapter <= cutoff) } });
      }
      // One transaction means a failed/full device never reports a partial copy.
      if (signal?.aborted) throw new DOMException('Save cancelled.', 'AbortError');
      await storage.commit({ put, signal });
      checkScope(expected);
      return { novelId, chapter: cutoff, chapters: snapshot.chapters.filter(c => c.number <= cutoff).length, characters: snapshot.characters.length };
    },
    async queue(url, body) {
      const expected = scope();
      const match = cacheKey(url).match(/^\/api\/characters\/(\d+)$/);
      if (!match) throw new Error('This change needs a connection to your PC.');
      const patch = offlinePatch(body);
      const rows = await storage.entries(`${prefix()}cache:/api/`);
      checkScope(expected);
      const exists = rows.some(r => r.key.startsWith(`${prefix()}cache:/api/characters/${match[1]}?`) || Array.isArray(r.value) && r.value.some(c => Number(c.id) === Number(match[1]) && c.profile));
      if (!exists) throw new Error('Open or save this character while your PC is on before editing offline.');
      const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const preciseTime = globalThis.performance ? performance.timeOrigin + performance.now() : Date.now();
      lastEditTime = Math.max(preciseTime, lastEditTime + 0.001);
      const entry = { id, url: cacheKey(url), characterId: Number(match[1]), body: patch, createdAt: lastEditTime };
      await storage.commit({ put: [{ key: `${prefix()}edit:${id}`, value: entry }] });
      checkScope(expected);
      return { id, queued: true, pendingSync: true };
    },
    async acceptEdit(edit, response) {
      const expected = scope();
      const rows = await storage.entries(`${prefix()}cache:/api/`);
      checkScope(expected);
      const put = rows.map(row => ({ key: row.key, value: applyEdits(row.key.slice(`${prefix()}cache:`.length), row.value, [edit]) }));
      if (edit.body.chapter && response?.id) put.push({ key: key(`/api/characters/${response.id}?chapter=${edit.body.chapter}`), value: response });
      await storage.commit({ put, remove: [edit.storageKey] });
      checkScope(expected);
    },
    async invalidateCharacter(id) {
      const expected = scope();
      const rows = await storage.entries(`${prefix()}cache:/api/`);
      checkScope(expected);
      const put = [], remove = [];
      for (const row of rows) {
        const url = row.key.slice(`${prefix()}cache:`.length);
        if (url.startsWith(`/api/characters/${id}?`)) remove.push(row.key);
        else if (/^\/api\/novels\/\d+\/characters\?/.test(url) && Array.isArray(row.value)) put.push({ key: row.key, value: row.value.filter(c => Number(c.id) !== Number(id)) });
      }
      for (const edit of await pending()) if (Number(edit.characterId) === Number(id)) remove.push(edit.storageKey);
      checkScope(expected);
      await storage.commit({ put, remove });
      checkScope(expected);
    },
    async invalidateNovel(id) {
      const expected = scope();
      const rows = await storage.entries(prefix());
      checkScope(expected);
      const base = `/api/novels/${id}`, characterIds = new Set();
      for (const row of rows) if (row.key.startsWith(`${prefix()}cache:${base}/characters?`) && Array.isArray(row.value)) for (const c of row.value) characterIds.add(Number(c.id));
      const put = [], remove = [];
      for (const row of rows) {
        const url = row.key.slice(`${prefix()}cache:`.length);
        if (url === '/api/novels') put.push({ key: row.key, value: row.value.filter(n => Number(n.id) !== Number(id)) });
        else if (url === base || url.startsWith(`${base}/`) || row.key.startsWith(`${prefix()}saved:${id}:`)) remove.push(row.key);
        else if (/^\/api\/characters\/\d+\?/.test(url) && characterIds.has(Number(url.match(/\/characters\/(\d+)/)[1]))) remove.push(row.key);
        else if (row.key.startsWith(`${prefix()}edit:`) && characterIds.has(Number(row.value.characterId))) remove.push(row.key);
      }
      await storage.commit({ put, remove });
      checkScope(expected);
    },
    async saved() {
      const expected = scope(), rows = await storage.entries(`${prefix()}saved:`);
      checkScope(expected); return rows.map(r => r.value);
    },
    async status() {
      try { return { storageAvailable: true, storageError: storage.error || null, pending: (await pending()).length, savedNovels: await this.saved() }; }
      catch (error) { return { storageAvailable: false, storageError: error.message, pending: 0, savedNovels: [] }; }
    },
  };
}

// Native reading uses the device's internet connection; no PC credentials go to source sites.
const failure = (message, code = 'FETCH_FAILED', sourceUrl) => Object.assign(new Error(message), { status: 422, code, sourceUrl });
export function chapterSourceUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw failure('Set a valid chapter link in Novel settings.', 'NO_URL'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw failure('Use an HTTPS chapter link.', 'NO_URL');
  return url.href;
}

export async function downloadChapter(url, { fetchPage, extract } = {}) {
  url = chapterSourceUrl(url);
  let page;
  try { page = await (fetchPage || nativePage)(url); }
  catch { throw failure('Cannot reach the chapter site. Check this device’s internet connection; saved chapters still work.', 'FETCH_FAILED', url); }
  const finalUrl = chapterSourceUrl(page.url || url);
  const html = page.html || '';
  const title = html.match(/<title[^>]*>([^<]*)/i)?.[1] || '';
  if ([401, 403, 429, 503].includes(page.status) || /^(just a moment|attention required|access denied|security check|please wait|verifying you are human|ddos-guard)/i.test(title.trim())) {
    throw failure('This site requires its own browser or blocks automated reading. Open the original chapter and paste its text into the reader.', 'BLOCKED', finalUrl);
  }
  if (page.status >= 400) throw failure(`The site responded with HTTP ${page.status}.`, 'FETCH_FAILED', finalUrl);
  if (html.length > 8000000) throw failure('This page is too large to read.', 'NO_CONTENT', finalUrl);
  const parser = extract || (await import('./chapter-extractor.js')).extractChapter;
  const data = parser(html, finalUrl);
  if (data.paragraphs.length < 3 || data.wordCount < 80) throw failure('The page loaded, but no chapter text was found. You can paste the text instead.', 'NO_CONTENT', finalUrl);
  return { ...data, url: finalUrl };
}

async function nativePage(url) {
  const headers = { Accept: 'text/html,application/xhtml+xml' };
  const http = globalThis.Capacitor?.Plugins?.CapacitorHttp;
  if (http) {
    const result = await http.get({ url, headers, responseType: 'text', connectTimeout: 20000, readTimeout: 20000 });
    return { status: result.status, html: result.data, url: result.url || url };
  }
  const response = await fetch(url, { headers, credentials: 'omit', signal: AbortSignal.timeout(20000) });
  return { status: response.status, html: await response.text(), url: response.url || url };
}

export function createDeviceReader(repository, { download = downloadChapter, parser = () => import('./chapter-extractor.js'), notify = () => {}, getAnalysis = async () => null, analyzeRange = async () => { throw new Error('Connect your PC to analyse these chapters.'); } } = {}) {
  const jobs = [], inflight = new Map();
  const scope = () => repository.scope();
  const key = (scope, suffix) => `${scope}\u0000reading:${suffix}`;
  const check = expected => { if (scope() !== expected) throw Object.assign(new Error('The library connection changed. Reopen this story.'), { status: 409 }); };
  const records = async () => {
    const expected = scope(), rows = await repository.storage.entries(key(expected, 'novel:')); check(expected);
    return rows.map(r => r.value);
  };
  async function novel(id) { return (await records()).find(n => n.id === Number(id)) || await repository.cached(`/api/novels/${id}`) || (await repository.cached('/api/novels') || []).find(n => n.id === Number(id)); }
  function mergeNovel(remote, device) {
    if (!device) return remote;
    const chapters = new Map((remote?.chapters || []).map(c => [c.number, c]));
    for (const c of device.chapters || []) chapters.set(c.number, { ...chapters.get(c.number), ...c, analyzed: chapters.get(c.number)?.analyzed || c.analyzed });
    return { ...remote, ...device, chapters: [...chapters.values()].sort((a, b) => a.number - b.number), chapters_analyzed: remote?.chapters_analyzed || 0, character_count: remote?.character_count || 0 };
  }
  async function merge(url, data) {
    if (url === '/api/novels') {
      const map = new Map(data.map(n => [n.id, n]));
      for (const n of await records()) map.set(n.id, mergeNovel(map.get(n.id), n));
      return [...map.values()].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    }
    const m = url.match(/^\/api\/novels\/(\d+)$/);
    return m ? mergeNovel(data, (await records()).find(n => n.id === +m[1])) : data;
  }
  async function save(novel, chapter) {
    const expected = scope();
    const metadata = new Map((novel.chapters || []).map(c => [c.number, c]));
    metadata.set(chapter.number, { number: chapter.number, title: chapter.title, url: chapter.url, word_count: chapter.wordCount, fetched: true, analyzed: !!chapter.analyzed });
    for (const [number, url] of [[chapter.number + 1, chapter.nextUrl], [chapter.number - 1, chapter.prevUrl]]) {
      if (number > 0 && url && !metadata.has(number)) metadata.set(number, { number, url, fetched: false, analyzed: false });
    }
    novel = { ...novel, chapters: [...metadata.values()].sort((a, b) => a.number - b.number), last_chapter: chapter.number, updated_at: Date.now(),
      min_chapter: Math.min(...metadata.keys()), max_chapter: Math.max(...metadata.keys()), chapters_fetched: [...metadata.values()].filter(c => c.fetched).length };
    const shelf = await repository.cached('/api/novels') || []; check(expected);
    const prefix = `${expected}\u0000`;
    await repository.storage.commit({ put: [
      { key: key(expected, `novel:${novel.id}`), value: novel },
      { key: key(expected, `pending:${novel.id}:${chapter.number}`), value: { novel, chapter } },
      { key: `${prefix}cache:/api/novels/${novel.id}`, value: novel },
      { key: `${prefix}cache:/api/novels/${novel.id}/chapters/${chapter.number}`, value: chapter },
      { key: `${prefix}cache:/api/novels`, value: [novel, ...shelf.filter(n => n.id !== novel.id)] },
    ] });
    check(expected); notify(); return chapter;
  }
  async function chapter(id, n, refresh = false) {
    const expected = scope(), token = `${expected}:${id}:${n}:${refresh}`;
    if (inflight.has(token)) return inflight.get(token);
    const promise = (async () => {
      const book = await novel(id); check(expected);
      if (!book) throw failure('Open this story once while connected to your PC, or add its chapter link on this device.', 'NO_URL');
      const cached = await repository.cached(`/api/novels/${id}/chapters/${n}`); check(expected);
      if (cached?.paragraphs?.length && !refresh) {
        try {
          const remote = await getAnalysis(id, n); check(expected);
          if (remote && JSON.stringify(remote.paragraphs) === JSON.stringify(cached.paragraphs)) {
            Object.assign(cached, { summary: remote.summary, keyEvents: remote.keyEvents, analyzed: remote.analyzed });
            await repository.cache(`/api/novels/${id}/chapters/${n}`, cached);
          }
        } catch { /* Reading never depends on AI or the PC. */ }
        // Reading progress stays on the device even if the PC has read further.
        const updated = { ...book, last_chapter: n };
        await repository.storage.commit({ put: [{ key: key(expected, `novel:${id}`), value: updated }] });
        return cached;
      }
      // A PDF/imported PC copy is a reading source too. Cache it without queuing
      // it back to the PC, and keep progress local to this device.
      if (!refresh) {
        let remote;
        try { remote = await getAnalysis(id, n); } catch { /* Try the source when the PC is unavailable. */ }
        check(expected);
        if (remote?.number === n && Array.isArray(remote.paragraphs) && remote.paragraphs.length) {
          await repository.cache(`/api/novels/${id}/chapters/${n}`, remote);
          check(expected);
          await repository.storage.commit({ put: [{ key: key(expected, `novel:${id}`), value: { ...book, last_chapter: n } }] });
          return remote;
        }
      }
      const previous = await repository.cached(`/api/novels/${id}/chapters/${n - 1}`);
      const next = await repository.cached(`/api/novels/${id}/chapters/${n + 1}`); check(expected);
      const source = book.chapters?.find(c => c.number === n)?.url || previous?.nextUrl || next?.prevUrl || book.url_template?.replace('{n}', String(n));
      if (!source) throw failure(`No known link for Chapter ${n}. Set a URL pattern in Novel settings or paste its text.`, 'NO_URL');
      const data = await download(source); check(expected);
      if (data.detectedNumber && data.detectedNumber !== n) throw failure(`The site returned Chapter ${data.detectedNumber} instead of Chapter ${n}. Its link pattern may use page IDs; update the URL pattern.`, 'NO_CONTENT', source);
      return save(book, { ...data, number: n, title: data.title || `Chapter ${n}`, summary: null, keyEvents: [], analyzed: false, fetchedAt: Date.now(), hasPrev: n > 1, hasNext: true });
    })().finally(() => inflight.delete(token));
    inflight.set(token, promise); return promise;
  }
  async function handle(method, url, body = {}) {
    const parsed = new URL(url, 'https://reader.invalid'), path = parsed.pathname;
    const m = path.match(/^\/api\/novels\/(\d+)\/chapters\/(\d+)(\/text)?$/);
    if (method === 'GET' && m && !m[3]) return { handled: true, data: await chapter(+m[1], +m[2], parsed.searchParams.has('refresh')) };
    if (method === 'POST' && m?.[3]) {
      const book = await novel(+m[1]), { paragraphsFromText, extractChapter } = await parser();
      const data = body.html ? extractChapter(body.html, body.url || book.start_url) : { paragraphs: paragraphsFromText(body.text || '') };
      if (!book || !data.paragraphs.length) throw failure('Paste some chapter text first.', 'NO_CONTENT');
      return { handled: true, data: await save(book, { ...data, number: +m[2], title: body.title || data.title || `Chapter ${m[2]}`, url: body.url || book.chapters?.find(c => c.number === +m[2])?.url || null,
        wordCount: data.paragraphs.join(' ').split(/\s+/).length, analyzed: false, summary: null, keyEvents: [], hasPrev: +m[2] > 1, hasNext: true }) };
    }
    if (method === 'POST' && path === '/api/novels') {
      const expected = scope(), { detectUrlTemplate, slugTitle } = await parser();
      let data, warning;
      try { data = await download(body.url); }
      catch (e) {
        if (!['BLOCKED', 'NO_CONTENT', 'FETCH_FAILED'].includes(e.code)) throw e;
        data = { url: chapterSourceUrl(body.url), novelTitle: slugTitle(body.url) }; warning = e.message;
      }
      check(expected);
      const pattern = detectUrlTemplate(data.url), n = data.detectedNumber || pattern.number || 1;
      const same = (await records()).find(novel => novel.start_url === data.url || pattern.template && novel.url_template === pattern.template);
      check(expected);
      const id = same?.id || Date.now() * 1000 + Math.floor(Math.random() * 1000);
      const book = same || { id, title: data.novelTitle || 'Untitled story', source_host: new URL(data.url).host, start_url: data.url, url_template: pattern.template,
        chapters: [], chapters_analyzed: 0, character_count: 0, created_at: Date.now(), deviceOnly: true };
      if (warning) {
        const value = { ...book, last_chapter: n, chapters: [{ number: n, url: data.url, fetched: false, analyzed: false }] };
        await repository.storage.commit({ put: [{ key: key(expected, `novel:${id}`), value }] });
      } else await save(book, { ...data, number: n, analyzed: false, summary: null, keyEvents: [], hasPrev: n > 1, hasNext: true });
      return { handled: true, data: { novel: await novel(id), startChapter: n, warning } };
    }
    const im = path.match(/^\/api\/novels\/(\d+)\/import$/);
    if (method === 'POST' && im) {
      const from = Number(body.from), to = Number(body.to), expected = scope();
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to < from || to - from >= 500) throw failure('Choose a range of 1 to 500 chapters.');
      const job = { id: `device-${Date.now()}`, scope: expected, novelId: +im[1], type: 'import', phase: 'download', status: 'running', from, to, total: to - from + 1, done: 0, downloaded: 0, failed: 0, phaseTotal: to - from + 1, label: `Download Ch. ${from}–${to}`, message: 'Downloading on this device…' };
      jobs.push(job);
      void (async () => { try {
        for (let n = from; n <= to; n++) {
          if (job.status === 'cancelled') return;
          check(expected); await chapter(+im[1], n); job.done++; job.downloaded++; job.message = `Saved Chapter ${n} on this device`;
          if (n < to) await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if (body.analyze) {
          try { await analyzeRange(+im[1], from, to); job.message = 'Chapters saved; analysis queued on your PC'; }
          catch { job.message = 'Chapters saved on device. Connect your PC to analyse them.'; }
        }
        job.status = 'done';
      } catch (e) { job.status = 'error'; job.lastError = e.message; } notify(); })();
      return { handled: true, data: job };
    }
    if (method === 'DELETE' && path.startsWith('/api/jobs/device-')) { const job = jobs.find(j => j.id === path.split('/').at(-1)); if (job) job.status = 'cancelled'; return { handled: true, data: { ok: true } }; }
    const own = path.match(/^\/api\/novels\/(\d+)$/);
    if (own && method === 'GET') { const book = await novel(+own[1]); if (book?.deviceOnly) return { handled: true, data: book }; }
    if (own && method === 'PATCH') {
      const book = await novel(+own[1]);
      if (book) { const patch = {}; for (const field of ['title', 'author', 'icon', 'llm_context', 'wiki_url', 'wiki_ai']) if (body[field] !== undefined) patch[field] = body[field];
        for (const [input, output] of [['llmContext', 'llm_context'], ['wikiUrl', 'wiki_url'], ['wikiAI', 'wiki_ai']]) if (body[input] !== undefined) patch[output] = body[input];
        if (body.urlTemplate !== undefined) { if (body.urlTemplate) chapterSourceUrl(body.urlTemplate.replace('{n}', '1')); patch.url_template = body.urlTemplate; }
        const value = { ...book, ...patch }; await repository.storage.commit({ put: [{ key: key(scope(), `novel:${book.id}`), value }] }); return { handled: true, data: value }; }
    }
    if (own && method === 'DELETE') {
      const expected = scope(), rows = await repository.storage.entries(key(expected, '')); check(expected);
      await repository.invalidateNovel(+own[1]); check(expected);
      await repository.storage.commit({ remove: rows.filter(r => r.key === key(expected, `novel:${own[1]}`) || r.key.startsWith(key(expected, `pending:${own[1]}:`))).map(r => r.key) });
      return { handled: true, data: { ok: true } };
    }
    return { handled: false };
  }
  async function sync(transport, library) {
    const expected = scope(), pending = await repository.storage.entries(key(expected, 'pending:')); check(expected);
    for (const row of pending) {
      await transport('POST', '/api/device/chapter', { ...row.value, library }); check(expected);
      const current = await repository.storage.get(row.key); check(expected);
      if (JSON.stringify(current) === JSON.stringify(row.value)) await repository.storage.commit({ remove: [row.key] });
      const book = await novel(row.value.novel.id); check(expected);
      if (book?.deviceOnly) await repository.storage.commit({ put: [{ key: key(expected, `novel:${book.id}`), value: { ...book, deviceOnly: false } }] });
    }
  }
  return { handle, merge, novel, records, sync, jobs: () => jobs.filter(j => j.scope === scope()), hasPending: async () => (await repository.storage.entries(key(scope(), 'pending:'))).length > 0 };
}

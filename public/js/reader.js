// Reader view: chapter text with character marks, contents drawer, typography, companion panel.
import { api, prefs, local } from './api.js';
import { h, icon, toast, modal, layer, place, confirmDialog, fmt, hasLayer, closeAllLayers, fill, novelIcon } from './ui.js';
import { bus, navigate, pollJobs, getJobs } from './app.js';
import { buildMatcher, renderParagraph, renderProse, openCharacterCard, EMOJI, squareImage } from './characters.js';
import { createCompanion } from './companion.js';
import { openSettings, openCaptureGuide } from './settings.js';
import { wikiForNovel, openWiki } from './wiki.js';
import { jobProgressText } from './job-status.js';
import { isNativeApp } from './connection.js';
import { openDeviceSettings, saveStoryOnDevice } from './device.js';

export async function renderReader(root, novelId, startN) {
  let novel;
  try { novel = await api.get(`/api/novels/${novelId}`); }
  catch (e) { toast(e.message, { type: 'error' }); navigate('#/'); return () => {}; }

  let n = startN || novel.last_chapter || novel.chapters[0]?.number || 1;
  let chapter = null;          // current chapter payload
  let characters = [];
  let matcher = null;
  let loadSeq = 0;
  const savedPos = local.get(`pos.${novel.id}`);
  // On narrow screens the panel overlays the text, so it starts closed there.
  let panelOpen = prefs.panelOpen && window.innerWidth > 1100;

  // ---------------------------------------------------------------- layout
  const tNovel = h('div', { class: 't-novel' });
  const drawTitle = () => fill(tNovel, novelIcon(novel, 'xs'), novel.title);
  drawTitle();
  const tChapter = h('div', { class: 't-chapter' }, `Chapter ${n}`);
  const prevBtn = h('button', { class: 'icon-btn', 'aria-label': 'Previous chapter', title: 'Previous chapter (←)', onclick: () => go(n - 1) }, icon('left'));
  const nextBtn = h('button', { class: 'icon-btn', 'aria-label': 'Next chapter', title: 'Next chapter (→)', onclick: () => go(n + 1) }, icon('right'));
  const jobInd = h('button', { class: 'job-indicator', hidden: true, onclick: () => openDrawer() });
  const typeBtn = h('button', { class: 'icon-btn', 'aria-label': 'Reading settings', title: 'Reading settings', onclick: () => openTypography() }, icon('type'));
  const panelBtn = h('button', { class: `icon-btn ${panelOpen ? 'active' : ''}`, 'aria-label': 'Toggle companion', title: 'Companion', onclick: () => togglePanel() }, icon('sparkles'));
  const progress = h('div', { class: 'read-progress' });

  const topbar = h('header', { class: 'topbar' },
    h('div', { class: 'left' },
      h('button', { class: 'icon-btn', 'aria-label': 'Library', title: 'Library', onclick: () => navigate('#/') }, icon('back')),
      h('button', { class: 'icon-btn', 'aria-label': 'Contents', title: 'Contents', onclick: () => openDrawer() }, icon('list'))),
    h('div', { class: 'center' }, tNovel, tChapter),
    h('div', { class: 'right' }, jobInd, h('span', { class: 'hide-sm', style: { display: 'contents' } }, prevBtn, nextBtn), h('button', { class: 'icon-btn', title: 'Wiki reference', 'aria-label': 'Wiki reference', onclick: () => openWiki(novel) }, icon('book')), h('span', { class: 'vsep hide-sm' }), typeBtn, panelBtn),
    progress);

  const inner = h('div', { class: 'page-inner' });
  const page = h('main', { class: 'page', tabindex: -1 }, inner);
  const body = h('div', { class: 'reader-body' }, page);
  const shell = h('div', { class: `reader ${panelOpen ? 'with-panel' : ''}` }, topbar, body);
  root.append(shell);

  const companion = createCompanion({
    novel: () => novel,
    chapter: () => n,
    chapterData: () => chapter,
    characters: () => characters,
    onNavigate: (num, quote) => go(num, { quote }),
    onCharactersChanged: () => refreshCharacters(),
    close: () => togglePanel(false),
    open: () => { if (!panelOpen) togglePanel(true); },
  });
  if (panelOpen) { body.append(companion.el); companion.render(); }

  function togglePanel(force) {
    const open = force ?? !panelOpen;
    panelOpen = open;
    if (window.innerWidth > 1100) prefs.set({ panelOpen: open });
    shell.classList.toggle('with-panel', open);
    panelBtn.classList.toggle('active', open);
    if (open) { body.append(companion.el); companion.render(); } else companion.el.remove();
  }

  // ---------------------------------------------------------------- chapter loading
  function chapterLabel(c) {
    const raw = c?.title || `Chapter ${n}`;
    const stripped = raw.replace(/^(chapter|ch\.?)\s*\d+\s*[:.\-–—]?\s*/i, '').trim();
    return { eyebrow: `Chapter ${n}`, title: stripped || `Chapter ${n}` };
  }

  function skeleton() {
    fill(inner, 
      h('div', { class: 'chapter-head' }, h('div', { class: 'skeleton', style: { width: '90px', height: '11px', margin: '0 auto 16px' } }), h('div', { class: 'skeleton', style: { width: '62%', height: '30px', margin: '0 auto' } })),
      h('div', { class: 'loading-prose' }, Array.from({ length: 14 }, (_, i) => h('div', { class: 'skeleton', style: { width: `${i % 5 === 4 ? 55 : 92 + (i % 3) * 3}%` } }))));
  }

  async function load(num, { refresh = false, restore = false } = {}) {
    const seq = ++loadSeq;
    n = num;
    chapter = null;
    tChapter.textContent = `Chapter ${n}`;
    prevBtn.disabled = n <= 1;
    history.replaceState(null, '', `#/read/${novel.id}/${n}`);
    skeleton();
    page.scrollTop = 0;
    companion.chapterChanged();

    const [chRes, csRes] = await Promise.allSettled([
      api.get(`/api/novels/${novel.id}/chapters/${n}${refresh ? '?refresh=1' : ''}`),
      api.get(`/api/novels/${novel.id}/characters?chapter=${n}`),
    ]);
    if (seq !== loadSeq) return;
    if (csRes.status === 'fulfilled') { characters = csRes.value; matcher = buildMatcher(characters); }
    if (chRes.status === 'rejected') { renderError(chRes.reason); refreshNovel(); companion.chapterChanged(); return; }
    chapter = chRes.value;
    renderChapter();
    if (restore && savedPos?.n === n && savedPos.ratio > 0.01) {
      requestAnimationFrame(() => { page.scrollTop = savedPos.ratio * (page.scrollHeight - page.clientHeight); });
    }
    companion.chapterChanged();
    refreshNovel();
    setTimeout(pollJobs, 400); // the server may have queued analysis
  }

  async function go(num, { quote } = {}) {
    if (num < 1) return;
    closeAllLayers();
    if (num !== n || !chapter) await load(num);
    if (quote && chapter?.number === num) {
      const compact = text => text.replace(/\s+/g, ' ').trim();
      const target = [...inner.querySelectorAll('.prose p')].find(p => {
        const copy = p.cloneNode(true);
        copy.querySelectorAll('.avatar').forEach(a => a.remove());
        return compact(copy.textContent).includes(compact(quote));
      });
      inner.querySelectorAll('.evidence-target').forEach(p => p.classList.remove('evidence-target'));
      if (target) {
        target.classList.add('evidence-target');
        if (window.innerWidth <= 1100) togglePanel(false);
        target.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      } else toast('Chapter opened. The supporting quote is available in the companion’s sources.');
    }
  }

  function renderChapter() {
    const c = chapter;
    const { eyebrow, title } = chapterLabel(c);
    tChapter.textContent = title === eyebrow ? eyebrow : `${eyebrow} · ${title}`;
    document.title = `${title} — ${novel.title}`;
    const known = novel.chapters.find(x => x.number === n + 1);
    const nextTitle = known?.title ? chapterLabel(known).title : null;

    const prose = h('article', { class: 'prose', dataset: { font: prefs.font, align: prefs.align, marks: prefs.marks, dialogue: prefs.dialogue } });
    const onMention = (cid, el) => openCharacterCard(cid, el, companion.cardCtx());
    if (prefs.dialogue === 'separate') prose.append(...renderProse(c.paragraphs, matcher, onMention));
    else for (const p of c.paragraphs) prose.append(renderParagraph(p, matcher, onMention));

    const here = characters.filter(x => x.inChapter && !x.hidden).length;
    fill(inner, 
      h('header', { class: 'chapter-head' },
        h('span', { class: 'eyebrow' }, eyebrow),
        h('h1', null, title),
        h('div', { class: 'meta' },
          h('span', null, icon('clock', 'sm'), `${fmt.minutes(c.wordCount)} min read`),
          h('span', null, `${fmt.num(c.wordCount)} words`),
          here ? h('span', null, icon('users', 'sm'), `${here} character${here === 1 ? '' : 's'}`) : null),
        h('div', { class: 'ornament' })),
      prose,
      h('footer', { class: 'chapter-foot' },
        h('button', { class: 'next-card', onclick: () => go(n + 1) },
          h('div', { class: 'grow' }, h('span', { class: 'nc-label' }, 'Next · Chapter ' + (n + 1)), h('span', { class: 'nc-title' }, nextTitle || 'Continue reading')),
          icon('arrowRight', 'lg')),
        h('div', { class: 'foot-actions' },
          n > 1 ? h('button', { class: 'btn sm ghost', onclick: () => go(n - 1) }, icon('left', 'sm'), 'Previous') : null,
          c.url ? h('a', { class: 'btn sm ghost', href: c.url, target: '_blank', rel: 'noopener noreferrer' }, icon('external', 'sm'), 'Original') : null,
          h('button', { class: 'btn sm ghost', onclick: () => load(n, { refresh: true }) }, icon('refresh', 'sm'), 'Re-fetch'),
          h('button', { class: 'btn sm ghost', onclick: () => openPaste() }, icon('clipboard', 'sm'), 'Replace text'))),
    );
    onScroll();
  }

  // Re-render prose in place (after characters change) without losing scroll position.
  function rerenderProse() {
    if (!chapter) return;
    const ratio = page.scrollTop / Math.max(1, page.scrollHeight - page.clientHeight);
    renderChapter();
    page.scrollTop = ratio * (page.scrollHeight - page.clientHeight);
  }

  function renderError(e) {
    const blocked = e.code === 'BLOCKED';
    const noUrl = e.code === 'NO_URL';
    tChapter.textContent = `Chapter ${n}`;
    const actions = [];
    if (noUrl) {
      actions.push(h('button', { class: 'btn primary', onclick: () => openNovelSettings() }, icon('link', 'sm'), 'Set URL pattern'));
    } else {
      actions.push(h('button', { class: 'btn primary', onclick: () => load(n, { refresh: true }) }, icon('refresh', 'sm'), 'Try again'));
      if (e.sourceUrl) actions.push(h('a', { class: 'btn', href: e.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('external', 'sm'), 'Open original'));
    }
    actions.push(h('button', { class: 'btn', onclick: openCaptureGuide }, icon('feather', 'sm'), 'Capture from browser'));
    actions.push(h('button', { class: 'btn', onclick: () => openPaste() }, icon('clipboard', 'sm'), 'Paste text'));
    if (n > 1) actions.push(h('button', { class: 'btn ghost', onclick: () => go(n - 1) }, icon('left', 'sm'), `Chapter ${n - 1}`));

    fill(inner, h('div', { class: 'state-card' },
      h('div', { class: 'sc-ico' }, icon(noUrl ? 'flag' : blocked ? 'shield' : 'alert')),
      h('h2', null, noUrl ? `Where does chapter ${n} live?` : blocked ? 'This site keeps readers to its own pages' : 'This chapter couldn’t be loaded'),
      h('p', null, noUrl
        ? 'Marginalia doesn’t know this chapter’s address yet. If the site’s links include the chapter number, set a URL pattern and every chapter becomes reachable. You can also paste the text, or capture it from your browser.'
        : blocked ? 'The site blocks automated access, and Marginalia respects that. Open the chapter in your browser and send it here with the capture button, or paste the text.' : e.message),
      h('div', { class: 'actions' }, actions)));
  }

  // ---------------------------------------------------------------- data refresh
  let refreshTimer = null;
  async function refreshNovel() {
    try { const fresh = await api.get(`/api/novels/${novel.id}`); novel = fresh; drawTitle(); companion.chapterDataChanged(); drawerApi?.refresh(); } catch { /* ignore */ }
  }
  async function refreshCharacters() {
    try {
      characters = await api.get(`/api/novels/${novel.id}/characters?chapter=${n}`);
      matcher = buildMatcher(characters);
      rerenderProse();
      companion.charactersChanged();
    } catch { /* ignore */ }
  }
  async function refreshChapterData() {
    if (!chapter) return;
    try {
      const c = await api.get(`/api/novels/${novel.id}/chapters/${n}`);
      if (c.number === n) { chapter = { ...chapter, summary: c.summary, keyEvents: c.keyEvents, analyzed: c.analyzed }; companion.chapterDataChanged(); }
    } catch { /* ignore */ }
  }

  const offFinished = bus.on('job-finished', (j) => {
    if (j.novelId !== novel.id) return;
    if (j.status === 'error') toast(j.message || 'A background task failed.', { type: 'error' });
    if (j.type === 'import' && j.status === 'done') toast(j.failed ? `${j.failed} steps skipped. Open Contents for details.` : `Chapter text ready for Ch. ${j.from}–${j.to}${j.analyze ? '; character analysis complete' : ''}.`, { type: j.failed ? 'error' : 'success' });
    refreshNovel(); refreshCharacters(); refreshChapterData();
  });
  const offProgress = bus.on('job-progress', (j) => {
    if (j.novelId !== novel.id) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { refreshNovel(); refreshCharacters(); }, 600);
  });
  const offJobs = bus.on('jobs', (jobs) => {
    const mine = jobs.filter(j => j.novelId === novel.id && ['running', 'queued'].includes(j.status));
    jobInd.hidden = !mine.length;
    if (mine.length) {
      const j = mine.find(x => x.status === 'running' && x.phase === 'download') || mine.find(x => x.status === 'running') || mine[0];
      fill(jobInd, h('span', { class: 'spinner', style: { width: '13px', height: '13px' } }), h('span', null, jobProgressText(j)));
      jobInd.title = j.label;
    }
    drawerApi?.renderJobs(jobs);
  });

  // ---------------------------------------------------------------- scroll & keys
  let saveTimer = null;
  function onScroll() {
    const max = page.scrollHeight - page.clientHeight;
    const ratio = max > 0 ? page.scrollTop / max : 0;
    progress.style.width = `${(ratio * 100).toFixed(2)}%`;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => local.set(`pos.${novel.id}`, { n, ratio }), 250);
  }
  page.addEventListener('scroll', onScroll, { passive: true });

  function onKey(e) {
    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (hasLayer('modal-wrap')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(n + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(n - 1); }
    else if (e.key === '/') { e.preventDefault(); if (!panelOpen) togglePanel(true); companion.focusInput(); }
  }
  document.addEventListener('keydown', onKey);

  // ---------------------------------------------------------------- typography popover
  function openTypography() {
    if (hasLayer('type-pop')) { closeAllLayers(); return; }
    const el = h('div', { class: 'type-pop', role: 'dialog', 'aria-label': 'Reading settings' });
    const seg = (key, options) => h('div', { class: 'segmented' }, options.map(([v, label]) => h('button', { class: prefs[key] === v ? 'on' : '', onclick: () => { prefs.set({ [key]: v }); apply(); draw(); } }, label)));
    const apply = () => {
      const p = inner.querySelector('.prose');
      if (p) Object.assign(p.dataset, { font: prefs.font, align: prefs.align, marks: prefs.marks });
    };
    const stepper = (key, min, max, step, format) => h('div', { class: 'range-row' },
      h('button', { class: 'icon-btn', 'aria-label': 'Decrease', onclick: () => { prefs.set({ [key]: Math.max(min, +(prefs[key] - step).toFixed(2)) }); draw(); } }, icon('left', 'sm')),
      h('input', { type: 'range', min, max, step, value: prefs[key], 'aria-label': key, oninput: (e) => { prefs.set({ [key]: Number(e.target.value) }); out.textContent = format(prefs[key]); } }),
      h('button', { class: 'icon-btn', 'aria-label': 'Increase', onclick: () => { prefs.set({ [key]: Math.min(max, +(prefs[key] + step).toFixed(2)) }); draw(); } }, icon('right', 'sm')));
    let out;
    const draw = () => {
      const theme = (id, label, bg, fg) => h('button', { class: `theme-sw ${prefs.theme === id ? 'on' : ''}`, style: { background: bg, color: fg }, onclick: () => { prefs.set({ theme: id }); draw(); } }, 'Aa', h('small', null, label));
      fill(el, 
        h('div', { class: 'themes' }, theme('paper', 'Paper', '#F6F2EA', '#2A2520'), theme('sepia', 'Sepia', '#EFE4CC', '#3B2F22'), theme('night', 'Night', '#141517', '#E3DED5')),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Typeface'), seg('font', [['serif', 'Literata'], ['classic', 'Georgia'], ['sans', 'Inter']])),
        h('div', { class: 'field' }, h('span', { class: 'label row', style: { justifyContent: 'space-between' } }, 'Text size', out = h('output', null, `${prefs.size}px`)), stepper('size', 14, 28, 1, (v) => `${v}px`)),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Line spacing'), seg('leading', [[1.55, 'Compact'], [1.75, 'Comfort'], [1.95, 'Airy']])),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Page width'), seg('measure', [[34, 'Narrow'], [40, 'Medium'], [48, 'Wide']])),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Alignment'), seg('align', [['left', 'Ragged'], ['justify', 'Justified']])),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Character marks'), seg('marks', [['first', 'Icons'], ['all', 'Every'], ['underline', 'Subtle'], ['off', 'Off']]),
          h('span', { class: 'hint' }, prefs.marks === 'first' ? 'An icon on the first mention in each paragraph.' : prefs.marks === 'all' ? 'An icon on every mention.' : prefs.marks === 'underline' ? 'A dotted underline only — still clickable.' : 'Plain text, no character links.')),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Dialogue'),
          h('div', { class: 'segmented' }, [['inline', 'In the text'], ['separate', 'Separated']].map(([v, label]) => h('button', { class: prefs.dialogue === v ? 'on' : '', onclick: () => { prefs.set({ dialogue: v }); rerenderProse(); draw(); } }, label))),
          h('span', { class: 'hint' }, prefs.dialogue === 'separate' ? 'Spoken lines get their own block with the speaker\u2019s icon. Speakers are guessed from the text around each line.' : 'Dialogue flows with the rest of the text.')),
      );
    };
    draw();
    layer(el, { dismissOnOutside: true, anchor: typeBtn });
    place(el, typeBtn, { align: 'end' });
  }

  // ---------------------------------------------------------------- contents drawer
  let drawerApi = null;
  function openDrawer() {
    let entry;
    const scrim = h('div', { class: 'scrim', onclick: () => entry.close() });
    const list = h('div', { class: 'toc', role: 'list' });
    const filter = h('input', { class: 'input', type: 'search', placeholder: 'Find a chapter by number or title', 'aria-label': 'Find chapter' });
    const jobsBox = h('div', { class: 'stack', style: { gap: '8px' } });
    const fromIn = h('input', { class: 'input', type: 'number', min: 1, value: 1, 'aria-label': 'From chapter', style: { width: '84px' } });
    const toIn = h('input', { class: 'input', type: 'number', min: 1, value: Math.max(n, 1), 'aria-label': 'To chapter', style: { width: '84px' } });
    const analyzeIn = h('input', { type: 'checkbox', checked: false });
    const sub = h('div', { class: 'sub' });

    const drawList = () => {
      const q = filter.value.trim().toLowerCase();
      const rows = novel.chapters.filter(c => !q || String(c.number) === q || (c.title || '').toLowerCase().includes(q));
      fill(list, ...rows.map(c => h('button', { role: 'listitem', class: `toc-item ${c.number === n ? 'current' : ''} ${c.fetched ? '' : 'unfetched'}`, onclick: () => { entry.close(); go(c.number); } },
        h('span', { class: 'num' }, c.number),
        h('span', { class: 'ttl' }, c.title ? chapterLabel(c).title : c.fetched ? `Chapter ${c.number}` : 'Not downloaded yet'),
        h('span', { class: `status-dot ${c.analyzed ? 'analyzed' : c.fetched ? 'fetched' : ''}`, title: c.analyzed ? 'Analysed' : c.fetched ? 'Downloaded' : 'Known link' }))));
      if (/^\d+$/.test(q) && !rows.length) list.append(h('button', { class: 'toc-item', onclick: () => { entry.close(); go(Number(q)); } }, h('span', { class: 'num' }, q), h('span', { class: 'ttl' }, `Go to chapter ${q}`), icon('arrowRight', 'sm')));
      const fetched = novel.chapters.filter(c => c.fetched).length;
      const analysed = novel.chapters.filter(c => c.analyzed).length;
      sub.textContent = `${novel.source_host || 'Imported'} · ${fetched} downloaded · ${analysed} analysed`;
    };
    filter.addEventListener('input', drawList);
    filter.addEventListener('keydown', (e) => { if (e.key === 'Enter' && /^\d+$/.test(filter.value.trim())) { entry.close(); go(Number(filter.value.trim())); } });

    const renderJobs = (jobs = getJobs()) => {
      const mine = jobs.filter(j => j.novelId === novel.id && j.type === 'import');
      fill(jobsBox, ...mine.slice(-3).map(j => h('div', { class: 'job-card' },
        h('div', { class: 'row' }, h('span', { class: 'jc-title' }, j.label), ['running', 'queued'].includes(j.status)
          ? h('button', { class: 'btn sm ghost', onclick: async () => { await api.del(`/api/jobs/${j.id}`); pollJobs(); } }, 'Cancel')
          : h('span', { class: 'chip' }, j.status)),
        h('div', { class: 'progress' }, h('i', { style: { width: `${j.total ? Math.round((j.done / j.total) * 100) : 0}%` } })),
        h('div', { class: 'jc-msg' }, ['running', 'queued'].includes(j.status) ? jobProgressText(j) : j.lastError || j.message))));
    };

    const drawer = h('nav', { class: 'drawer', 'aria-label': 'Contents' },
      h('div', { class: 'drawer-head' },
        h('div', { class: 'grow' }, h('div', { class: 'eyebrow', style: { marginBottom: '6px' } }, 'Contents'), h('h2', null, novel.title), sub),
        h('button', { class: 'icon-btn', 'aria-label': 'Novel settings', title: 'Novel settings', onclick: () => { entry.close(); openNovelSettings(); } }, icon('edit')),
        h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => entry.close() }, icon('x'))),
      h('div', { class: 'drawer-tools' }, filter),
      list,
      h('div', { class: 'drawer-foot' },
        isNativeApp() ? h('div', { class: 'stack device-save-actions' },
          h('button', { class: 'btn', onclick: () => { entry.close(); saveStoryOnDevice(novel.id, n); } }, icon('download', 'sm'), 'Save on device'),
          h('button', { class: 'btn ghost', onclick: () => { entry.close(); openDeviceSettings(); } }, icon('link', 'sm'), 'PC & saved data')) : null,
        h('div', { class: 'label' }, 'Download context'),
        h('div', { class: 'hint' }, isNativeApp() ? 'Chapters download directly to this device. AI uses your PC when connected. Keep the app open while downloading.' : 'Downloaded text is ready for Ask and Recaps immediately. No chapter analysis needed.'),
        h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Ch.'), fromIn, h('span', { class: 'muted' }, 'to'), toIn,
          h('button', { class: 'btn primary grow', onclick: async () => {
            try { await api.post(`/api/novels/${novel.id}/import`, { from: Number(fromIn.value), to: Number(toIn.value), analyze: analyzeIn.checked }); pollJobs(); }
            catch (e) { toast(e.message, { type: 'error' }); }
          } }, icon('download', 'sm'), 'Start')),
        h('label', { class: 'switch' }, analyzeIn, h('span', { class: 'track' }), h('span', { class: 'hint', style: { color: 'var(--ink-2)' } }, 'Also analyse summaries & characters (slower, optional)')),
        jobsBox,
        h('div', { class: 'row', style: { justifyContent: 'space-between' } },
          h('div', { class: 'legend' }, h('span', null, h('i', { class: 'status-dot analyzed' }), 'Analysed'), h('span', null, h('i', { class: 'status-dot fetched' }), 'Downloaded'), h('span', null, h('i', { class: 'status-dot' }), 'Link only')),
          h('button', { class: 'icon-btn', title: 'Settings', 'aria-label': 'Settings', onclick: () => { entry.close(); openSettings(); } }, icon('settings', 'sm')))),
    );
    const wrap = h('div', null, scrim, drawer);
    entry = layer(wrap, { onClose: () => { drawerApi = null; } });
    drawerApi = { refresh: drawList, renderJobs };
    drawList();
    renderJobs();
    requestAnimationFrame(() => list.querySelector('.current')?.scrollIntoView({ block: 'center' }));
  }

  // ---------------------------------------------------------------- dialogs
  function openNovelSettings() {
    const wikiMode = h('select', { class: 'select', id: 'ns-wiki-ai' }, h('option', { value: 'confirmed', selected: novel.wiki_ai !== 'off' }, 'Confirmed chapters only (strict)'), h('option', { value: 'off', selected: novel.wiki_ai === 'off' }, 'Off'));
    const wiki = h('input', { class: 'input', id: 'ns-wiki', type: 'url', value: wikiForNovel(novel), placeholder: 'https://…/wiki/…' });
    const title = h('input', { class: 'input', id: 'ns-title', value: novel.title });
    const author = h('input', { class: 'input', id: 'ns-author', value: novel.author || '', placeholder: 'Optional' });
    const tpl = h('input', { class: 'input', id: 'ns-tpl', value: novel.url_template || '', placeholder: 'https://site.com/novel/title/chapter-{n}', spellcheck: 'false' });
    const ctxIn = h('textarea', { class: 'textarea', id: 'ns-ctx', rows: 5, maxlength: 6000,
      placeholder: 'e.g. Cultivation ranks, lowest to highest: Qi Condensation, Foundation, Core, Nascent Soul. “Sunny” and “Lost from Light” are the same person. The narrator is unreliable.' }, novel.llm_context || '');

    // Icon picker: none / emoji / image.
    let iconVal = novel.icon || null;
    let mode = iconVal?.startsWith('data:') ? 'image' : iconVal ? 'emoji' : 'none';
    const preview = h('div', { class: 'ns-icon-preview' });
    const tabs = h('div', { class: 'segmented icon-tabs' });
    const pane = h('div');
    const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => fileIn.files[0] && loadImage(fileIn.files[0]) });
    const loadImage = async (file) => {
      try { iconVal = await squareImage(file, 192); draw(); }
      catch { toast('That image could not be read.', { type: 'error' }); }
    };
    const drawPreview = () => fill(preview,
      novelIcon({ icon: iconVal }, 'lg') || h('span', { class: 'novel-icon lg empty' }, icon('book')),
      h('span', { class: 'hint' }, iconVal ? 'Shown on the shelf cover and beside the title while you read.' : 'No icon. The shelf cover shows just the title.'));
    const draw = () => {
      drawPreview();
      fill(tabs, ...[['none', 'None'], ['emoji', 'Emoji'], ['image', 'Image']].map(([k, l]) => h('button', { class: mode === k ? 'on' : '', onclick: () => {
        mode = k;
        if (k === 'none') iconVal = null;
        if (k === 'emoji' && (!iconVal || iconVal.startsWith('data:'))) iconVal = '📖';
        if (k === 'image' && iconVal && !iconVal.startsWith('data:')) iconVal = null;
        draw();
      } }, l)));
      if (mode === 'none') fill(pane);
      else if (mode === 'emoji') {
        const custom = h('input', { class: 'input', placeholder: 'Or type or paste any emoji', 'aria-label': 'Custom emoji', style: { maxWidth: '240px' },
          oninput: () => {
            const first = [...new Intl.Segmenter().segment(custom.value.trim())][0]?.segment;
            if (first) { iconVal = first; drawPreview(); }
          } });
        fill(pane, h('div', { class: 'stack' },
          h('div', { class: 'emoji-grid' }, ['📖', '📚', '🏯', '🏰', '🌌', '🪐', ...EMOJI].map(e => h('button', { class: iconVal === e ? 'on' : '', onclick: () => { iconVal = e; draw(); } }, e))),
          custom));
      } else {
        const drop = h('div', { class: 'drop', tabindex: 0, role: 'button', onclick: () => fileIn.click(), onkeydown: (e) => { if (e.key === 'Enter') fileIn.click(); } },
          icon('upload'), h('span', null, iconVal ? 'Replace image' : 'Choose or drop an image'), h('span', { class: 'hint' }, 'Cropped to a square automatically'));
        drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('over'));
        drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) loadImage(f); });
        fill(pane, drop, fileIn);
      }
    };
    draw();

    modal({
      title: 'Novel settings', wide: true,
      body: h('div', { class: 'stack lg' },
        h('div', { class: 'row wrap', style: { gap: '14px' } },
          h('div', { class: 'field grow', style: { minWidth: '220px' } }, h('label', { for: 'ns-title' }, 'Title'), title),
          h('div', { class: 'field grow', style: { minWidth: '160px' } }, h('label', { for: 'ns-author' }, 'Author'), author)),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Icon'), preview, tabs, pane),
        h('div', { class: 'field' }, h('label', { for: 'ns-wiki' }, 'Wiki reference URL'), wiki, h('span', { class: 'hint' }, 'Fandom wikis are supported for AI lookup. Opening the full wiki can expose spoilers.')),
        h('div', { class: 'field' }, h('label', { for: 'ns-wiki-ai' }, 'AI wiki access'), wikiMode, h('span', { class: 'hint' }, 'Strict mode admits only sentences found verbatim in downloaded chapters up to the one you are reading. Paraphrases, unverified facts, and future details are excluded.')),
        h('div', { class: 'field' }, h('label', { for: 'ns-ctx' }, 'Notes for the model'), ctxIn,
          h('span', { class: 'hint' }, 'Background the companion should know about this novel: genre, power systems, who’s who, translation quirks. Added to questions, recaps and chapter analysis. Keep spoilers out, since the model treats these notes as known.')),
        h('div', { class: 'field' }, h('label', { for: 'ns-tpl' }, 'Chapter URL pattern'), tpl,
          h('span', { class: 'hint' }, 'Use ', h('b', null, '{n}'), ' where the chapter number goes. Detected automatically when possible; otherwise Marginalia follows each page’s “next” link.')),
      ),
      footer: (close) => [
        h('div', { class: 'left' }, h('button', { class: 'btn ghost danger', onclick: async () => {
          const ok = await confirmDialog({ title: `Remove “${novel.title}”?`, message: 'All downloaded chapters, summaries and character notes for this novel will be deleted.', confirmLabel: 'Remove', danger: true });
          if (!ok) return;
          await api.del(`/api/novels/${novel.id}`); close(); navigate('#/');
        } }, icon('trash', 'sm'), 'Remove')),
        h('button', { class: 'btn', onclick: close }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: async () => {
          try {
            await api.patch(`/api/novels/${novel.id}`, { title: title.value, author: author.value, urlTemplate: tpl.value, icon: iconVal, llmContext: ctxIn.value, wikiUrl: wiki.value, wikiAI: wikiMode.value });
            close(); toast('Saved', { type: 'success' }); await refreshNovel(); if (!chapter) load(n);
          } catch (e) { toast(e.message, { type: 'error' }); }
        } }, 'Save'),
      ],
    });
  }

  function openPaste() {
    const title = h('input', { class: 'input', id: 'pt-title', placeholder: `Chapter ${n}`, value: chapter?.title || '' });
    const text = h('textarea', { class: 'textarea', id: 'pt-text', rows: 12, placeholder: 'Paste the chapter text here. Paragraphs are detected from line breaks.' });
    modal({
      title: `Paste chapter ${n}`, wide: true,
      description: 'Use this for sites that can’t be read automatically, or to fix a chapter that came through incorrectly.',
      body: h('div', { class: 'stack' }, h('div', { class: 'field' }, h('label', { for: 'pt-title' }, 'Chapter title'), title), h('div', { class: 'field' }, h('label', { for: 'pt-text' }, 'Text'), text)),
      footer: (close) => [h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: async () => {
        if (!text.value.trim()) { text.focus(); return; }
        try { await api.post(`/api/novels/${novel.id}/chapters/${n}/text`, { title: title.value || null, text: text.value }); close(); load(n); }
        catch (e) { toast(e.message, { type: 'error' }); }
      } }, 'Save chapter')],
    });
  }

  // ---------------------------------------------------------------- go
  await load(n, { restore: true });

  return {
    handle(id, num) { if (id !== novel.id) return false; if (num && num !== n) load(num); return true; },
    destroy() {
      document.removeEventListener('keydown', onKey);
      offFinished(); offProgress(); offJobs();
      companion.destroy();
      document.title = 'Marginalia';
    },
  };
}

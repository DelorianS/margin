// Library: add a novel from a chapter URL, and a shelf of what you're reading.
import { api } from './api.js';
import { h, icon, toast, menu, confirmDialog, avatar, fmt, fill, novelIcon } from './ui.js';
import { navigate } from './app.js';
import { llmPill, openSettings, openCaptureGuide } from './settings.js';
import { openNetworkGuide } from './network.js';
import { isNativeApp } from './connection.js';
import { openDeviceSettings, saveStoryOnDevice } from './device.js';

const COVERS = [
  ['#3B2F2A', '#B4543A'], ['#1F3A4A', '#4C7FA8'], ['#2E3B2A', '#6E8B3D'], ['#3A2A45', '#8A5A9B'],
  ['#433316', '#C8963E'], ['#173A38', '#2F8F87'], ['#45202F', '#B0567A'], ['#262A4A', '#6A6FB5'],
];
const coverFor = (title) => { let x = 0; for (const c of title) x = (x * 33 + c.charCodeAt(0)) >>> 0; return COVERS[x % COVERS.length]; };

export async function renderLibrary(root) {
  const pill = llmPill();
  const top = h('header', { class: 'lib-top' },
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, icon('feather')), 'Marginalia'),
    h('div', { class: 'grow' }),
    pill,
    h('button', { class: 'btn sm', onclick: isNativeApp() ? openDeviceSettings : openNetworkGuide }, icon('link', 'sm'), isNativeApp() ? 'My PC' : 'Read on iPad'),
    h('button', { class: 'icon-btn', 'aria-label': 'Settings', title: 'Settings', onclick: openSettings }, icon('settings')));

  const input = h('input', { type: 'url', placeholder: 'Paste a chapter link — e.g. site.com/novel/title/chapter-42', 'aria-label': 'Chapter URL', autocomplete: 'off', spellcheck: 'false' });
  const addBtn = h('button', { class: 'btn primary lg', type: 'submit' }, 'Start reading');
  const form = h('form', { class: 'add-form', onsubmit: (e) => { e.preventDefault(); add(input.value); } }, icon('link'), input, addBtn);

  const shelf = h('div');
  const main = h('main', { class: 'lib-main' },
    h('section', { class: 'hero' },
      h('h1', null, 'Read anything. ', h('em', null, 'Remember'), ' everything.'),
      h('p', null, 'Marginalia turns any online novel into a quiet, beautiful reader — with a spoiler-safe companion that answers questions from the chapters you’ve read, and a cast list that keeps track of who everyone is.'),
      form,
      h('div', { class: 'hero-links' },
        h('button', { onclick: addDemo }, icon('sparkles', 'sm'), 'Try the demo novel'),
        h('button', { onclick: openCaptureGuide }, icon('feather', 'sm'), 'Capture from your browser'),
      ),
    ),
    shelf,
  );
  root.append(h('div', { class: 'library' }, top, main));

  const onScroll = () => top.classList.toggle('scrolled', window.scrollY > 4);
  window.addEventListener('scroll', onScroll, { passive: true });

  async function add(url) {
    url = url.trim();
    if (!url) { input.focus(); return; }
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    addBtn.disabled = true;
    fill(addBtn, h('span', { class: 'spinner' }), 'Opening…');
    try {
      const r = await api.post('/api/novels', { url });
      if (r.warning) toast(r.warning, { type: 'error', timeout: 7000 });
      navigate(`#/read/${r.novel.id}/${r.startChapter}`);
    } catch (e) {
      toast(e.message, { type: 'error' });
      addBtn.disabled = false;
      fill(addBtn, 'Start reading');
    }
  }

  async function addDemo() {
    try {
      const r = await api.post('/api/demo');
      navigate(`#/read/${r.novel.id}/${r.startChapter}`);
    } catch (e) { toast(e.message, { type: 'error' }); }
  }

  async function load() {
    let novels = [];
    try { novels = await api.get('/api/novels'); } catch (e) { toast(e.message, { type: 'error' }); }
    fill(shelf);
    if (!novels.length) {
      shelf.append(
        h('div', { class: 'section-head' }, h('h2', null, 'Your shelf')),
        h('div', { class: 'empty-shelf' },
          icon('book', 'lg'),
          h('h3', null, 'Your shelf is empty'),
          h('p', { style: { margin: 0, maxWidth: '420px', lineHeight: 1.55 } }, 'Paste a link to any chapter above. Marginalia works out the chapter pattern, so you can move forward and back, and it builds context as you go.')),
        features());
      return;
    }
    const grid = h('div', { class: 'shelf' });
    for (const n of novels) grid.append(card(n));
    shelf.append(h('div', { class: 'section-head' }, h('h2', null, 'Continue reading'), h('span', { class: 'muted', style: { fontSize: '12.5px' } }, `${novels.length} ${novels.length === 1 ? 'novel' : 'novels'}`)), grid);
    // Character faces on each card (best-effort).
    for (const n of novels) {
      api.get(`/api/novels/${n.id}/characters?chapter=${n.last_chapter || 1}`).then(cs => {
        const slot = grid.querySelector(`[data-novel="${n.id}"] .faces`);
        if (!slot) return;
        const top4 = cs.filter(c => !c.hidden).slice(0, 4);
        fill(slot, ...top4.map(c => avatar(c, 'sm')));
      }).catch(() => {});
    }
  }

  function card(n) {
    const [c1, c2] = coverFor(n.title);
    const last = n.last_chapter || n.min_chapter || 1;
    const pct = n.max_chapter ? Math.min(100, Math.round((last / Math.max(n.max_chapter, last)) * 100)) : 0;
    const more = h('button', { class: 'icon-btn card-menu', 'aria-label': 'Novel options', onclick: (e) => {
      e.stopPropagation();
      menu(more, [
        { icon: 'book', label: 'Open', run: () => navigate(`#/read/${n.id}/${last}`) },
        ...(isNativeApp() ? [{ icon: 'download', label: 'Save on device', run: () => saveStoryOnDevice(n.id, last) }] : []),
        '-',
        { icon: 'trash', label: 'Remove from library', danger: true, run: async () => {
          const ok = await confirmDialog({ title: `Remove “${n.title}”?`, message: 'Downloaded chapters, summaries and character notes for this novel will be deleted. This cannot be undone.', confirmLabel: 'Remove', danger: true });
          if (!ok) return;
          await api.del(`/api/novels/${n.id}`);
          toast('Novel removed');
          load();
        } },
      ]);
    } }, icon('more'));
    return h('div', { class: 'novel-card', role: 'link', tabindex: 0, dataset: { novel: n.id }, onclick: () => navigate(`#/read/${n.id}/${last}`), onkeydown: (e) => { if (e.key === 'Enter') navigate(`#/read/${n.id}/${last}`); } },
      h('div', { class: 'cover', style: { '--cv1': c1, '--cv2': c2 } },
        more,
        novelIcon(n, 'cover-icon'),
        h('div', { class: 'cover-title' }, n.title),
        h('div', { class: 'cover-host' }, n.source_host?.replace(/^www\./, '') || 'Imported')),
      h('div', { class: 'card-body' },
        h('div', { class: 'card-meta' },
          h('span', null, 'Chapter ', h('strong', null, last), n.max_chapter > last ? ` of ${n.max_chapter}` : ''),
          h('span', null, fmt.ago(n.updated_at))),
        h('div', { class: 'progress' }, h('i', { style: { width: `${pct}%` } })),
        h('div', { class: 'card-meta' },
          h('div', { class: 'avatar-stack faces' }),
          h('span', null, `${n.chapters_analyzed} analysed · ${n.character_count} characters`)),
      ));
  }

  function features() {
    const f = (ic, title, text) => h('div', { class: 'feature' }, h('div', { class: 'f-ico' }, icon(ic)), h('h4', null, title), h('p', null, text));
    return h('div', { class: 'features' },
      f('chat', 'Ask without spoilers', 'Questions are answered only from chapters up to the one you’re reading, with citations you can jump to.'),
      f('users', 'Know every character', 'Names in the text get a face. Tap one to see their status, strength and story so far — as of this chapter.'),
      f('cpu', 'Choose your AI', 'Use a local model through Ollama or an OpenAI-compatible server, or connect OpenRouter for cloud models.'),
    );
  }

  await load();
  if (new URLSearchParams(location.search).has('network')) {
    history.replaceState(null, '', location.pathname + location.hash);
    openNetworkGuide();
  }
  return () => { window.removeEventListener('scroll', onScroll); pill._cleanup?.(); };
}

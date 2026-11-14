// Companion panel: Ask (spoiler-safe Q&A), Cast (characters), Chapter (summary, events, recap).
import { api, prefs, local } from './api.js';
import { h, icon, avatar, renderMarkdown, toast, fill } from './ui.js';
import { openCharacterCard, openNewCharacter } from './characters.js';
import { llm, bus, pollJobs } from './app.js';
import { jobProgressText } from './job-status.js';

export function createCompanion(ctx) {
  // ctx: { novel(), chapter(), chapterData(), characters(), onNavigate(n), onCharactersChanged(), close() }
  const root = h('aside', { class: 'panel', 'aria-label': 'Reading companion' });
  const tabsEl = h('div', { class: 'panel-tabs', role: 'tablist' });
  const view = h('div', { class: 'panel-view' });
  root.append(tabsEl, view);

  let tab = prefs.panelTab || 'ask';
  const castCount = h('span', { class: 'count' }, '0');

  const renderTabs = () => {
    const t = (id, ic, label, extra) => h('button', { class: `panel-tab ${tab === id ? 'on' : ''}`, role: 'tab', 'aria-selected': tab === id, onclick: () => setTab(id) }, icon(ic, 'sm'), label, extra);
    fill(tabsEl, 
      t('ask', 'chat', 'Ask'), t('cast', 'users', 'Cast', castCount), t('notes', 'quote', 'Chapter'),
      h('button', { class: 'icon-btn panel-close', 'aria-label': 'Close panel', onclick: ctx.close }, icon('x')));
  };
  const setTab = (id) => { tab = id; prefs.set({ panelTab: id }); renderTabs(); render(); };

  // ======================= Ask =======================
  const threadKey = () => `thread.${ctx.novel().id}`;
  let thread = local.get(threadKey(), []);
  let streaming = null;
  let requestId = 0, activeMessage = null;
  const threadEl = h('div', { class: 'thread' });
  const coverageEl = h('div', { class: 'coverage' });
  const input = h('textarea', { rows: 1, maxLength: 2000, placeholder: 'Ask about the story so far…', 'aria-label': 'Ask a question' });
  const sendBtn = h('button', { class: 'send', 'aria-label': 'Send', disabled: true }, icon('send', 'sm'));
  const askView = h('div', { class: 'ask' },
    coverageEl,
    threadEl,
    h('div', { class: 'composer' },
      h('div', { class: 'answer-style' }, h('label', { for: 'answer-style' }, 'Answer style'),
        h('select', { class: 'select', id: 'answer-style', onchange: e => prefs.set({ answerMode: e.target.value }) },
          h('option', { value: 'explain', selected: prefs.answerMode !== 'quotes' }, 'Explain with quotes'),
          h('option', { value: 'quotes', selected: prefs.answerMode === 'quotes' }, 'Quotes only'))),
      h('div', { class: 'composer-box' }, input, sendBtn),
      h('div', { class: 'hint' },
        h('span', { class: 'chapter-scope' }),
        h('button', { onclick: () => { if (streaming) return; thread = []; local.set(threadKey(), thread); renderThread(); } }, 'Clear chat'))));

  const autosize = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 160)}px`; };
  input.addEventListener('input', () => { autosize(); sendBtn.disabled = !input.value.trim() && !streaming; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
  sendBtn.addEventListener('click', () => streaming ? stop() : submit());

  function submit(text = input.value) {
    text = text.trim();
    if (!text || streaming) return;
    input.value = ''; autosize();
    const history = thread.filter(m => !m.error && Number.isInteger(m.chapter) && m.chapter <= ctx.chapter()).map(m => ({ role: m.role, content: m.content, chapter: m.chapter }));
    thread.push({ role: 'user', content: text, chapter: ctx.chapter() });
    const msg = { role: 'assistant', content: '', sources: [], pending: true, phase: 'Finding chapter evidence…', chapter: ctx.chapter() };
    const id = ++requestId;
    activeMessage = msg;
    thread.push(msg);
    renderThread();
    setStreaming(true);
    streaming = api.stream(`/api/novels/${ctx.novel().id}/ask`, { question: text, chapter: msg.chapter, history, mode: prefs.answerMode }, (ev) => {
      if (id !== requestId || msg.chapter !== ctx.chapter()) return;
      if (ev.type === 'phase') { msg.phase = ev.text; }
      else if (ev.type === 'coverage') { msg.coverage = ev; }
      else if (ev.type === 'evidence') { msg.evidence = ev; }
      else if (ev.type === 'sources') { msg.sources = ev.sources; }
      else if (ev.type === 'wiki') { msg.wiki = ev; }
      else if (ev.type === 'profile-corrections') {
        msg.corrections = [...(msg.corrections || []), ...ev.corrections];
        ctx.onCharactersChanged();
      }
      else if (ev.type === 'token') { msg.content += ev.text; msg.pending = false; }
      else if (ev.type === 'error') { msg.error = true; msg.pending = false; msg.content = ev.message; }
      else if (ev.type === 'end' || ev.type === 'aborted' || ev.type === 'done') {
        msg.pending = false;
        if (ev.type === 'aborted' && !msg.content) msg.content = '_Stopped._';
        if (ev.type !== 'done') { setStreaming(false); activeMessage = null; local.set(threadKey(), thread.slice(-40)); }
      }
      updateLast(msg);
    });
  }
  function stop() {
    const controller = streaming;
    requestId++;
    if (activeMessage) { activeMessage.pending = false; if (!activeMessage.content) activeMessage.content = 'Stopped before a checked answer was ready.'; }
    activeMessage = null; setStreaming(false); controller?.abort();
    local.set(threadKey(), thread.slice(-40)); renderThread();
  }
  function setStreaming(on) {
    if (!on) streaming = null;
    fill(sendBtn, icon(on ? 'stop' : 'send', 'sm'));
    sendBtn.disabled = !on && !input.value.trim();
    sendBtn.setAttribute('aria-label', on ? 'Stop' : 'Send');
  }

  function messageEl(m) {
    if (m.role === 'user') return h('div', { class: 'msg user' }, h('div', { class: 'bubble' }, m.content));
    const bubble = h('div', { class: 'bubble' });
    if (m.pending) bubble.append(h('div', { class: 'answer-progress', role: 'status' }, h('span', { class: 'thinking', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('span', null, m.phase || 'Finding chapter evidence…')));
    else if (m.error) bubble.append(m.content);
    else {
      bubble.append(renderMarkdown(m.content, { onCite: (n) => ctx.onNavigate(n) }));
      if (streaming && thread[thread.length - 1] === m) (bubble.lastElementChild || bubble).append(h('span', { class: 'caret' }));
    }
    const el = h('div', { class: `msg assistant ${m.error ? 'error' : ''}` },
      h('div', { class: 'who' }, h('span', { class: 'spark' }, icon('sparkles')), 'Companion', m.chapter ? h('span', { style: { fontWeight: 500, textTransform: 'none', letterSpacing: 0 } }, `· as of Ch. ${m.chapter}`) : null),
      bubble);
    if (m.evidence && !m.pending) el.append(h('div', { class: `evidence-note ${m.evidence.status === 'supported' ? 'has-evidence' : ''}` }, icon(m.evidence.status === 'supported' ? 'check' : 'info', 'sm'),
      m.evidence.status === 'supported' ? `${m.evidence.checkedQuotes} supporting quote${m.evidence.checkedQuotes === 1 ? '' : 's'} checked${m.evidence.mode === 'quotes' ? ' · quotes only' : ' · explanation is AI interpretation'}` : 'Not enough checked evidence for an answer'));
    if (m.evidence?.omitted) el.append(h('div', { class: 'hint' }, 'Some statements were omitted because their quotes or chapter references could not be checked.'));
    if (m.corrections?.length) el.append(h('div', { class: 'stack' }, m.corrections.map(c => h('div', { class: 'hint row' },
      h('span', null, `${c.characterName}: ${c.field} updated to ${c.value} · Ch. ${c.chapter_number}${c.origin === 'user' ? ' · your correction' : ' · chapter evidence'}`),
      h('button', { class: 'btn sm ghost', onclick: async () => {
        try { await api.del(`/api/profile-corrections/${c.id}`); m.corrections = m.corrections.filter(x => x.id !== c.id); ctx.onCharactersChanged(); local.set(threadKey(), thread.slice(-40)); renderThread(); }
        catch (e) { toast(e.message, { type: 'error' }); }
      } }, 'Undo')))));
    if (m.coverage && !m.pending) {
      const c = m.coverage;
      const ranges = (c.missingRanges || []).slice(0, 6).map(r => r.from === r.to ? String(r.from) : `${r.from}–${r.to}`).join(', ');
      el.append(h('div', { class: 'hint answer-coverage' }, `${c.downloaded} of ${c.total} chapter texts available${c.from > 1 ? ` in Ch. ${c.from}–${c.upTo}` : ` through Ch. ${c.upTo}`}.`, c.missing ? ` Missing: ${ranges}${c.missingRanges.length > 6 ? ', …' : ''}.` : ''));
    }
    if (m.wiki) el.append(h('div', { class: 'hint' }, ({ confirmed: `Wiki: ${m.wiki.count} chapter-confirmed sentence(s)`, 'no-confirmed-facts': 'Wiki checked: no matching chapter evidence; chapter sources only.', unavailable: 'Wiki unavailable; chapter sources only.', unsupported: 'Wiki site unsupported; chapter sources only.', off: 'AI wiki access is off.', 'not-configured': 'No wiki configured.' })[m.wiki.status] || 'Chapter sources only.'));
    if (m.sources?.length && !m.pending) {
      el.append(h('details', { class: 'sources' },
        h('summary', null, icon('right', 'sm'), m.evidence ? 'Read supporting quotes' : `${m.sources.length} passage${m.sources.length === 1 ? '' : 's'} consulted`),
        h('div', { class: 'source-list' }, m.sources.map(s => h('button', { class: 'source', onclick: () => ctx.onNavigate(s.chapter, s.quote) },
          h('b', null, `Chapter ${s.chapter}`, s.title && !/^chapter\s*\d+$/i.test(s.title) ? ` · ${s.title.replace(/^chapter\s*\d+\s*[:.-]?\s*/i, '')}` : ''),
          h('span', null, s.quote ? `“${s.quote}”` : `${s.snippet.trim()}…`))))));
    }
    return el;
  }

  function updateLast(m) {
    const last = threadEl.lastElementChild;
    const atBottom = threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight < 80;
    const el = messageEl(m);
    if (last && last.classList.contains('assistant')) last.replaceWith(el); else threadEl.append(el);
    if (atBottom) threadEl.scrollTop = threadEl.scrollHeight;
  }

  function suggestions() {
    const chars = ctx.characters().filter(c => !c.hidden);
    const here = chars.filter(c => c.inChapter);
    const top = here[0] || chars[0];
    const second = here[1] || chars[1];
    const s = [
      ['refresh', 'Recap the story so far'],
      ['bolt', 'What just happened in this chapter?'],
      top && ['users', `Who is ${top.name}, and what do we know about them?`],
      second && top && ['link', `How are ${top.name} and ${second.name} connected?`],
      ['layers', 'Which plot threads are still unresolved?'],
    ].filter(Boolean);
    return h('div', { class: 'ask-empty' },
      h('h3', null, 'Ask anything about the story'),
      h('p', null, `Answers use downloaded text through Chapter ${ctx.chapter()}, with supporting quotes checked before display. Choose Quotes only to read the source wording without an AI explanation.`),
      h('div', { class: 'suggestions' }, s.map(([ic, q]) => h('button', { class: 'suggestion', onclick: () => submit(q) }, icon(ic, 'sm'), q))));
  }

  function renderThread() {
    fill(threadEl);
    const visible = thread.filter(m => Number.isInteger(m.chapter) && m.chapter <= ctx.chapter());
    if (!visible.length) threadEl.append(suggestions());
    else for (const m of visible) threadEl.append(messageEl(m));
    threadEl.scrollTop = threadEl.scrollHeight;
  }

  let lastCoverage = '';
  function renderCoverage() {
    const n = ctx.novel();
    const cur = ctx.chapter();
    const analyzed = n.chapters.filter(c => c.number <= cur && c.analyzed).length;
    const downloaded = n.chapters.filter(c => c.number <= cur && c.fetched).length;
    const missing = Math.max(0, cur - downloaded);
    const job = (window.__jobs || []).find(j => j.novelId === n.id && j.type === 'import' && ['running', 'queued'].includes(j.status));
    const offline = llm.status && !llm.status.ok;
    const pct = Math.round((downloaded / Math.max(1, cur)) * 100);
    // Only touch the DOM when something visible changed (this runs on every job poll).
    const sig = [n.id, cur, downloaded, analyzed, job ? `${job.id}:${job.done}/${job.total}` : '', offline].join('|');
    if (sig === lastCoverage && coverageEl.isConnected && coverageEl.childElementCount) return;
    lastCoverage = sig;
    fill(coverageEl, 
      h('div', { class: 'row' },
        h('span', null, 'Chapter text: ', h('strong', null, `${downloaded} of ${cur}`), ' available'),
        job ? h('span', { class: 'row', style: { gap: '6px', color: 'var(--accent-text)' } }, h('span', { class: 'spinner', style: { width: '12px', height: '12px' } }), `${job.downloaded || 0} text chapters ready`)
          : missing === 0 ? h('span', { class: 'row', style: { gap: '4px', color: 'var(--ok)' } }, icon('check', 'sm'), 'Up to date') : null),
      h('div', { class: 'progress' }, h('i', { style: { width: `${Math.min(100, pct)}%` } })),
      h('div', { class: 'hint' }, `${analyzed} chapter summaries · answers can use text even before analysis finishes`),
      offline ? h('div', { class: 'row', style: { color: 'var(--danger)', justifyContent: 'flex-start', gap: '6px' } }, icon('alert', 'sm'), 'AI provider unavailable — check Settings.') : null,
      !job && missing > 0 ? h('div', { class: 'row', style: { justifyContent: 'flex-start' } },
        h('button', { class: 'btn sm', onclick: () => buildContext(1) }, icon('download', 'sm'), `Download context for Ch. 1–${cur}`),
        h('span', { class: 'hint' }, `${missing} missing`)) : null,
    );
  }

  async function buildContext(from) {
    try {
      await api.post(`/api/novels/${ctx.novel().id}/import`, { from, to: ctx.chapter(), analyze: false });
      toast(`Downloading chapter text for Ch. ${from}–${ctx.chapter()}. Answers can use each chapter as it arrives.`, { type: 'success' });
      pollJobs();
    } catch (e) { toast(e.message, { type: 'error' }); }
  }

  // ======================= Cast =======================
  let castQuery = '';
  const castView = h('div', { class: 'cast' });
  const updateCount = () => {
    const all = ctx.characters().filter(c => !c.hidden);
    castCount.textContent = String(all.filter(c => c.inChapter).length || all.length);
    castCount.title = `${all.filter(c => c.inChapter).length} in this chapter, ${all.length} met so far`;
  };
  function renderCast() {
    const all = ctx.characters().filter(c => !c.hidden);
    updateCount();
    const q = castQuery.toLowerCase();
    const match = (c) => !q || [c.name, ...c.aliases, c.profile.role || ''].some(s => s.toLowerCase().includes(q));
    const here = all.filter(c => c.inChapter && match(c));
    const others = all.filter(c => !c.inChapter && match(c));
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Search characters', value: castQuery, oninput: (e) => { castQuery = e.target.value; const pos = e.target.selectionStart; renderCast(); const ni = castView.querySelector('input'); ni.focus(); ni.setSelectionRange(pos, pos); } });
    const row = (c) => h('button', { class: `cast-row ${c.inChapter ? '' : 'dim'}`, onclick: (e) => openCharacterCard(c.id, e.currentTarget, cardCtx()) },
      avatar(c),
      h('div', { style: { minWidth: 0 } }, h('div', { class: 'nm' }, c.name), h('div', { class: 'rl' }, c.profile.role || c.description || (c.aliases[0] ? `aka ${c.aliases[0]}` : `Since Ch. ${c.firstChapter}`))),
      h('span', { class: `pill ${c.profile.status}` }, c.profile.status));
    fill(castView, 
      h('div', { class: 'row' }, h('div', { class: 'cast-search grow' }, icon('search', 'sm'), search), h('button', { class: 'icon-btn', title: 'Add a character', 'aria-label': 'Add a character', onclick: () => openNewCharacter(cardCtx()) }, icon('plus'))),
      here.length ? h('div', { class: 'cast-group' }, h('div', { class: 'eyebrow' }, h('span', null, 'In this chapter'), h('span', null, here.length)), here.map(row)) : null,
      others.length ? h('div', { class: 'cast-group' }, h('div', { class: 'eyebrow' }, h('span', null, 'Met so far'), h('span', null, others.length)), others.map(row)) : null,
      !all.length ? h('div', { class: 'notes-empty' }, h('b', null, 'No characters yet'), h('span', null, 'Characters appear here as chapters are analysed by your selected model. You can also add someone manually.')) : null,
      all.length && !here.length && !others.length ? h('p', { class: 'hint', style: { textAlign: 'center' } }, 'No matches.') : null,
    );
  }

  const cardCtx = () => ({
    novelId: ctx.novel().id, chapter: ctx.chapter(),
    onAsk: (q) => { ctx.open?.(); setTab('ask'); submit(q); },
    onNavigate: ctx.onNavigate,
    onChanged: ctx.onCharactersChanged,
  });

  // ======================= Chapter notes =======================
  const notesView = h('div', { class: 'notes' });
  let recapMessage = null, recapFor = null, recapCtrl = null, recapRequest = 0;
  function renderNotes() {
    const ch = ctx.chapterData();
    if (!ch) { fill(notesView, h('div', { class: 'skeleton', style: { height: '120px' } })); return; }
    const analysing = currentAnalysisJob();
    const recapBox = h('div', { class: 'recap-box' });
    if (recapFor === ch.number && recapMessage) recapBox.append(messageEl(recapMessage));
    const recapWindow = h('select', { class: 'select', id: 'recap-window', disabled: !!recapCtrl, onchange: e => prefs.set({ recapLookback: Number(e.target.value) }) },
      [5, 10, 20].map(count => h('option', { value: count, selected: Number(prefs.recapLookback) === count }, `Previous ${count} chapters`)));
    fill(notesView, 
      h('section', null,
        h('h3', null, h('span', null, 'Summary'), ch.analyzed ? h('button', { class: 'btn sm ghost', title: 'Re-analyse this chapter', onclick: reanalyse }, icon('refresh', 'sm'), 'Re-analyse') : null),
        ch.summary ? h('p', { class: 'summary' }, ch.summary)
          : h('div', { class: 'notes-empty' },
            analysing ? h('div', { class: 'row' }, h('span', { class: 'spinner' }), h('span', { class: 'analysis-progress' }, jobProgressText(analysing)))
              : [h('span', null, 'This chapter hasn’t been analysed yet.'), h('div', null, h('button', { class: 'btn sm primary', onclick: reanalyse }, icon('sparkles', 'sm'), 'Analyse now'))])),
      ch.keyEvents?.length ? h('section', null, h('h3', null, 'Key events'), h('ul', { class: 'events' }, ch.keyEvents.map(e => h('li', null, e)))) : null,
      h('section', null,
        h('h3', null, h('span', null, 'Previously on…'), h('button', { class: 'btn sm ghost', onclick: () => recapCtrl ? stopRecap() : runRecap(ch.number) }, icon(recapCtrl ? 'stop' : 'sparkles', 'sm'), recapCtrl ? 'Stop' : recapFor === ch.number && recapMessage?.content ? 'Regenerate' : 'Generate')),
        h('div', { class: 'recap-controls' }, h('label', { for: 'recap-window' }, 'Catch-up range'), recapWindow),
        recapFor === ch.number && recapMessage ? recapBox : h('p', { class: 'hint', style: { margin: 0 } }, 'A catch-up on earlier chapters, with supporting quotes. This chapter is excluded. Missing chapter text is reported, so gaps aren’t filled by guesswork.')),
    );
  }
  async function reanalyse() {
    try { await api.post(`/api/novels/${ctx.novel().id}/chapters/${ctx.chapter()}/analyze`); pollJobs(); setTimeout(renderNotes, 300); }
    catch (e) { toast(e.message, { type: 'error' }); }
  }
  function stopRecap() {
    recapRequest++;
    const controller = recapCtrl; recapCtrl = null; controller?.abort();
    if (recapMessage) { recapMessage.pending = false; if (!recapMessage.content) recapMessage.content = 'Stopped before a checked recap was ready.'; }
    if (tab === 'notes') renderNotes();
  }
  function runRecap(n) {
    stopRecap();
    const id = ++recapRequest;
    recapMessage = { role: 'assistant', content: '', sources: [], pending: true, chapter: Math.max(1, n - 1), phase: 'Finding earlier chapter passages…' }; recapFor = n;
    const box = () => notesView.querySelector('.recap-box');
    recapCtrl = api.stream(`/api/novels/${ctx.novel().id}/recap`, { chapter: n, lookback: prefs.recapLookback, mode: prefs.answerMode }, (ev) => {
      if (id !== recapRequest || n !== ctx.chapter()) return;
      if (ev.type === 'phase') recapMessage.phase = ev.text;
      if (ev.type === 'sources') recapMessage.sources = ev.sources;
      if (ev.type === 'coverage') recapMessage.coverage = ev;
      if (ev.type === 'evidence') recapMessage.evidence = ev;
      if (ev.type === 'token') { recapMessage.content += ev.text; recapMessage.pending = false; }
      if (ev.type === 'error') { recapMessage.error = true; recapMessage.content = ev.message; recapMessage.pending = false; }
      if (ev.type === 'end' || ev.type === 'aborted') { recapCtrl = null; recapMessage.pending = false; renderNotes(); }
      if (!box()) renderNotes();
      const b = box();
      if (b) fill(b, messageEl(recapMessage));
    });
    renderNotes();
  }

  // ======================= shell =======================
  function render() {
    if (tab === 'ask') { fill(view, askView); renderCoverage(); renderThread(); }
    else if (tab === 'cast') { fill(view, castView); renderCast(); }
    else { fill(view, notesView); renderNotes(); }
    updateScope();
    updateCount();
  }
  const updateScope = () => { const s = askView.querySelector('.chapter-scope'); if (s) s.textContent = `Sources limited to Ch. ${ctx.chapter()}`; };

  function currentAnalysisJob() {
    return (window.__jobs || []).find(j => j.novelId === ctx.novel().id && ['running', 'queued'].includes(j.status) && j.from <= ctx.chapter() && j.to >= ctx.chapter() && (j.type === 'analyze-one' || j.analyze));
  }
  const offJobs = bus.on('jobs', (jobs) => {
    window.__jobs = jobs;
    if (tab === 'ask') renderCoverage();
    if (tab === 'notes' && !ctx.chapterData()?.summary) {
      const progress = notesView.querySelector('.analysis-progress'), job = currentAnalysisJob();
      if (!!progress !== !!job) renderNotes();
      else if (progress && job) progress.textContent = jobProgressText(job);
    }
  });
  const offLlm = bus.on('llm', () => { if (tab === 'ask') renderCoverage(); });

  renderTabs();
  return {
    el: root,
    render,
    chapterChanged() {
      if (activeMessage && activeMessage.chapter !== ctx.chapter()) stop();
      if (recapFor !== ctx.chapter()) { if (recapCtrl) stopRecap(); recapMessage = null; recapFor = null; }
      render();
    },
    charactersChanged() { updateCount(); if (tab === 'cast') renderCast(); if (tab === 'ask' && !thread.length) renderThread(); },
    chapterDataChanged() { if (tab === 'notes') renderNotes(); if (tab === 'ask') renderCoverage(); },
    ask(q) { setTab('ask'); submit(q); },
    focusInput() { setTab('ask'); input.focus(); },
    destroy() { requestId++; recapRequest++; offJobs(); offLlm(); streaming?.abort(); recapCtrl?.abort(); },
    cardCtx,
  };
}

// Character identification in the text, the character card popover, and the editor.
import { api } from './api.js';
import { h, icon, avatar, layer, place, modal, toast, confirmDialog, TITLES, fill } from './ui.js';
import { profileHeader, profileControls, profileStyle, abilityCard, rankControls, sequenceCard } from './profiles.js';

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---- matching names in prose ------------------------------------------------------
const properAliases = (c) => c.aliases.filter(a => /^\p{Lu}/u.test(a) && !(a.split(/\s+/).length === 1 && TITLES.test(a)));

export function buildMatcher(characters) {
  const lookup = new Map();
  const tokenOwners = new Map();
  const visible = characters.filter(c => !c.hidden);
  const addTerm = (t, id) => { if (t && t.length >= 2 && !lookup.has(t)) lookup.set(t, id); };

  for (const c of visible) {
    addTerm(c.name, c.id);
    // Only proper-noun aliases; descriptive ones ("an Ember", "the old cartographer") and bare titles ("Warden") are too generic.
    for (const a of properAliases(c)) addTerm(a, c.id);
  }
  // Single-word parts of multi-word names ("Mira" from "Mira Vale"), when unambiguous.
  for (const c of visible) {
    for (const t of [c.name, ...properAliases(c)]) {
      const parts = t.split(/\s+/);
      if (parts.length < 2) continue;
      for (const p of parts) {
        const w = p.replace(/[^\p{L}\p{N}'’-]/gu, '');
        if (w.length < 3 || !/^\p{Lu}/u.test(w) || TITLES.test(w)) continue;
        const owners = tokenOwners.get(w) || new Set();
        owners.add(c.id);
        tokenOwners.set(w, owners);
      }
    }
  }
  for (const [w, owners] of tokenOwners) if (owners.size === 1 && !lookup.has(w)) lookup.set(w, [...owners][0]);

  const terms = [...lookup.keys()].sort((a, b) => b.length - a.length);
  if (!terms.length) return null;
  const regex = new RegExp(`(?<![\\p{L}\\p{N}_])(${terms.map(escRe).join('|')})(?![\\p{L}\\p{N}_])`, 'gu');
  const byId = new Map(characters.map(c => [c.id, c]));
  return { regex, lookup, byId };
}

export function renderParagraph(text, matcher, onClick) {
  const p = document.createElement('p');
  if (!matcher) { p.textContent = text; return p; }
  const seen = new Set();
  let last = 0;
  matcher.regex.lastIndex = 0;
  for (const m of text.matchAll(matcher.regex)) {
    const id = matcher.lookup.get(m[0]);
    const c = matcher.byId.get(id);
    if (!c) continue;
    if (m.index > last) p.append(text.slice(last, m.index));
    // A span (not <button>) so it flows as true inline text and ::first-letter drop caps still work.
    const btn = h('span', { class: 'mention', role: 'button', tabindex: 0, dataset: { cid: c.id }, 'aria-label': `${m[0]}, show character`,
      onclick: (e) => onClick(c.id, e.currentTarget),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(c.id, e.currentTarget); } } });
    const first = !seen.has(c.id);
    seen.add(c.id);
    btn.append(avatar(c, first ? 'm-first' : 'm-repeat'), m[0]);
    p.append(btn);
    last = m.index + m[0].length;
  }
  if (last < text.length) p.append(text.slice(last));
  return p;
}

// ---- separated dialogue ---------------------------------------------------------------
// Ranges of quoted speech in a paragraph: “…”, "…", 「…」, 『…』, «…», and ‘…’ when the paragraph opens with one.
const PAIRS = [['“', '”'], ['「', '」'], ['『', '』'], ['«', '»']];
function quoteRanges(text) {
  const out = [];
  for (const [o, c] of PAIRS) {
    let i = text.indexOf(o);
    while (i >= 0) {
      const j = text.indexOf(c, i + 1);
      const end = j < 0 ? text.length : j + 1; // unclosed: speech runs to the end (continued next paragraph)
      out.push([i, end]);
      if (j < 0) break;
      i = text.indexOf(o, end);
    }
  }
  // Straight double quotes toggle.
  let open = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '"') continue;
    if (open < 0) open = i; else { out.push([open, i + 1]); open = -1; }
  }
  if (open >= 0) out.push([open, text.length]);
  // Single quotes (British style), only when the paragraph opens with one; a closing ’ must not sit inside a word.
  if (!out.length && /^\s*[‘']\p{L}/u.test(text)) {
    let start = -1;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (start < 0 && (ch === '‘' || ch === "'") && !/\p{L}/u.test(text[i - 1] || '')) start = i;
      else if (start >= 0 && (ch === '’' || ch === "'") && !/\p{L}/u.test(text[i + 1] || '')) { out.push([start, i + 1]); start = -1; }
    }
    if (start >= 0) out.push([start, text.length]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

function isDialogue(text, ranges) {
  if (!ranges.length) return false;
  if (ranges[0][0] <= 2) return true; // opens with speech
  const quoted = ranges.reduce((n, [a, b]) => n + (b - a), 0);
  return quoted / text.length >= 0.45;
}

const SPEECH = /\b(said|says|asked|asks|replied|answered|shouted|yelled|whispered|muttered|murmured|called|cried|snapped|added|continued|growled|hissed|sighed|laughed|exclaimed|demanded|told|spoke|responded|declared|insisted|admitted|explained|warned|interrupted|mumbled|stammered|retorted|scoffed|chuckled|grinned|smiled|nodded|frowned)\b/i;

// Who is speaking? A character named in the narration around the quotes, preferring one next to a speech verb.
function speakerOf(text, ranges, matcher) {
  if (!matcher) return null;
  const inQuote = (i) => ranges.some(([a, b]) => i >= a && i < b);
  const hits = [];
  matcher.regex.lastIndex = 0;
  for (const m of text.matchAll(matcher.regex)) {
    if (inQuote(m.index)) continue;
    const c = matcher.byId.get(matcher.lookup.get(m[0]));
    if (c && !c.hidden) hits.push({ c, i: m.index, len: m[0].length });
  }
  if (!hits.length) return { speaker: null, objects: [] };
  const near = hits.find(({ i, len }) => SPEECH.test(text.slice(Math.max(0, i - 24), i)) || SPEECH.test(text.slice(i + len, i + len + 24)));
  if (near) return { speaker: near.c, objects: [] };
  // "…into Mira's hand", "turned to Kael": these name someone being acted on, not the speaker.
  const isObject = ({ i }) => /\b(to|into|at|toward|towards|with|for|from|of|onto|upon|on|behind|beside|past|over|under|by)\s+$/i.test(text.slice(Math.max(0, i - 12), i));
  const subject = hits.find(x => !isObject(x));
  return subject ? { speaker: subject.c, objects: [] } : { speaker: null, objects: hits.map(x => x.c) };
}

// Render a chapter's paragraphs with spoken lines pulled out into speaker blocks.
export function renderProse(paragraphs, matcher, onClick) {
  const out = [];
  let recent = [];   // speakers of the current run of dialogue, most recent last
  let prev = null;   // previous dialogue block, to fold consecutive lines by one speaker
  for (const text of paragraphs) {
    const ranges = quoteRanges(text);
    if (!isDialogue(text, ranges)) {
      out.push(renderParagraph(text, matcher, onClick));
      recent = []; prev = null;
      continue;
    }
    let { speaker, objects } = speakerOf(text, ranges, matcher);
    let guessed = false;
    if (!speaker && objects.length) {
      // Only people being acted on are named ("She pressed it into Mira's hand"): likely the previous speaker continuing.
      const last = [...recent].reverse().find(c => c && !objects.includes(c));
      if (last) { speaker = last; guessed = true; }
    } else if (!speaker && recent.length >= 2 && recent.at(-1) && recent.at(-2) && recent.at(-1) !== recent.at(-2)) {
      // No name nearby ("he said"): in a two-person exchange, speakers usually alternate.
      speaker = recent.at(-2); guessed = true;
    }
    recent.push(speaker);
    if (recent.length > 4) recent.shift();

    const p = renderParagraph(text, matcher, onClick);
    if (speaker) p.querySelectorAll(`.mention[data-cid="${speaker.id}"] .avatar`).forEach(a => a.classList.add('is-speaker'));
    const same = prev && speaker && prev.speaker === speaker;
    if (same) { prev.body.append(p); continue; }

    const face = speaker
      ? h('button', { class: 'd-face', 'aria-label': `${speaker.name}, show character`, title: guessed ? `${speaker.name} (probably)` : speaker.name, onclick: (e) => onClick(speaker.id, e.currentTarget) }, avatar(speaker, 'd-avatar'))
      : h('span', { class: 'd-face unknown', title: 'Speaker not identified' }, h('span', { class: 'avatar d-avatar' }, icon('chat', 'sm')));
    const body = h('div', { class: 'd-body' },
      speaker ? h('button', { class: 'd-name', onclick: (e) => onClick(speaker.id, e.currentTarget) }, speaker.name, guessed ? h('span', { class: 'd-guess' }, ' · probably') : null) : null,
      p);
    const block = h('div', { class: `dialogue ${speaker ? '' : 'no-speaker'} ${guessed ? 'guessed' : ''}`, style: speaker ? { '--c': speaker.color || '#8A8075' } : null }, face, body);
    out.push(block);
    prev = { speaker, body };
  }
  return out;
}

// ---- character card -----------------------------------------------------------------
let openCard = null;

export async function openCharacterCard(cid, anchor, ctx) {
  if (openCard) openCard.close();
  document.querySelectorAll('.mention.active').forEach(el => el.classList.remove('active'));
  const sheet = window.innerWidth <= 720;
  const el = h('div', { class: `popover ${sheet ? 'sheet' : ''}`, role: 'dialog', 'aria-label': 'Character' },
    h('div', { class: 'cc-body', style: { padding: '22px' } }, h('div', { class: 'row' }, h('div', { class: 'skeleton', style: { width: '56px', height: '56px', borderRadius: '50%' } }), h('div', { class: 'grow stack', style: { gap: '8px' } }, h('div', { class: 'skeleton', style: { height: '14px', width: '60%' } }), h('div', { class: 'skeleton', style: { height: '12px', width: '40%' } })))));
  const entry = layer(el, { dismissOnOutside: true, anchor, onClose: () => { anchor?.classList?.remove('active'); if (openCard === entry) openCard = null; } });
  openCard = entry;
  anchor?.classList?.add('active');
  const position = () => { if (!sheet && anchor?.isConnected) place(el, anchor, { align: 'center' }); else if (!sheet) place(el, { left: window.innerWidth / 2, right: window.innerWidth / 2, top: 80, bottom: 80, width: 0, height: 0 }); };
  position();

  let c;
  try { c = await api.get(`/api/characters/${cid}?chapter=${ctx.chapter}`); }
  catch (e) { entry.close(); toast(e.message, { type: 'error' }); return; }
  if (openCard !== entry) return;

  const p = c.profile;
  for (const [key, value] of Object.entries(profileStyle(c))) el.style.setProperty(key, value);
  const cur = c.current;
  const status = p.status;
  const fact = (ic, label, value) => value ? [h('dt', null, icon(ic), label), h('dd', null, value)] : [];
  const lastSeenText = c.inChapter ? 'In this chapter' : p.lastSeen ? `Last seen Ch. ${p.lastSeen}` : `First noted Ch. ${c.firstChapter ?? '—'}`;

  const timeline = (c.timeline || []).filter(t => t.notes).slice(-12).reverse();
  fill(el, 
    profileHeader(c, { close: () => entry.close(), tags: [h('span', { class: `pill ${status}` }, status), h('span', { class: 'chip' }, icon('clock', 'sm'), lastSeenText)] }),
    h('div', { class: 'cc-body' },
      (p.role || c.description) && h('div', { class: 'cc-section' }, h('p', { style: { fontSize: '14px', color: 'var(--ink)' } }, capitalize(p.role || c.description))),
      p.sequence ? h('div', { class: 'cc-section' }, sequenceCard(p.power)) : null,
      h('dl', { class: 'facts' },
        ...fact('bolt', 'Strength', p.sequence ? null : p.power || 'Not yet confirmed'),
        ...fact('heart', 'Condition', cur?.condition || p.condition),
        ...fact('pin', 'Location', p.location),
        ...fact('flag', 'Affiliation', p.affiliation),
        ...fact('layers', 'Appearances', `${c.appearances} chapter${c.appearances === 1 ? '' : 's'} so far`),
      ),
      cur?.notes && h('div', { class: 'cc-section' }, h('span', { class: 'eyebrow' }, `In chapter ${ctx.chapter}`), h('p', null, cur.notes)),
      p.abilityDetails?.length ? h('div', { class: 'cc-section' }, h('span', { class: 'eyebrow' }, 'Confirmed abilities & items'), h('div', { class: 'ability-list' }, p.abilityDetails.map(abilityCard))) : null,
      p.unverifiedAbilities?.length ? h('div', { class: 'cc-section' }, h('p', { class: 'hint' }, `${p.unverifiedAbilities.length} older entries withheld because ownership was not verified. Re-analyse earlier chapters from the Chapter panel to check them.`)) : null,
      p.corrections?.length ? h('div', { class: 'cc-section' }, h('span', { class: 'eyebrow' }, 'Profile corrections'), p.corrections.slice(-5).map(correction => h('div', { class: 'row hint' },
        h('span', null, `${correction.field}: ${correction.value} · Ch. ${correction.chapter} · ${correction.origin === 'user' ? 'your correction' : correction.origin === 'reviewed' ? 'reviewed source' : 'chapter evidence'}`),
        h('button', { class: 'btn sm ghost', onclick: async () => { try { await api.del(`/api/profile-corrections/${correction.id}`); entry.close(); ctx.onChanged(); } catch (e) { toast(e.message, { type: 'error' }); } } }, 'Undo')))) : null,
      p.relationships.length ? h('div', { class: 'cc-section' }, h('span', { class: 'eyebrow' }, 'Relationships'),
        h('dl', { class: 'facts' }, p.relationships.slice(0, 8).flatMap(r => [h('dt', null, r.name), h('dd', { style: { color: 'var(--ink-2)' } }, r.relation)]))) : null,
      timeline.length ? h('div', { class: 'cc-section' }, h('span', { class: 'eyebrow' }, 'Story so far'),
        h('ul', { class: 'timeline' }, timeline.map(t => h('li', null,
          h('button', { class: 'tl-ch', onclick: () => { entry.close(); ctx.onNavigate(t.chapter); } }, `Ch. ${t.chapter}`),
          h('span', null, t.notes))))) : null,
      !c.appearances && h('p', { class: 'hint' }, 'No analysed appearances yet. Notes appear once chapters featuring this character are analysed.'),
    ),
    h('div', { class: 'cc-foot' },
      h('button', { class: 'btn sm primary', onclick: () => { entry.close(); ctx.onAsk(`What do we know about ${c.name} so far?`); } }, icon('chat', 'sm'), `Ask about ${firstName(c.name)}`),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn sm ghost', onclick: () => { entry.close(); openCharacterEditor(c, ctx); } }, icon('edit', 'sm'), 'Edit profile')),
  );
  position();
}

const capitalize = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
const firstName = (n) => n.split(/\s+/).find(w => !TITLES.test(w)) || n;

// ---- editor ---------------------------------------------------------------------------
const COLORS = ['#B4543A', '#C0613E', '#B5852E', '#7A6A4F', '#5E7D4A', '#6E8B3D', '#2F7F7A', '#3F6C8F', '#4C7FA8', '#5B5F97', '#8A5A9B', '#9C4A6A', '#4A4A4A'];
export const EMOJI = ['🗡️', '🛡️', '🏹', '🔥', '❄️', '⚡', '🌙', '☀️', '🌿', '🌊', '👑', '🎭', '🦊', '🐺', '🐉', '🦅', '🐍', '🕷️', '💀', '👁️', '🧙', '🧝', '🧛', '🤖', '👻', '⚔️', '📜', '🗝️', '💎', '🧭', '🎻', '⚓', '🍷', '🌹', '🕯️', '🪶', '🃏', '♟️', '🧪', '⭐'];

export function openCharacterEditor(c, ctx) {
  const abilities = c.profile.abilityDetails || [];
  const draft = { name: c.name, aliases: [...c.aliases], color: c.color, icon: c.icon, description: c.description || '',
    customization: { accent: c.color || '#8a5a9b', theme: 'aurora', frame: 'none', bio: '', status: '', pronouns: '', banner: null, ...c.customization },
    abilityOverrides: abilities.map(a => ({ name: a.name, rank: a.rankOverride || 'auto', kind: a.kindOverride || 'auto' })) };
  const preview = h('div', { class: 'profile-preview' });
  const renderPreview = () => fill(preview, profileHeader({ ...draft, name: draft.name || 'Unnamed' }, { preview: true }));

  const nameIn = h('input', { class: 'input', id: 'ce-name', value: draft.name, oninput: () => { draft.name = nameIn.value; renderPreview(); } });
  const descIn = h('input', { class: 'input', id: 'ce-desc', value: draft.description, placeholder: 'e.g. Mira’s mentor, an old cartographer', oninput: () => { draft.description = descIn.value; } });
  const sequenceIn = h('select', { class: 'select', id: 'ce-sequence', onchange: () => {
    if (sequenceIn.value) draft.sequenceCorrection = sequenceIn.value;
    else delete draft.sequenceCorrection;
  } }, h('option', { value: '' }, `Keep ${c.profile.power || 'unconfirmed strength'}`),
    [9,8,7,6,5,4,3,2,1,0].map(n => h('option', { value: `Sequence ${n}` }, `Sequence ${n}`)));

  // aliases as chips
  const aliasBox = h('div', { class: 'alias-input' });
  const aliasIn = h('input', { placeholder: 'Add a nickname or title, press Enter', 'aria-label': 'Add alias' });
  const renderAliases = () => fill(aliasBox, ...draft.aliases.map((a, i) => h('span', { class: 'chip' }, a, h('button', { 'aria-label': `Remove ${a}`, onclick: () => { draft.aliases.splice(i, 1); renderAliases(); } }, icon('x', 'sm')))), aliasIn);
  aliasIn.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ',') && aliasIn.value.trim()) { e.preventDefault(); draft.aliases.push(aliasIn.value.trim().replace(/,$/, '')); aliasIn.value = ''; renderAliases(); aliasIn.focus(); }
    if (e.key === 'Backspace' && !aliasIn.value && draft.aliases.length) { draft.aliases.pop(); renderAliases(); aliasIn.focus(); }
  });
  renderAliases();

  // icon picker
  let mode = draft.icon?.startsWith('data:') ? 'image' : draft.icon ? 'emoji' : 'initials';
  const tabs = h('div', { class: 'segmented icon-tabs' });
  const pane = h('div');
  const swatches = () => h('div', { class: 'swatches' }, COLORS.map(col => h('button', { class: `swatch ${draft.color === col ? 'on' : ''}`, style: { '--c': col }, 'aria-label': `Colour ${col}`, onclick: () => { draft.color = col; renderPane(); renderPreview(); } })));
  const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => fileIn.files[0] && loadImage(fileIn.files[0]) });
  const loadImage = async (file) => {
    try { draft.icon = await squareImage(file, 160); renderPreview(); renderPane(); }
    catch { toast('That image could not be read.', { type: 'error' }); }
  };
  const renderPane = () => {
    fill(tabs, ...[['initials', 'Initials'], ['emoji', 'Emoji'], ['image', 'Image']].map(([k, l]) => h('button', { class: mode === k ? 'on' : '', onclick: () => {
      mode = k;
      if (k === 'initials') draft.icon = null;
      if (k === 'emoji' && (!draft.icon || draft.icon.startsWith('data:'))) draft.icon = EMOJI[0];
      if (k === 'image' && draft.icon && !draft.icon.startsWith('data:')) draft.icon = null;
      renderPane(); renderPreview();
    } }, l)));
    if (mode === 'initials') fill(pane, h('div', { class: 'field' }, h('span', { class: 'label' }, 'Colour'), swatches()));
    else if (mode === 'emoji') fill(pane, h('div', { class: 'stack' },
      h('div', { class: 'emoji-grid' }, EMOJI.map(e => h('button', { class: draft.icon === e ? 'on' : '', onclick: () => { draft.icon = e; renderPane(); renderPreview(); } }, e))),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Ring colour'), swatches())));
    else {
      const drop = h('div', { class: 'drop', tabindex: 0, role: 'button', onclick: () => fileIn.click(), onkeydown: (e) => { if (e.key === 'Enter') fileIn.click(); } },
        icon('upload'), h('span', null, draft.icon ? 'Replace image' : 'Choose or drop an image'), h('span', { class: 'hint' }, 'Cropped to a circle automatically'));
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) loadImage(f); });
      fill(pane, drop, fileIn);
    }
  };
  renderPane();
  renderPreview();

  let closeAll = () => {};
  const merge = h('select', { class: 'select', id: 'ce-merge' }, h('option', { value: '' }, 'Choose a character…'));
  api.get(`/api/novels/${ctx.novelId}/characters?chapter=${ctx.chapter}`).then(all => {
    for (const o of all.filter(o => o.id !== c.id).sort((a, b) => a.name.localeCompare(b.name))) merge.append(h('option', { value: o.id }, o.name));
  }).catch(() => {});

  modal({
    title: 'Edit profile',
    description: 'Give this character a look of their own. Preview your changes as you go.',
    wide: true,
    body: h('div', { class: 'stack lg' },
      preview,
      h('div', { class: 'row wrap', style: { alignItems: 'flex-start', gap: '16px' } },
        h('div', { class: 'field grow', style: { minWidth: '220px' } }, h('label', { for: 'ce-name' }, 'Name'), nameIn),
        h('div', { class: 'field grow', style: { minWidth: '220px' } }, h('label', { for: 'ce-desc' }, 'Short description'), descIn)),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Also known as'), aliasBox, h('span', { class: 'hint' }, 'Every capitalised name here is recognised in the text and linked to this character.')),
      h('div', { class: 'field' }, h('label', { for: 'ce-sequence' }, 'Sequence correction'), sequenceIn,
        h('span', { class: 'hint' }, `Saved from Chapter ${ctx.chapter} onward. Lower numbers are stronger. Your correction does not grant abilities or invent a promotion in earlier chapters.`)),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Icon'), tabs, pane),
      profileControls(draft, renderPreview),
      h('div', { class: 'divider' }),
      rankControls(abilities, draft.abilityOverrides, () => {}),
      h('div', { class: 'divider' }),
      h('div', { class: 'field' }, h('label', { for: 'ce-merge' }, 'Same person as…'),
        h('div', { class: 'row' }, h('div', { class: 'grow' }, merge), h('button', { class: 'btn', onclick: async () => {
          if (!merge.value) return;
          const target = merge.options[merge.selectedIndex].text;
          const ok = await confirmDialog({ title: `Merge into ${target}?`, message: `“${c.name}” will become an alias of ${target}, and their chapter notes will be combined.`, confirmLabel: 'Merge' });
          if (!ok) return;
          try { await api.post(`/api/characters/${c.id}/merge`, { into: Number(merge.value) }); toast(`Merged into ${target}`, { type: 'success' }); closeAll(); ctx.onChanged(); }
          catch (e) { toast(e.message, { type: 'error' }); }
        } }, icon('merge', 'sm'), 'Merge')),
        h('span', { class: 'hint' }, 'Use this when the model has tracked one person under two names.')),
    ),
    footer: (close) => {
      closeAll = close;
      return [
        h('div', { class: 'left' },
          h('button', { class: 'btn ghost', onclick: async () => { await api.patch(`/api/characters/${c.id}`, { hidden: !c.hidden }); toast(c.hidden ? 'Character shown in text' : 'Character hidden from text'); close(); ctx.onChanged(); } }, icon(c.hidden ? 'eye' : 'eyeOff', 'sm'), c.hidden ? 'Show' : 'Hide'),
          h('button', { class: 'btn ghost danger', onclick: async () => {
            const ok = await confirmDialog({ title: `Delete ${c.name}?`, message: 'Their profile and chapter notes will be removed. They may be re-detected if chapters are analysed again.', confirmLabel: 'Delete', danger: true });
            if (!ok) return;
            await api.del(`/api/characters/${c.id}`); close(); ctx.onChanged();
          } }, icon('trash', 'sm'), 'Delete')),
        h('button', { class: 'btn', onclick: close }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: async () => {
          if (!draft.name.trim()) { toast('A character needs a name.', { type: 'error' }); return; }
          try {
            await api.patch(`/api/characters/${c.id}`, { ...draft, chapter: ctx.chapter });
            toast('Character updated', { type: 'success' });
            close(); ctx.onChanged();
          } catch (e) { toast(e.message, { type: 'error' }); }
        } }, 'Save'),
      ];
    },
  });
}

export function openNewCharacter(ctx) {
  const name = h('input', { class: 'input', id: 'nc-name', placeholder: 'Full name' });
  const aliases = h('input', { class: 'input', id: 'nc-aliases', placeholder: 'Comma-separated, e.g. Sunny, Lost from Light' });
  const desc = h('input', { class: 'input', id: 'nc-desc', placeholder: 'Optional' });
  modal({
    title: 'Add a character',
    description: 'Track someone the analysis missed. Their name will be linked wherever it appears.',
    body: h('div', { class: 'stack' },
      h('div', { class: 'field' }, h('label', { for: 'nc-name' }, 'Name'), name),
      h('div', { class: 'field' }, h('label', { for: 'nc-aliases' }, 'Also known as'), aliases),
      h('div', { class: 'field' }, h('label', { for: 'nc-desc' }, 'Short description'), desc)),
    footer: (close) => [
      h('button', { class: 'btn', onclick: close }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async () => {
        if (!name.value.trim()) { name.focus(); return; }
        try {
          await api.post(`/api/novels/${ctx.novelId}/characters`, { name: name.value, aliases: aliases.value.split(',').map(s => s.trim()).filter(Boolean), description: desc.value || null, firstChapter: ctx.chapter, chapter: ctx.chapter });
          close(); ctx.onChanged(); toast('Character added', { type: 'success' });
        } catch (e) { toast(e.message, { type: 'error' }); }
      } }, 'Add character'),
    ],
  });
}

export function squareImage(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const g = canvas.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/webp', 0.86));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}

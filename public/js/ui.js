// Small UI toolkit: element builder, icons, avatars, toasts, modals, menus, popover placement.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [p, val] of Object.entries(v)) {
          if (p.startsWith('--')) el.style.setProperty(p, val); else el.style[p] = val;
        }
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

// Like replaceChildren, but skips null/false and flattens arrays.
export function fill(el, ...children) { el.replaceChildren(); append(el, children); return el; }

export const $ = (sel, root = document) => root.querySelector(sel);
export const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- icons (hand-tuned, 24px grid, stroke-based) ---------------------------
const P = {
  book: '<path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6.5A2.5 2.5 0 0 0 4 21.5v-2Z"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H19"/><path d="M9 7h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  settings: '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  arrowRight: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12Z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  send: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  type: '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>',
  heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7l10-5Z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M9.9 4.2A10 10 0 0 1 12 4c6.5 0 10 8 10 8a17 17 0 0 1-2.2 3.2M6.6 6.6A17 17 0 0 0 2 12s3.5 8 10 8a9.7 9.7 0 0 0 5.4-1.6M2 2l20 20"/><path d="M14.1 14.1a3 3 0 0 1-4.2-4.2"/>',
  merge: '<path d="M8 6v6a4 4 0 0 0 4 4h4"/><circle cx="8" cy="4" r="2"/><circle cx="18" cy="16" r="2"/><path d="M8 12v8"/>',
  wand: '<path d="m15 4 5 5L9 20l-5-5L15 4Z"/><path d="M13 6l5 5"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  quote: '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.97V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.97V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>',
  feather: '<path d="M20.2 12.2a6 6 0 0 0-8.5-8.5L5 10.5V19h8.5Z"/><path d="M16 8 2 22M17.5 15H9"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
};

export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', `icon ${cls}`);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = P[name] || '';
  return s;
}

// ---- avatars ---------------------------------------------------------------
const TITLES = /^(captain|master|warden|lord|lady|sir|dame|elder|king|queen|prince|princess|doctor|dr|mr|mrs|ms|miss|professor|prof|general|commander|the|saint|young|old|uncle|aunt|grandpa|grandma|brother|sister|senior|junior)$/i;

export function initials(name) {
  const words = String(name).split(/\s+/).filter(w => w && !TITLES.test(w.replace(/\./g, '')));
  const w = words.length ? words : String(name).split(/\s+/);
  const letters = (w.length === 1 ? [w[0]] : [w[0], w[w.length - 1]]).map(x => [...x.replace(/[^\p{L}\p{N}]/gu, '')][0] || '').join('');
  return letters.toUpperCase() || '?';
}

export function avatar(c, cls = '') {
  const color = c.color || '#8A8075';
  const el = h('span', { class: `avatar ${cls}`, style: { '--c': color }, title: c.name, 'aria-hidden': 'true' });
  if (c.icon && c.icon.startsWith('data:')) el.append(h('img', { src: c.icon, alt: '' }));
  else if (c.icon) { el.classList.add('emoji'); el.textContent = c.icon; }
  else el.textContent = initials(c.name);
  return el;
}

// A novel's own icon (emoji or image), or null when it has none.
export function novelIcon(n, cls = '') {
  if (!n?.icon) return null;
  const el = h('span', { class: `novel-icon ${cls}`, 'aria-hidden': 'true' });
  if (n.icon.startsWith('data:')) el.append(h('img', { src: n.icon, alt: '' }));
  else el.textContent = n.icon;
  return el;
}

export { TITLES };

// ---- toasts -------------------------------------------------------------------
export function toast(message, { type = 'info', action = null, timeout = 4200 } = {}) {
  const root = document.getElementById('toasts');
  const el = h('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' },
    icon(type === 'error' ? 'alert' : type === 'success' ? 'check' : 'info', 'sm'),
    h('span', { class: 'grow' }, message),
    action && h('button', { onclick: () => { action.run(); dismiss(); } }, action.label));
  const dismiss = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 220); };
  root.append(el);
  if (timeout) setTimeout(dismiss, timeout);
  return dismiss;
}

// ---- layered surfaces (modal / menu / popover) ---------------------------------
const stack = [];
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stack.length) { e.preventDefault(); stack[stack.length - 1].close(); }
});
document.addEventListener('mousedown', (e) => {
  const top = stack[stack.length - 1];
  if (top?.dismissOnOutside && !top.el.contains(e.target) && !top.anchor?.contains(e.target)) top.close();
}, true);

export function layer(el, { dismissOnOutside = false, anchor = null, onClose = null } = {}) {
  const entry = { el, anchor, dismissOnOutside, close: () => {
    const i = stack.indexOf(entry);
    if (i < 0) return;
    stack.splice(i, 1);
    el.remove();
    onClose?.();
  } };
  stack.push(entry);
  document.getElementById('layer').append(el);
  return entry;
}

export function closeAllLayers() { while (stack.length) stack[stack.length - 1].close(); }
export function hasLayer(cls) { return stack.some(s => s.el.classList.contains(cls)); }

export function modal({ title, description, body, footer, wide = false, onClose }) {
  let entry;
  const close = () => entry.close();
  const dlg = h('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' },
      h('div', { class: 'grow' }, h('h2', null, title), description && h('p', null, description)),
      h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon('x'))),
    h('div', { class: 'modal-body' }, body),
    footer && h('div', { class: 'modal-foot' }, typeof footer === 'function' ? footer(close) : footer));
  const wrap = h('div', { class: 'modal-wrap', onmousedown: (e) => { if (e.target === wrap) close(); } }, dlg);
  entry = layer(wrap, { onClose });
  requestAnimationFrame(() => dlg.querySelector('input, textarea, select')?.focus());
  return { close, el: dlg };
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title, body: h('p', { style: { margin: 0, color: 'var(--ink-2)', lineHeight: 1.6 } }, message),
      footer: (close) => [
        h('button', { class: 'btn', onclick: close }, 'Cancel'),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => { done = true; resolve(true); close(); } }, confirmLabel),
      ],
      onClose: () => { if (!done) resolve(false); },
    });
    return m;
  });
}

export function menu(anchor, items) {
  const el = h('div', { class: 'menu', role: 'menu' });
  let entry;
  for (const it of items) {
    if (it === '-') { el.append(h('div', { class: 'divider' })); continue; }
    el.append(h('button', { role: 'menuitem', class: it.danger ? 'danger' : '', onclick: () => { entry.close(); it.run(); } }, icon(it.icon, 'sm'), it.label));
  }
  entry = layer(el, { dismissOnOutside: true, anchor });
  place(el, anchor, { align: 'end' });
  return entry;
}

// Position a floating element next to an anchor (rect or element), keeping it on screen.
export function place(el, anchor, { align = 'center', gap = 8 } = {}) {
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = el.offsetWidth, hgt = el.offsetHeight;
  let left = align === 'end' ? r.right - w : align === 'start' ? r.left : r.left + r.width / 2 - w / 2;
  left = Math.max(12, Math.min(left, vw - w - 12));
  let top = r.bottom + gap;
  let origin = 'top center';
  if (top + hgt > vh - 12 && r.top - gap - hgt > 12) { top = r.top - gap - hgt; origin = 'bottom center'; }
  top = Math.max(12, Math.min(top, vh - hgt - 12));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.setProperty('--origin', origin);
}

// ---- formatting -----------------------------------------------------------------
export const fmt = {
  num: (n) => new Intl.NumberFormat().format(n || 0),
  minutes: (words) => Math.max(1, Math.round((words || 0) / 238)),
  ago(ts) {
    if (!ts) return '';
    const s = (Date.now() - ts) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
    return new Date(ts).toLocaleDateString();
  },
};

// Minimal, safe markdown for model output: paragraphs, lists, bold/italic, [Ch. N] citations.
export function renderMarkdown(text, { onCite } = {}) {
  const frag = document.createDocumentFragment();
  const blocks = String(text).replace(/\r/g, '').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter(l => l.trim());
    if (!lines.length) continue;
    const isList = lines.every(l => /^\s*([-*•]|\d+[.)])\s+/.test(l));
    if (isList) {
      const ordered = /^\s*\d/.test(lines[0]);
      const list = h(ordered ? 'ol' : 'ul');
      for (const l of lines) list.append(inline(h('li'), l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''), onCite));
      frag.append(list);
    } else {
      // Mixed: leading paragraph lines then list lines
      let para = [];
      let list = null;
      const flushPara = () => { if (para.length) { frag.append(inline(h('p'), para.join(' '), onCite)); para = []; } };
      for (const l of lines) {
        if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
          flushPara();
          if (!list) { list = h(/^\s*\d/.test(l) ? 'ol' : 'ul'); frag.append(list); }
          list.append(inline(h('li'), l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''), onCite));
        } else if (/^#{1,4}\s+/.test(l)) {
          flushPara(); list = null;
          frag.append(inline(h('p'), `**${l.replace(/^#+\s+/, '')}**`, onCite));
        } else { list = null; para.push(l.trim()); }
      }
      flushPara();
    }
  }
  return frag;
}

function inline(el, text, onCite) {
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[(?:Ch(?:apter)?\.?|Chapters?)\s*[\d,\s–\-&and]+\])/gi;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) el.append(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) el.append(h('strong', null, tok.slice(2, -2)));
    else if (tok.startsWith('[')) {
      const nums = expandChapters(tok);
      nums.forEach((n) => el.append(h('button', { class: 'cite', title: `Go to chapter ${n}`, onclick: () => onCite?.(n) }, `Ch. ${n}`)));
    } else el.append(h('em', null, tok.slice(1, -1)));
    last = m.index + tok.length;
  }
  if (last < text.length) el.append(text.slice(last));
  return el;
}

function expandChapters(tok) {
  const body = tok.replace(/^\[[^\d]*/, '').replace(/\]$/, '');
  const out = [];
  for (const part of body.split(/,|&|\band\b/)) {
    const r = part.trim().match(/^(\d+)\s*[–-]\s*(\d+)$/);
    if (r) { const a = +r[1], b = +r[2]; if (b - a <= 6) for (let i = a; i <= b; i++) out.push(i); else out.push(a, b); }
    else if (/^\d+$/.test(part.trim())) out.push(+part.trim());
  }
  return [...new Set(out)].slice(0, 8);
}

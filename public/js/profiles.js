import { h, icon, avatar, fill } from './ui.js';
import { RANKS, rankAppearance, sequenceRank } from './ranks.js';

export function crest(rankId) {
  const rank = RANKS.find(r => r.id === rankId) || RANKS[0];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 64 56');
  svg.setAttribute('class', 'rank-crest');
  svg.setAttribute('aria-hidden', 'true');
  // Original faceted crests, with increasingly elaborate wings and crowns.
  svg.innerHTML = `<g stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">
    ${rank.level > 1 ? '<path fill="currentColor" fill-opacity=".16" d="M22 24 4 13l4 17 15 11M42 24l18-11-4 17-15 11"/><path fill="none" d="m7 22 15 11M57 22 42 33"/>' : ''}
    ${rank.level > 3 ? '<path fill="currentColor" fill-opacity=".28" d="m22 20-3-12 9 5 4-10 4 10 9-5-3 12Z"/>' : ''}
    ${rank.level > 4 ? '<path fill="none" d="M15 39 7 35l9 12 10 3M49 39l8-4-9 12-10 3"/>' : ''}
    <path fill="currentColor" fill-opacity=".15" d="m32 14 14 10-5 18-9 10-9-10-5-18Z"/>
    <path fill="currentColor" fill-opacity=".65" d="m32 20 8 8-8 15-8-15Z"/>
    <path fill="none" d="m24 28 8 4 8-4M32 20v23"/>
    ${rank.level === 6 ? '<path fill="currentColor" d="m6 5 1.5 3.5L11 10l-3.5 1.5L6 15l-1.5-3.5L1 10l3.5-1.5ZM56 3l1 3 3 1-3 1-1 3-1-3-3-1 3-1Z"/>' : ''}
  </g>`;
  return svg;
}

export function abilityCard(a) {
  const rank = rankAppearance(a);
  return h('div', { class: `ability-card rank-${rank.id}`, style: { '--rank': rank.color },
    title: rank.sequence !== undefined ? `${rank.label}: lower numbers are stronger. Based only on known chapter details.` : a.rankSource === 'reader' ? 'Rank chosen by you' : a.rankSource === 'story' ? 'Rank from chapter analysis' : 'Rank not stated. Choose one in Edit profile.' },
    crest(rank.id),
    h('div', { class: 'ability-info' }, h('div', { class: 'ability-meta' }, icon(a.kind === 'item' ? 'shield' : 'bolt', 'sm'), a.kind === 'item' ? 'Item' : 'Ability', h('span', { class: 'rank-label' }, rank.label)),
      h('strong', null, a.name), a.storyRank ? h('span', { class: 'ability-story-rank' }, a.storyRank) : null,
      a.evidence ? h('details', { class: 'ability-evidence' }, h('summary', null, 'Ownership evidence'), h('p', null, a.evidence)) : null),
    a.rankSource === 'reader' ? h('span', { class: 'rank-personal', title: 'Rank chosen by you', 'aria-label': 'Rank chosen by you' }, icon('edit', 'sm')) : null);
}

// Sequence corrections are profile facts, not inventory entries. Give them the
// same crest treatment without inventing abilities or a story rarity.
export function sequenceCard(power) {
  const rank = sequenceRank({ name: power || '' });
  if (!rank) return null;
  const tier = RANKS.find(r => r.id === rank.id);
  return h('div', { class: `ability-card sequence-card rank-${rank.id}`, style: { '--rank': rank.color },
    title: `${rank.label}. Lower numbers are stronger. ${tier.label} is the visual tier, not a rarity stated by the novel.` },
    crest(rank.id), h('div', { class: 'ability-info' },
      h('div', { class: 'ability-meta' }, icon('layers', 'sm'), 'Sequence', h('span', { class: 'rank-label' }, `${tier.label} · visual tier`)),
      h('strong', null, power), h('span', { class: 'ability-story-rank' }, 'Lower number · greater strength')));
}

export function profileHeader(c, { close, tags = [], preview = false } = {}) {
  const s = c.customization || {};
  const banner = h('div', { class: `profile-banner banner-${s.theme || 'aurora'}` });
  if (s.banner) banner.append(h('img', { src: s.banner, alt: '' }));
  return h('div', { class: `profile-heading effect-${s.effect || 'none'} ${preview ? 'is-preview' : ''}`, style: profileStyle(c) },
    banner,
    close ? h('button', { class: 'icon-btn profile-close', 'aria-label': 'Close', onclick: close }, icon('x')) : null,
    h('div', { class: 'profile-identity' },
      h('div', { class: `profile-avatar frame-${s.frame || 'none'}` }, avatar(c, 'xl')),
      s.status ? h('div', { class: 'profile-status' }, s.status) : null,
      h('h3', null, c.name),
      s.pronouns ? h('div', { class: 'profile-pronouns' }, s.pronouns) : null,
      c.aliases?.length ? h('div', { class: 'aka' }, 'Also ', c.aliases.slice(0, 5).join(' · ')) : null,
      tags.length ? h('div', { class: 'tags' }, tags) : null,
      s.bio ? h('div', { class: 'profile-bio' }, h('span', { class: 'eyebrow' }, 'About'), h('p', null, s.bio)) : null));
}

export function profileStyle(c) {
  const s = c.customization || {}, accent = s.accent || c.color || '#8a5a9b';
  const palettes = { aurora: ['#8352ae', '#2c9e9c'], sunset: ['#d67558', '#9f4c99'], ocean: ['#2866af', '#2eac98'], custom: [s.gradientA || accent, s.gradientB || '#305a79'] };
  const colors = palettes[s.background];
  return { '--profile-accent': accent, '--profile-background': colors ? `linear-gradient(${s.gradientAngle ?? 135}deg, color-mix(in srgb, ${colors[0]} 19%, var(--surface)), color-mix(in srgb, ${colors[1]} 19%, var(--surface)))` : 'var(--surface)' };
}

export function profileControls(draft, onChange) {
  const s = draft.customization;
  const field = (label, key, max, multiline = false) => {
    const input = h(multiline ? 'textarea' : 'input', { class: 'input', id: `profile-${key}`, value: multiline ? null : s[key] || '', maxLength: max, rows: multiline ? 3 : null,
      oninput: e => { s[key] = e.target.value; onChange(); } }, multiline ? s[key] || '' : null);
    return h('div', { class: 'field' }, h('label', { for: `profile-${key}` }, label), input);
  };
  const themes = h('div', { class: 'banner-choices' });
  const renderThemes = () => fill(themes, ['aurora', 'ember', 'midnight', 'forest', 'plain', 'rose', 'cosmic'].map(theme =>
    h('button', { type: 'button', class: `banner-choice banner-${theme}`, style: { '--profile-accent': s.accent }, title: theme, 'aria-label': `${theme} banner`, 'aria-pressed': !s.banner && s.theme === theme,
      onclick: () => { s.theme = theme; s.banner = null; renderThemes(); onChange(); } }, s.theme === theme && !s.banner ? icon('check') : null)));
  renderThemes();
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, onchange: async () => {
    if (!file.files[0]) return;
    upload.disabled = true;
    try { s.banner = await bannerImage(file.files[0]); renderThemes(); onChange(); }
    catch { error.textContent = 'That image could not be read. Try a PNG, JPEG or WebP.'; }
    finally { upload.disabled = false; file.value = ''; }
  } });
  const error = h('span', { class: 'hint', role: 'status' });
  const upload = h('button', { class: 'btn sm', type: 'button', onclick: () => { error.textContent = ''; file.click(); } }, icon('upload', 'sm'), 'Upload banner');
  const accent = h('input', { type: 'color', id: 'profile-accent', value: s.accent, oninput: e => { s.accent = e.target.value; renderThemes(); onChange(); } });
  const frame = h('select', { class: 'select', id: 'profile-frame', onchange: e => { s.frame = e.target.value; onChange(); } },
    ['none', 'ring', 'double', 'glow', 'prismatic', 'dashed', 'pulse'].map(v => h('option', { value: v, selected: s.frame === v }, v[0].toUpperCase() + v.slice(1))));
  const choice = (key, label, values) => h('div', { class: 'field' }, h('label', { for: `profile-${key}` }, label), h('select', { class: 'select', id: `profile-${key}`, onchange: e => { s[key] = e.target.value; onChange(); } }, values.map(v => h('option', { value: v, selected: (s[key] || 'none') === v }, v[0].toUpperCase() + v.slice(1)))));
  const color = (key, label, fallback) => h('div', { class: 'field' }, h('label', { for: `profile-${key}` }, label), h('input', { type: 'color', id: `profile-${key}`, value: s[key] || fallback, oninput: e => { s[key] = e.target.value; onChange(); } }));
  return h('div', { class: 'stack profile-controls' },
    h('span', { class: 'eyebrow' }, 'Profile appearance'),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Banner'), themes, h('div', { class: 'row wrap' }, upload, file,
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { s.banner = null; renderThemes(); onChange(); } }, 'Remove image')), error),
    h('div', { class: 'profile-control-grid' }, h('div', { class: 'field' }, h('label', { for: 'profile-accent' }, 'Profile colour'), accent),
      h('div', { class: 'field' }, h('label', { for: 'profile-frame' }, 'Avatar frame'), frame)),
    h('div', { class: 'profile-control-grid' }, choice('effect', 'Profile effect', ['none', 'stars', 'snow', 'embers', 'shimmer']), choice('background', 'Profile background', ['none', 'aurora', 'sunset', 'ocean', 'custom'])),
    h('div', { class: 'profile-control-grid' }, color('gradientA', 'Custom gradient start', s.accent), color('gradientB', 'Custom gradient end', '#305a79')),
    h('div', { class: 'field' }, h('label', { for: 'profile-gradientAngle' }, 'Gradient direction'), h('input', { type: 'range', min: 0, max: 360, step: 15, id: 'profile-gradientAngle', value: s.gradientAngle ?? 135, oninput: e => { s.gradientAngle = Number(e.target.value); onChange(); } }), h('span', { class: 'hint' }, 'Choose Custom background to use your colours. Effects respect your device’s Reduce Motion setting.')),
    field('Custom status', 'status', 100), field('Pronouns', 'pronouns', 40), field('About', 'bio', 1000, true),
    h('span', { class: 'hint' }, 'Your profile styling appears across chapters. Keep personal notes spoiler-free.'));
}

export function rankControls(abilities, overrides, onChange) {
  const rows = abilities.map((a, i) => {
    const o = overrides[i];
    const preview = h('div');
    const render = () => fill(preview, abilityCard({ ...a, rank: o.rank === 'auto' ? a.originalRank : o.rank,
      kind: o.kind === 'auto' ? a.originalKind : o.kind, rankSource: o.rank === 'auto' ? a.originalRank === 'unranked' ? 'unknown' : 'story' : 'reader' }));
    const select = (label, key, options) => h('div', { class: 'field' }, h('label', { for: `rank-${key}-${i}` }, label),
      h('select', { class: 'select', id: `rank-${key}-${i}`, onchange: e => { o[key] = e.target.value; render(); onChange(); } },
        options.map(([id, name]) => h('option', { value: id, selected: o[key] === id }, name))));
    render();
    return h('div', { class: 'rank-editor-row' }, preview, h('div', { class: 'profile-control-grid' },
      select('Rank', 'rank', [['auto', 'From story / automatic'], ...RANKS.map(r => [r.id, r.label])]),
      select('Type', 'kind', [['auto', 'From story / automatic'], ['ability', 'Ability'], ['item', 'Item']])));
  });
  return h('div', { class: 'stack' }, h('span', { class: 'eyebrow' }, 'Abilities & items'),
    h('p', { class: 'hint' }, 'Choose a visual rank for each entry. Your choices apply from this chapter onward and survive re-analysis. “Automatic” restores the story’s rank.'),
    abilities.length ? rows : h('p', { class: 'hint' }, 'Abilities and items will appear here after chapter analysis.'),
    h('div', { class: 'rank-legend', 'aria-label': 'Ranks from lowest to highest' }, RANKS.slice(1).map(r => h('span', { style: { '--rank': r.color } }, crest(r.id), r.label))));
}

function bannerImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 960; canvas.height = 320;
      const scale = Math.max(960 / img.width, 320 / img.height);
      canvas.getContext('2d').drawImage(img, (960 - img.width * scale) / 2, (320 - img.height * scale) / 2, img.width * scale, img.height * scale);
      URL.revokeObjectURL(url); resolve(canvas.toDataURL('image/webp', .82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Unreadable image')); };
    img.src = url;
  });
}

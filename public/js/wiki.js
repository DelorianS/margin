import { h, modal } from './ui.js';
import { wikiForNovel } from './wiki-config.js';
export { wikiForNovel, LOTM_WIKI } from './wiki-config.js';
export function openWiki(novel) {
  const url = wikiForNovel(novel);
  modal({ title: 'Wiki reference · spoilers possible',
    body: h('div', { class: 'stack' },
      h('p', null, 'Wiki pages can reveal later events, identities, and abilities. They are not filtered to your current chapter.'),
      h('p', null, 'Ask can consult Fandom pages, but only sentences matched verbatim to downloaded chapter text at or before your current chapter reach the model. Unconfirmed material is withheld. Recaps and chapter analysis use chapter sources only. Change AI wiki access in Novel settings.'),
      h('p', { class: 'hint' }, 'Chapter filtering reduces spoilers but cannot guarantee that a model never uses knowledge from its training.'),
      url ? h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Open wiki — may contain spoilers') : h('p', null, 'Add a wiki URL in Contents → Novel settings.')),
    footer: close => h('button', { class: 'btn primary', onclick: close }, 'Keep reading') });
}

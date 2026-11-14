// Shared by the reader and analysis pipeline. Never infer rarity from a power level.
export const RANKS = [
  { id: 'unranked', label: 'Unranked', color: '#929eae', level: 0 },
  { id: 'common', label: 'Common', color: '#a8b5c5', level: 1 },
  { id: 'uncommon', label: 'Uncommon', color: '#52c994', level: 2 },
  { id: 'rare', label: 'Rare', color: '#59b8f4', level: 3 },
  { id: 'epic', label: 'Epic', color: '#bc89f6', level: 4 },
  { id: 'legendary', label: 'Legendary', color: '#edbf64', level: 5 },
  { id: 'mythic', label: 'Mythic', color: '#f08098', level: 6 },
];
export const abilityKey = name => String(name || '').normalize('NFKC').trim().toLowerCase();
export function sequenceRank(ability) {
  const matches = [...(ability.storyRank || ability.name || '').matchAll(/\bSequence\s*[:\-]?\s*([0-9])(?!\d)/gi)];
  if (matches.length !== 1) return null;
  const number = Number(matches[0][1]);
  const palette = ['mythic', 'legendary', 'epic', 'epic', 'rare', 'rare', 'uncommon', 'uncommon', 'common', 'common'];
  return { ...RANKS.find(r => r.id === palette[number]), label: `Sequence ${number}`, sequence: number, strength: 9 - number };
}
export function rankAppearance(ability) {
  return (ability.rankSource !== 'reader' && sequenceRank(ability)) || RANKS.find(r => r.id === ability.rank) || RANKS[0];
}
export function normalizeAbility(value) {
  const old = typeof value === 'string';
  if (!old && (!value || typeof value !== 'object')) return null;
  const name = String(old ? value : value.name || '').trim().slice(0, 300);
  if (!name) return null;
  // Legacy entries can include an explicit rarity word. Sequence/level numbers
  // have different meanings across novels and deliberately aren't mapped.
  const explicit = old ? name.match(/\b(common|uncommon|rare|epic|legendary|mythic)\b/i)?.[1]?.toLowerCase() : value.rank;
  return { name, kind: !old && value.kind === 'item' ? 'item' : 'ability',
    rank: RANKS.some(r => r.id === explicit) ? explicit : 'unranked',
    storyRank: old ? '' : String(value.storyRank || '').trim().slice(0, 120),
    ...(!old && value.ownershipVerified === true ? { ownershipVerified: true, evidence: value.evidence, category: value.category, relation: value.relation } : {}) };
}

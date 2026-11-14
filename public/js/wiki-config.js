export const LOTM_WIKI = 'https://lordofthemysteries.fandom.com/wiki/Lord_of_Mysteries_Wiki';
export function wikiForNovel(novel) {
  return novel.wiki_url ?? (/lord of (the )?mysteries/i.test(novel.title) ? LOTM_WIKI : '');
}

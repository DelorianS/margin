// Personal book assets live inside the installed app. They are never requested
// from the PC or a source website, and contain prose rather than AI instructions.
export function createBundledBooks({ read = async path => {
  const response = await fetch(path, { credentials: 'omit' });
  if (!response.ok) throw new Error('Included book file is unavailable.');
  return response.json();
} } = {}) {
  let manifest;
  const list = () => manifest ||= read('/books/manifest.json').then(data => {
    if (data.version !== 1 || !Array.isArray(data.novels)) throw new Error('Invalid included books.');
    return data.novels;
  }).catch(() => []); // Ordinary builds need not include a personal book.
  return {
    list,
    async chapter(book, number) {
      const included = (await list()).find(novel => novel.id === book.id);
      if (!included) return null;
      if (!included.chapters.some(chapter => chapter.number === number)) {
        throw Object.assign(new Error(`Chapter ${number} is not included in the supplied PDF. Choose another chapter in Contents.`), { status: 404, code: 'NO_CONTENT' });
      }
      const chapter = await read(`/books/${included.id}/${number}.json`);
      if (chapter.number !== number || !Array.isArray(chapter.paragraphs) || !chapter.paragraphs.length) throw new Error('The included chapter file is incomplete.');
      return chapter;
    },
  };
}

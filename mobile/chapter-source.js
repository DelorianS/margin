// Turns an arbitrary chapter page into { title, novelTitle, paragraphs, nextUrl, prevUrl }.
// Strategy: strip chrome → try well-known reader selectors → fall back to a text-density scorer.
import * as cheerio from 'cheerio';

const KNOWN_SELECTORS = [
  '#chapter-content', '#chapterContent', '#chapter_content', '.chapter-content', '.chapter_content',
  '#chr-content', '.chr-c', '#chapter-container', '.chapter-inner', '.chapter-body', '.chapter-c',
  '#article', '.txt', '.text-left', '.reading-content', '.read-content', '.reader-content',
  '#content', '.content-area .entry-content', '.entry-content', '.post-content', '#novel-content',
  '.cha-words', '.chapter__content', 'article .content', 'article',
];

const JUNK_TOKEN = /^(ads?|adv|advert\w*|adsbygoogle|ad-?\w*container|banner|sponsor\w*|share\w*|social\w*|comments?|comment-\w+|disqus|related\w*|recommend\w*|footer|header|navbar|nav|menu|sidebar|breadcrumbs?|pagination|rating\w*|login\w*|modal|popup|cookie\w*|toolbar|widget\w*)$/i;

const JUNK_LINE = [
  /^(previous|prev|next)\s*(chapter|page)?\s*[»›→←‹«]*$/i,
  /^[«‹←]?\s*(previous|prev)\b.*\b(next)\b/i,
  /^(table of contents|index|chapter list|report( chapter)?|bookmark|settings)$/i,
  /\b(read|find|visit)\b.{0,40}\b(at|on)\b.{0,40}\.(com|net|org|io|co)\b/i,
  /^(translator|translated by|editor|edited by|proofreader|tl|ed|tlc)\s*[:：]/i,
  /^(sponsored content|advertisement|ads by)\b/i,
  /enable javascript/i,
  /^if you find any errors/i,
  /^tip:\s*you can use left, right/i,
];

function cleanText(s) {
  return s.replace(/ /g, ' ').replace(/[ \t\f\v\r]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function stripChrome($) {
  $('script, style, noscript, iframe, form, nav, header, footer, aside, button, svg, ins, select, input, textarea, template, link, meta').remove();
  $('[hidden], [aria-hidden="true"], [style*="display:none"], [style*="display: none"]').remove();
  $('*').each((_, el) => {
    const cls = (el.attribs?.class || '').split(/\s+/);
    const id = el.attribs?.id || '';
    if (cls.some(c => JUNK_TOKEN.test(c)) || JUNK_TOKEN.test(id)) {
      // Never delete something that contains the bulk of the prose.
      const t = $(el).text().length;
      if (t < 2000) $(el).remove();
    }
  });
}

// Walk a container and emit paragraphs, honouring <p>, <br> and block boundaries.
function toParagraphs($, root) {
  const out = [];
  let buf = '';
  const flush = () => { const t = cleanText(buf); if (t) out.push(...t.split('\n').map(cleanText).filter(Boolean)); buf = ''; };
  const BLOCK = new Set(['p', 'div', 'section', 'article', 'blockquote', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'table', 'tr', 'hr', 'center']);
  const walk = (node) => {
    for (const child of node.children || []) {
      if (child.type === 'text') buf += child.data;
      else if (child.type === 'tag') {
        const tag = child.name.toLowerCase();
        if (tag === 'br') { buf += '\n'; continue; }
        if (BLOCK.has(tag)) { flush(); walk(child); flush(); }
        else walk(child);
      }
    }
  };
  walk(root);
  flush();
  return out;
}

function scoreCandidates($) {
  let best = null, bestScore = 0;
  $('div, article, section, main, td').each((_, el) => {
    const $el = $(el);
    let textLen = 0, pCount = 0;
    $el.children('p').each((__, p) => { const l = $(p).text().trim().length; if (l > 20) { textLen += l; pCount++; } });
    // Direct text (br-separated layouts)
    for (const c of el.children || []) if (c.type === 'text') textLen += c.data.trim().length;
    const brs = $el.children('br').length;
    if (textLen < 400) return;
    const linkText = $el.find('a').text().length;
    const all = $el.text().length || 1;
    const linkDensity = linkText / all;
    const score = textLen * (1 - Math.min(linkDensity, 0.9)) + pCount * 40 + brs * 10;
    if (score > bestScore) { bestScore = score; best = el; }
  });
  return best;
}

function absolute(href, base) {
  if (!href || href.startsWith('javascript:') || href === '#') return null;
  try { return new URL(href, base).href; } catch { return null; }
}

function findNavLinks($, baseUrl) {
  const pick = (sels) => {
    for (const s of sels) {
      const el = $(s).first();
      const u = absolute(el.attr('href'), baseUrl);
      if (u) return u;
    }
    return null;
  };
  let next = pick(['link[rel="next"]', 'a[rel="next"]', '#next_url', '#next_chap', '#next-chapter', 'a.next_page', 'a.next-chap', 'a.nextchap', 'a.btn-next', 'a.next']);
  let prev = pick(['link[rel="prev"]', 'a[rel="prev"]', '#prev_url', '#prev_chap', '#prev-chapter', 'a.prev_page', 'a.prev-chap', 'a.prevchap', 'a.btn-prev', 'a.prev']);
  if (!next || !prev) {
    $('a[href]').each((_, a) => {
      const t = cleanText($(a).text() + ' ' + ($(a).attr('title') || '')).toLowerCase();
      const u = absolute($(a).attr('href'), baseUrl);
      if (!u) return;
      if (!next && /(^|\s)(next( chapter)?|next ›|›|»|→)(\s|$)/.test(t) && !/comment|page \d/.test(t)) next = u;
      if (!prev && /(^|\s)(prev(ious)?( chapter)?|‹|«|←)(\s|$)/.test(t) && !/comment/.test(t)) prev = u;
    });
  }
  // A "next" that points back at the novel index is not a chapter.
  const host = (() => { try { return new URL(baseUrl).host; } catch { return ''; } })();
  const sameHost = (u) => { try { return new URL(u).host === host; } catch { return false; } };
  if (next && (!sameHost(next) || next === baseUrl)) next = null;
  if (prev && (!sameHost(prev) || prev === baseUrl)) prev = null;
  return { next, prev };
}

const CHAPTER_RE = /\b(chapter|ch\.?|episode|ep\.?|part)\s*#?\s*(\d+)/i;

function splitTitle(raw) {
  return raw.split(/\s+[|–—-]\s+|\s*\|\s*/).map(s => s.trim()).filter(Boolean);
}

export function slugTitle(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    // Prefer the segment right before the chapter segment, if it looks like a slug.
    const idx = parts.findIndex(p => /chapter|^ch[-_]?\d|^c\d+/i.test(p));
    const cand = (idx > 0 ? parts[idx - 1] : parts.find(p => /[a-z]-[a-z]/i.test(p) && !/chapter/i.test(p))) || '';
    if (!/[a-z]{3,}/i.test(cand)) return null;
    const words = cand.replace(/\.(html?|php)$/i, '').replace(/[-_]\d+$/, '').split(/[-_]+/).filter(w => w && !/^\d+$/.test(w));
    if (!words.length) return null;
    return words.map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  } catch { return null; }
}

export function extractChapter(html, url) {
  const $ = cheerio.load(html);
  const docTitle = cleanText($('title').first().text());
  const ogTitle = cleanText($('meta[property="og:title"]').attr('content') || '');
  const navs = findNavLinks($, url);

  // Title candidates before we strip <header>.
  let chapterTitle = '';
  $('h1, h2, h3, .chapter-title, .chr-title, .title, .tit').each((_, el) => {
    if (chapterTitle) return;
    const t = cleanText($(el).text());
    if (t && t.length < 200 && CHAPTER_RE.test(t)) chapterTitle = t;
  });
  if (!chapterTitle) {
    const seg = splitTitle(ogTitle || docTitle).find(s => CHAPTER_RE.test(s));
    if (seg) chapterTitle = seg;
  }

  let novelTitle = '';
  const segs = splitTitle(ogTitle || docTitle);
  novelTitle = segs.find(s => !CHAPTER_RE.test(s) && s.length > 1 && s.length < 120) || '';
  // "Novel Name Chapter 12: ..." in a single segment
  if (!novelTitle && segs[0]) novelTitle = segs[0].split(CHAPTER_RE)[0].replace(/[\s:–-]+$/, '');

  stripChrome($);

  let root = null;
  for (const sel of KNOWN_SELECTORS) {
    const el = $(sel).toArray().sort((a, b) => $(b).text().length - $(a).text().length)[0];
    if (el && cleanText($(el).text()).length > 600) { root = el; break; }
  }
  if (!root) root = scoreCandidates($);
  if (!root) root = $('body')[0] || $.root()[0];

  let paragraphs = toParagraphs($, root)
    .filter(p => !JUNK_LINE.some(re => re.test(p)))
    .filter(p => p.length > 0);

  // Drop leading duplicates of the title (sites often repeat it in the body).
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  while (paragraphs.length && chapterTitle && (norm(paragraphs[0]) === norm(chapterTitle) || norm(chapterTitle).includes(norm(paragraphs[0])) && paragraphs[0].length < 80 && CHAPTER_RE.test(paragraphs[0]))) {
    paragraphs.shift();
  }
  if (!chapterTitle && paragraphs[0] && CHAPTER_RE.test(paragraphs[0]) && paragraphs[0].length < 120) {
    chapterTitle = paragraphs.shift();
  }

  const m = chapterTitle.match(CHAPTER_RE);
  return {
    title: chapterTitle || null,
    detectedNumber: m ? parseInt(m[2], 10) : null,
    novelTitle: novelTitle || slugTitle(url) || null,
    paragraphs,
    wordCount: paragraphs.reduce((n, p) => n + p.split(/\s+/).length, 0),
    nextUrl: navs.next,
    prevUrl: navs.prev,
  };
}

// Plain-text import (paste): blank lines or single newlines both become paragraphs.
export function paragraphsFromText(text) {
  return text.replace(/\r/g, '').split(/\n+/).map(cleanText).filter(Boolean);
}

// Detect the chapter number embedded in a URL and build a {n} template.
export function detectUrlTemplate(url) {
  let u;
  try { u = new URL(url); } catch { return { template: null, number: null }; }
  const pathname = u.pathname;
  const patterns = [
    /(chapter[-_/]?)(\d+)/i,
    /(\/ch[-_]?)(\d+)/i,
    /(\/c)(\d+)(?=[/.]|$)/i,
    /(episode[-_/]?)(\d+)/i,
    /(\/)(\d+)(?=(\.html?)?\/?$)/i,
  ];
  for (const re of patterns) {
    const m = pathname.match(re);
    if (m) {
      const start = m.index + m[1].length;
      const tplPath = pathname.slice(0, start) + '{n}' + pathname.slice(start + m[2].length);
      // Long numeric IDs (e.g. /chapter/301778/) aren't sequential chapter numbers.
      if (m[2].length >= 6) return { template: null, number: null };
      return { template: u.origin + tplPath + u.search, number: parseInt(m[2], 10) };
    }
  }
  return { template: null, number: null };
}

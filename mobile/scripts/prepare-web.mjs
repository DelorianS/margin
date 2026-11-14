import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const mobile = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(mobile, '../public');
const destination = resolve(mobile, 'www');
await build({ entryPoints: [resolve(mobile, 'chapter-source.js')], outfile: resolve(source, 'js/chapter-extractor.js'), bundle: true, format: 'esm', platform: 'browser', target: 'safari17', minify: true, alias: { cheerio: 'cheerio/slim' }, absWorkingDir: mobile });
await mkdir(destination, { recursive: true });
// Only public app assets are copied. PC databases, model keys and runtime tokens
// must never be included in the app bundle.
await cp(source, destination, { recursive: true });
let html = await readFile(resolve(destination, 'index.html'), 'utf8');
// Capacitor injects its bridge at document start on iOS, before app modules run.
// No remote server URL or JavaScript CDN is used to launch the app.
// Bundled fonts preserve the existing design even with the PC and Wi-Fi off.
html = html.replace(/  <link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\r?\n/g, '')
  .replace(/  <link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>\r?\n/g, '')
  .replace(/<link href="https:\/\/fonts\.googleapis\.com\/css2[^\"]*" rel="stylesheet">/, '<link href="/fonts/fonts.css" rel="stylesheet">');
await writeFile(resolve(destination, 'index.html'), html);
await cp(resolve(mobile, 'assets/fonts'), resolve(destination, 'fonts'), { recursive: true });
console.log('Prepared the complete reader design and bundled fonts for iPhone and iPad.');

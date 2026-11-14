// Optional maintenance task. Normal builds use the checked-in fonts offline.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/fonts');
await mkdir(directory, { recursive: true });
const fontURL = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,500;0,7..72,600;1,7..72,400&display=swap';
const response = await fetch(fontURL, { headers: { 'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36' } });
if (!response.ok) throw new Error(`Font CSS download failed: ${response.status}`);
let css = await response.text();
let index = 0;
const resources = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(match => match[1]))];
for (const url of resources) {
  const font = await fetch(url);
  if (!font.ok) throw new Error(`Font download failed: ${font.status}`);
  const name = `font-${++index}.woff2`;
  await writeFile(resolve(directory, name), Buffer.from(await font.arrayBuffer()));
  css = css.replaceAll(url, `./${name}`);
}
await writeFile(resolve(directory, 'fonts.css'), '/* Inter and Literata from Google Fonts; see OFL-*.txt. */\n' + css);
for (const family of ['inter', 'literata']) {
  const license = await fetch(`https://raw.githubusercontent.com/google/fonts/main/ofl/${family}/OFL.txt`);
  if (!license.ok) throw new Error(`Font license download failed: ${license.status}`);
  await writeFile(resolve(directory, `OFL-${family}.txt`), await license.text());
}
console.log(`Bundled ${resources.length} font files with their open licenses.`);

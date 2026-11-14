import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobile = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(mobile, '../public');
const bundled = resolve(mobile, 'ios/App/App/public');
const config = JSON.parse(await readFile(resolve(mobile, 'capacitor.config.json'), 'utf8'));
const packagedConfig = JSON.parse(await readFile(resolve(mobile, 'ios/App/App/capacitor.config.json'), 'utf8'));
assert(!config.server?.url, 'The app must launch from its bundled files when the PC is off.');
assert.equal(config.plugins.CapacitorHttp.enabled, true, 'Native HTTP is required to reach the PC.');
assert.equal(packagedConfig.appId, config.appId);
assert.equal(packagedConfig.plugins.CapacitorHttp.enabled, true);

async function files(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...await files(path));
    else output.push(path);
  }
  return output;
}
let assetCount = 0;
for (const path of await files(source)) {
  const name = relative(source, path);
  const packaged = resolve(bundled, name);
  if (name !== 'index.html') assert((await readFile(packaged)).equals(await readFile(path)), `Stale app asset: ${name}. Run npm run sync.`);
  else {
    const sourceHTML = await readFile(path, 'utf8');
    const bundledHTML = await readFile(packaged, 'utf8');
    assert(bundledHTML.includes('/fonts/fonts.css'), 'Native fonts must be bundled.');
    const withoutFontLinks = html => html.replace(/^.*<link[^>]+(?:fonts\.googleapis\.com|fonts\.gstatic\.com|\/fonts\/fonts\.css)[^>]*>\r?\n/gm, '').replaceAll('\r\n', '\n');
    assert(withoutFontLinks(bundledHTML) === withoutFontLinks(sourceHTML), 'Stale app HTML. Run npm run sync.');
  }
  assetCount++;
}
for (const path of await files(bundled)) {
  assert(!['.db', '.sqlite', '.sqlite3', '.pem', '.key'].includes(extname(path)), 'PC data and credentials must not be packaged.');
}
const fontCSS = await readFile(resolve(bundled, 'fonts/fonts.css'), 'utf8');
for (const [, font] of fontCSS.matchAll(/url\(([^)]+)\)/g)) {
  assert(!/^https?:/.test(font), 'Fonts must work offline.');
  assert((await stat(resolve(bundled, 'fonts', font))).size > 0, `Missing font: ${font}`);
}
for (const family of ['inter', 'literata']) assert((await readFile(resolve(bundled, `fonts/OFL-${family}.txt`), 'utf8')).includes('OPEN FONT LICENSE'));
const plist = await readFile(resolve(mobile, 'ios/App/App/Info.plist'), 'utf8');
assert(plist.includes('NSLocalNetworkUsageDescription'));
assert(plist.includes('NSAllowsLocalNetworking'));
assert(!plist.includes('NSAllowsArbitraryLoads'), 'HTTP access must be limited to home-network ranges.');
for (const range of ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']) assert(plist.includes(range));
const project = await readFile(resolve(mobile, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
assert(project.includes('TARGETED_DEVICE_FAMILY = "1,2"'), 'The app must support iPhone and iPad.');
const deploymentTargets = [...project.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([\d.]+);/g)].map(match => match[1]);
assert(deploymentTargets.length && deploymentTargets.every(version => version === '17.0'), 'All app configurations must require iOS/iPadOS 17.');
const icon = await readFile(resolve(mobile, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'));
assert.equal(icon.readUInt32BE(16), 1024);
assert.equal(icon.readUInt32BE(20), 1024);
console.log(`Verified ${assetCount} current app assets, offline fonts, iPhone/iPad targets, native networking and scoped local-network permissions.`);
console.log('An Xcode build and a physical iPhone/iPad check still require a Mac.');

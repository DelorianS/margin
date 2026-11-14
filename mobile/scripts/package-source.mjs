import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, crc32 } from 'node:zlib';

const mobile = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = resolve(mobile, '..');
const output = resolve(project, 'dist/Marginalia-iPhone-iPad-source.zip');
const excludedDirectories = new Set(['node_modules', 'www', 'build', 'output', 'DerivedData', 'xcuserdata', '.git']);
const entries = [];

async function collect(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new Error(`Do not package symlinks: ${item.name}`);
    const path = resolve(directory, item.name);
    const relativePath = relative(project, path);
    assert(!relativePath.startsWith('..' + sep), 'Files must remain inside the project.');
    if (item.isDirectory()) {
      if (!excludedDirectories.has(item.name)) await collect(path);
    } else if (!/\.(ipa|xcarchive|log|db|sqlite3?|pem|key)$/i.test(item.name) && !['.DS_Store', '.env'].includes(item.name)) {
      entries.push({ name: relativePath.split(sep).join('/'), data: await readFile(path) });
    }
  }
}
// Explicit roots ensure the PC library, keys and runtime pairing records cannot
// enter this source archive. The embedded native public copy is intentional.
await collect(resolve(project, 'public'));
await collect(resolve(project, '.github'));
await collect(mobile);
entries.sort((a, b) => a.name.localeCompare(b.name));
assert(entries.some(entry => entry.name === 'mobile/BUILD.md'));
assert(entries.some(entry => entry.name === 'public/index.html'));
assert(entries.some(entry => entry.name === 'mobile/ios/App/App.xcodeproj/project.pbxproj'));

const localRecords = [];
const centralRecords = [];
let position = 0;
for (const entry of entries) {
  const name = Buffer.from(entry.name, 'utf8');
  const compressed = deflateRawSync(entry.data, { level: 9 });
  const checksum = crc32(entry.data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x800, 6); // UTF-8 paths
  header.writeUInt16LE(8, 8); // deflate
  header.writeUInt16LE(0x21, 12); // 1980-01-01; reproducible archive
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(entry.data.length, 22);
  header.writeUInt16LE(name.length, 26);
  localRecords.push(header, name, compressed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  header.copy(central, 6, 4, 28);
  central.writeUInt32LE(position, 42);
  centralRecords.push(central, name);
  position += header.length + name.length + compressed.length;
}
const centralDirectory = Buffer.concat(centralRecords);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralDirectory.length, 12);
end.writeUInt32LE(position, 16);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, Buffer.concat([...localRecords, centralDirectory, end]));
await writeFile(output.replace(/\.zip$/, '.files.txt'), entries.map(entry => entry.name).join('\n') + '\n');
console.log(`Packaged ${entries.length} source and design files into ${output}`);
console.log('Source project only; compile and sign on a Mac to install on iPhone/iPad.');

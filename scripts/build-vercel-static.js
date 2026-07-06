const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'frontend');
const out = path.join(root, 'public');

const skip = new Set(['node_modules', 'dist', 'src', 'package.json', 'vite.config.js', 'package-lock.json']);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}

if (!fs.existsSync(path.join(source, 'index.html'))) {
  throw new Error('No encuentro frontend/index.html');
}

fs.rmSync(out, { recursive: true, force: true });
copyDir(source, out);
console.log('MAUex static frontend listo en public/');

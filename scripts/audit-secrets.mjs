import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const IGNORE = new Set(['.git', 'node_modules', 'dist']);
const EXTENSIONS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.xml', '.md', '.txt', '.webmanifest']);

const rules = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ['GitHub token', /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/g],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ['Stripe secret key', /\bsk_(?:live|test)_[0-9A-Za-z]{20,}\b/g],
  ['generic secret assignment', /\b(?:api[_-]?key|secret|access[_-]?token|auth[_-]?token|password)\b\s*[:=]\s*['\"][^'\"\n]{16,}['\"]/gi]
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTENSIONS.has(path.extname(entry.name).toLowerCase()) || entry.name === 'manifest.webmanifest') out.push(full);
  }
  return out;
}

const findings = [];
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file).replaceAll('\\', '/');
  const text = fs.readFileSync(file, 'utf8');
  for (const [label, regex] of rules) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text))) {
      const line = text.slice(0, match.index).split('\n').length;
      findings.push(`${rel}:${line} [${label}]`);
      if (!regex.global) break;
    }
  }
}

if (findings.length) {
  console.error('Secret audit failed. Potential credentials found:');
  for (const finding of findings) console.error(` - ${finding}`);
  console.error('Move secrets to a backend or GitHub Actions secrets; never ship them to browser code.');
  process.exit(1);
}

console.log('Secret audit passed: no known credential patterns detected.');

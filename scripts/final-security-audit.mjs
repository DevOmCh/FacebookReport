import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as Docx from 'docx';
import PapaParseModule from 'papaparse';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const fail = message => {
  console.error(`SECURITY AUDIT FAILED: ${message}`);
  process.exit(1);
};
const assert = (condition, message) => { if (!condition) fail(message); };
const read = file => fs.readFileSync(file, 'utf8');
const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const normalize = values => [...values].sort();
const sameSet = (a, b) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));

assert(fs.existsSync(DIST), 'dist/ does not exist; run npm run build first');

const files = [];
const walk = dir => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else files.push(absolute);
  }
};
walk(DIST);

const relativeFiles = files.map(file => path.relative(DIST, file).split(path.sep).join('/'));
for (const file of relativeFiles) {
  assert(!/\.(?:map|ts|tsx|scss|sass|less|env)$/i.test(file), `forbidden development artifact: ${file}`);
  assert(!/(^|\/)\.env(?:\.|$)/i.test(file), `environment file leaked: ${file}`);
}

const textExtensions = new Set(['.html', '.js', '.css', '.json', '.txt', '.xml', '.webmanifest', '.svg', '.nojekyll']);
const forbiddenRuntimeHosts = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com'
];
for (const file of files) {
  const ext = path.extname(file).toLowerCase();
  if (!textExtensions.has(ext) && path.basename(file) !== '.nojekyll') continue;
  const text = read(file);
  assert(!/sourceMappingURL/i.test(text), `sourceMappingURL found in ${path.relative(DIST, file)}`);
  for (const host of forbiddenRuntimeHosts) {
    assert(!text.includes(host), `external static-runtime host ${host} found in ${path.relative(DIST, file)}`);
  }
}

const indexPath = path.join(DIST, 'index.html');
const manifestPath = path.join(DIST, 'build-manifest.json');
const pwaManifestPath = path.join(DIST, 'manifest.webmanifest');
const swPath = path.join(DIST, 'sw.js');
const sumsPath = path.join(DIST, 'SHA256SUMS.txt');
const noticesPath = path.join(DIST, 'THIRD_PARTY_NOTICES.txt');
for (const required of [indexPath, manifestPath, pwaManifestPath, swPath, sumsPath, noticesPath, path.join(DIST, 'offline.html')]) {
  assert(fs.existsSync(required), `required production file missing: ${path.basename(required)}`);
}

const html = read(indexPath);
const manifest = JSON.parse(read(manifestPath));
const pwa = JSON.parse(read(pwaManifestPath));
const sw = read(swPath);

assert(manifest.version === '8.5.0', 'build-manifest version must be 8.5.0');
assert(manifest.productionFreeze === true, 'productionFreeze must be true');
assert(manifest.reproducibleBuild === true, 'reproducibleBuild must be true');
assert(manifest.sourceMaps === false, 'sourceMaps must be false');
assert(manifest.fullSourceExtraction === true, 'fullSourceExtraction must be true');
assert(manifest.inlineStyleBlocks === 0, 'inlineStyleBlocks must be 0');
assert(manifest.executableInlineScripts === 0, 'executableInlineScripts must be 0');
assert(manifest.vendorSelfHosted === true, 'vendorSelfHosted must be true');
assert(manifest.fontsSelfHosted === true, 'fontsSelfHosted must be true');
assert(manifest.zeroExternalStaticRuntime === true, 'zeroExternalStaticRuntime must be true');
assert(manifest.cspLockdown === true, 'cspLockdown must be true');
assert(Array.isArray(manifest.externalStaticRuntimeHosts) && manifest.externalStaticRuntimeHosts.length === 0, 'externalStaticRuntimeHosts must be empty');
assert(manifest.obfuscationSeed === 850, 'obfuscation seed must be frozen to 850');

const expectedDataHosts = [
  'https://docs.google.com',
  'https://images.unsplash.com',
  'https://*.fbcdn.net',
  'https://*.googleusercontent.com'
];
assert(sameSet(manifest.externalDataHosts || [], expectedDataHosts), 'externalDataHosts differ from frozen allowlist');

const expectedVendors = {
  docx: '8.5.0',
  'file-saver': '2.0.5',
  papaparse: '5.4.1'
};
for (const [name, version] of Object.entries(expectedVendors)) {
  const found = (manifest.vendors || []).find(item => item.name === name);
  assert(found?.version === version, `vendor ${name} must be frozen at ${version}`);
}

assert(manifest.assets?.vendor && /^assets\/vendor\.[a-f0-9]{12}\.min\.js$/.test(manifest.assets.vendor), 'hashed vendor bundle missing');
assert(manifest.assets?.js && /^assets\/app\.[a-f0-9]{12}\.min\.js$/.test(manifest.assets.js), 'hashed application JS missing');
assert(manifest.assets?.css && /^assets\/app\.[a-f0-9]{12}\.min\.css$/.test(manifest.assets.css), 'hashed application CSS missing');
assert(Array.isArray(manifest.assets?.fonts) && manifest.assets.fonts.length > 0, 'self-hosted font assets missing');

for (const file of [manifest.assets.vendor, manifest.assets.js, manifest.assets.css, ...manifest.assets.fonts, manifest.assets.serviceWorker]) {
  const absolute = path.join(DIST, file);
  assert(fs.existsSync(absolute), `manifest references missing asset: ${file}`);
  const expectedDigest = manifest.assetDigests?.[file];
  assert(/^[a-f0-9]{64}$/.test(expectedDigest || ''), `missing SHA-256 digest for ${file}`);
  assert(sha256File(absolute) === expectedDigest, `asset digest mismatch: ${file}`);
}

assert(!/<style\b/i.test(html), 'inline <style> block remains');
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  const attrs = match[1];
  const body = match[2].trim();
  if (!/\bsrc\s*=/.test(attrs) && body) fail('executable inline script remains');
}
assert(!/<script\b[^>]*\bsrc=["']https?:\/\//i.test(html), 'external script tag remains');
assert(!/<link\b(?=[^>]*\brel=["'][^"']*stylesheet[^"']*["'])[^>]*\bhref=["']https?:\/\//i.test(html), 'external stylesheet remains');
assert(/<meta\b[^>]*name=["']mobile-web-app-capable["'][^>]*content=["']yes["']/i.test(html), 'mobile-web-app-capable meta missing');

const cspTag = html.match(/<meta\b(?=[^>]*\bhttp-equiv=(["'])Content-Security-Policy\1)[^>]*>/i)?.[0];
assert(cspTag, 'Content-Security-Policy meta tag missing');
const csp = cspTag.match(/\bcontent=(["'])([\s\S]*?)\1/i)?.[2];
assert(csp, 'CSP content attribute missing');

const directives = new Map();
for (const raw of csp.split(';').map(v => v.trim()).filter(Boolean)) {
  const [name, ...tokens] = raw.split(/\s+/);
  directives.set(name.toLowerCase(), tokens);
}
const expectDirective = (name, tokens) => {
  assert(directives.has(name), `CSP directive missing: ${name}`);
  assert(sameSet(directives.get(name), tokens), `CSP directive ${name} differs from frozen baseline`);
};
expectDirective('default-src', ["'self'"]);
expectDirective('script-src', ["'self'"]);
expectDirective('script-src-elem', ["'self'"]);
expectDirective('script-src-attr', ["'none'"]);
expectDirective('style-src', ["'self'"]);
expectDirective('style-src-elem', ["'self'"]);
expectDirective('style-src-attr', ["'unsafe-inline'"]);
expectDirective('font-src', ["'self'"]);
expectDirective('object-src', ["'none'"]);
expectDirective('base-uri', ["'none'"]);
expectDirective('frame-src', ["'none'"]);
expectDirective('worker-src', ["'self'"]);
expectDirective('form-action', ["'self'"]);
expectDirective('manifest-src', ["'self'"]);
expectDirective('connect-src', ["'self'", ...expectedDataHosts]);
expectDirective('img-src', ["'self'", 'data:', 'blob:', 'https://images.unsplash.com', 'https://*.fbcdn.net', 'https://*.googleusercontent.com']);
assert(directives.has('upgrade-insecure-requests'), 'upgrade-insecure-requests missing');
assert((directives.get('upgrade-insecure-requests') || []).length === 0, 'upgrade-insecure-requests must not have tokens');
assert(!csp.includes("'unsafe-eval'"), 'unsafe-eval must not be present');
assert(!/script-src[^;]*'unsafe-inline'/i.test(csp), 'unsafe-inline must not be allowed for scripts');

assert(/facebookreport-v8\.5-[a-f0-9]{8}/i.test(sw), 'service worker cache version is not Phase 8.5');
for (const host of forbiddenRuntimeHosts) assert(!sw.includes(host), `service worker contains forbidden runtime host: ${host}`);

assert(pwa.id === './', 'PWA id must remain ./');
assert(pwa.start_url === './', 'PWA start_url must remain ./');
assert(pwa.scope === './', 'PWA scope must remain ./');
assert(['standalone', 'fullscreen', 'minimal-ui'].includes(pwa.display), 'PWA display mode is not installable');
assert(Array.isArray(pwa.icons) && pwa.icons.length > 0, 'PWA icons missing');
for (const icon of pwa.icons) {
  if (icon?.src?.startsWith('./')) assert(fs.existsSync(path.join(DIST, icon.src.slice(2))), `PWA icon missing: ${icon.src}`);
}

const checksums = read(sumsPath).trim().split(/\r?\n/).filter(Boolean);
assert(checksums.length > 0, 'SHA256SUMS.txt is empty');
for (const line of checksums) {
  const match = line.match(/^([a-f0-9]{64})  (.+)$/);
  assert(match, `invalid SHA256SUMS entry: ${line}`);
  const [, digest, file] = match;
  const absolute = path.join(DIST, file);
  assert(fs.existsSync(absolute), `checksum references missing file: ${file}`);
  assert(sha256File(absolute) === digest, `SHA256SUMS mismatch: ${file}`);
}

// Build-time functional smoke checks for report/CSV dependencies.
const { Document, Packer, Paragraph } = Docx;
const smokeDoc = new Document({ sections: [{ children: [new Paragraph('FacebookReport Phase 8.5 security smoke test')] }] });
const smokeBuffer = await Packer.toBuffer(smokeDoc);
assert(smokeBuffer.byteLength > 500, 'docx smoke test failed');

const Papa = PapaParseModule?.default || PapaParseModule;
const parsed = Papa.parse('title,count\nกิจกรรม,1', { header: true });
assert(parsed.errors.length === 0 && parsed.data?.[0]?.count === '1', 'PapaParse smoke test failed');

const vendorBundle = read(path.join(DIST, manifest.assets.vendor));
assert(/saveAs/.test(vendorBundle), 'FileSaver saveAs export not found in vendor bundle');

console.log('Phase 8.5 final security audit: PASS');
console.log(` - production files checked: ${relativeFiles.length}`);
console.log(` - local font assets checked: ${manifest.assets.fonts.length}`);
console.log(' - CSP baseline: locked');
console.log(' - external static runtime: 0');
console.log(' - PWA baseline: valid');
console.log(' - DOCX/CSV smoke tests: PASS');
console.log(' - SHA-256 artifact integrity: PASS');

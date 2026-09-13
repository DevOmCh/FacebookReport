import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import CleanCSS from 'clean-css';
import { minify as minifyHtml } from 'html-minifier-terser';
import { minify as minifyJs } from 'terser';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const ASSETS = path.join(DIST, 'assets');

const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const sha = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
const sri = text => `sha256-${crypto.createHash('sha256').update(text).digest('base64')}`;
const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(ASSETS, { recursive: true });

// 1) CSS: minify and fingerprint.
const cssInput = read('phase7.css');
const cssResult = new CleanCSS({ level: 2 }).minify(cssInput);
if (cssResult.errors.length) throw new Error(cssResult.errors.join('\n'));
const cssName = `app.${sha(cssResult.styles)}.min.css`;
write(path.join(ASSETS, cssName), cssResult.styles);

// 2) JS: bundle Phase 7 runtime + PWA registration, then minify and fingerprint.
const jsInput = `${read('pwa-register.js')}\n${read('phase7.js')}`;
const jsResult = await minifyJs(jsInput, {
  compress: { passes: 2, drop_console: false },
  mangle: true,
  format: { comments: false }
});
if (!jsResult.code) throw new Error('Terser produced no application bundle.');
const jsName = `app.${sha(jsResult.code)}.min.js`;
write(path.join(ASSETS, jsName), jsResult.code);

// 3) HTML: switch to fingerprinted assets and aggressively minify production markup.
let html = read('index.html');
html = html
  .replace('<link rel="stylesheet" href="./phase7.css">', `<link rel="stylesheet" href="./assets/${cssName}">`)
  .replace('<script src="./pwa-register.js" defer></script>\n<script src="./phase7.js" defer></script>', `<script src="./assets/${jsName}" defer></script>`);

html = await minifyHtml(html, {
  collapseWhitespace: true,
  conservativeCollapse: false,
  removeComments: true,
  removeRedundantAttributes: true,
  removeEmptyAttributes: false,
  removeOptionalTags: false,
  sortAttributes: false,
  sortClassName: false,
  minifyCSS: true,
  minifyJS: true,
  keepClosingSlash: true,
  decodeEntities: false,
  useShortDoctype: true
});

// Recompute all CSP hashes for inline scripts after minification.
const inlineScripts = [];
for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
  if (match[1].trim()) inlineScripts.push(sri(match[1]));
}
html = html.replace(/(<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]+content=["'])([^"']*)(["'][^>]*>)/i, (_, start, policy, end) => {
  const cleaned = policy.replace(/\s+'sha256-[A-Za-z0-9+/=]+'/g, '');
  const hashes = inlineScripts.map(hash => ` '${hash}'`).join('');
  const updated = cleaned.replace(/script-src([^;]*)/i, (segment) => `${segment}${hashes}`);
  return `${start}${updated}${end}`;
});
write(path.join(DIST, 'index.html'), html);

// 4) Service Worker: point precache at fingerprinted assets, bump cache version, minify.
let sw = read('sw.js')
  .replace(/const CACHE_VERSION = ['"][^'"]+['"];/, `const CACHE_VERSION = 'facebookreport-v8-${sha(html).slice(0, 8)}';`)
  .replace("coreUrl('./pwa-register.js'),\n  coreUrl('./phase7.css'),\n  coreUrl('./phase7.js')", `coreUrl('./assets/${cssName}'),\n  coreUrl('./assets/${jsName}')`);
const swResult = await minifyJs(sw, {
  compress: { passes: 2 },
  mangle: true,
  format: { comments: false }
});
if (!swResult.code) throw new Error('Terser produced no service worker.');
write(path.join(DIST, 'sw.js'), swResult.code);

// 5) Copy stable public files. These stay unhashed because browsers/metadata refer to fixed URLs.
for (const file of ['404.html', 'offline.html', 'manifest.webmanifest', 'favicon.svg', 'robots.txt', 'sitemap.xml', '.nojekyll']) {
  const source = path.join(ROOT, file);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(DIST, file));
}

// 6) Production manifest for auditability; no source maps are generated.
const manifest = {
  version: 8,
  generatedAt: new Date().toISOString(),
  sourceMaps: false,
  assets: {
    css: `assets/${cssName}`,
    js: `assets/${jsName}`,
    serviceWorker: 'sw.js'
  }
};
write(path.join(DIST, 'build-manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`Phase 8 build complete: ${path.relative(ROOT, DIST)}`);
console.log(` - ${manifest.assets.css}`);
console.log(` - ${manifest.assets.js}`);
console.log(' - source maps: disabled');

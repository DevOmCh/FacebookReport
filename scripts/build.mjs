import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import CleanCSS from 'clean-css';
import { minify as minifyHtml } from 'html-minifier-terser';
import { minify as minifyJs } from 'terser';
import JavaScriptObfuscator from 'javascript-obfuscator';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const ASSETS = path.join(DIST, 'assets');

const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const sha = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

const isExecutableInlineScript = attrs => {
  if (/\bsrc\s*=/.test(attrs)) return false;
  const type = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
  return !type || type === 'text/javascript' || type === 'application/javascript' || type === 'module';
};

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(ASSETS, { recursive: true });

// Phase 8.3: extract every inline <style> and executable inline <script>
// from the production document, while leaving source files in the repository readable.
let html = read('index.html');

const inlineStyles = [];
html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => {
  if (css.trim()) inlineStyles.push(css);
  return '';
});

const inlineScripts = [];
html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (full, attrs, js) => {
  if (!isExecutableInlineScript(attrs)) return full;
  if (js.trim()) inlineScripts.push(js);
  return '';
});

// Remove legacy local runtime tags; their contents are bundled below.
html = html
  .replace(/<script\b[^>]*src=["']\.\/pwa-register\.js["'][^>]*><\/script>/gi, '')
  .replace(/<script\b[^>]*src=["']\.\/phase7\.js["'][^>]*><\/script>/gi, '');

// 1) CSS: legacy stylesheet + all extracted inline styles, then minify/fingerprint.
const cssInput = [read('phase7.css'), ...inlineStyles].join('\n');
const cssResult = new CleanCSS({ level: 2 }).minify(cssInput);
if (cssResult.errors.length) throw new Error(cssResult.errors.join('\n'));
const cssName = `app.${sha(cssResult.styles)}.min.css`;
write(path.join(ASSETS, cssName), cssResult.styles);

html = html.replace(
  /<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']\.\/phase7\.css["'][^>]*>/i,
  `<link rel="stylesheet" href="./assets/${cssName}">`
);

// 2) JS: app inline logic first (matching original parse order), then deferred PWA/Phase 7 runtime.
// Terser performs semantic minification/mangling; javascript-obfuscator adds a moderate
// production-only layer without control-flow flattening/dead-code injection to avoid runtime regressions.
const jsInput = [
  ...inlineScripts,
  read('pwa-register.js'),
  read('phase7.js')
].join('\n;\n');

const jsResult = await minifyJs(jsInput, {
  compress: {
    passes: 3,
    drop_console: false,
    booleans_as_integers: false
  },
  mangle: {
    toplevel: false,
    keep_classnames: true,
    keep_fnames: true
  },
  format: { comments: false }
});
if (!jsResult.code) throw new Error('Terser produced no application bundle.');

const obfuscatedJs = JavaScriptObfuscator.obfuscate(jsResult.code, {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  renameProperties: false,
  selfDefending: false,
  simplify: true,
  splitStrings: false,
  stringArray: true,
  stringArrayCallsTransform: false,
  stringArrayEncoding: [],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 0.35,
  transformObjectKeys: false,
  unicodeEscapeSequence: false
}).getObfuscatedCode();

if (!obfuscatedJs) throw new Error('Obfuscator produced no application bundle.');
if (/sourceMappingURL/i.test(obfuscatedJs)) throw new Error('Unexpected sourceMappingURL in production JS.');

const jsName = `app.${sha(obfuscatedJs)}.min.js`;
write(path.join(ASSETS, jsName), obfuscatedJs);

// Load the single generated application bundle after parsing, while CDN libraries remain unchanged.
html = html.replace('</head>', `<script src="./assets/${jsName}" defer></script></head>`);

// 3) CSP hardening: executable inline scripts are gone, so old sha256 script hashes are unnecessary.
html = html.replace(/(<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]+content=["'])([^"']*)(["'][^>]*>)/i,
  (_, start, policy, end) => {
    const cleaned = policy.replace(/\s+'sha256-[A-Za-z0-9+/=]+'/g, '');
    return `${start}${cleaned}${end}`;
  }
);

// 4) Aggressively minify production markup. CSS in style attributes may still be minified;
// there must be no <style> block or executable inline script afterward.
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
  minifyJS: false,
  keepClosingSlash: true,
  decodeEntities: false,
  useShortDoctype: true
});

if (/<style\b/i.test(html)) throw new Error('Phase 8.3 verification failed: inline <style> remains in production HTML.');
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (isExecutableInlineScript(match[1]) && match[2].trim()) {
    throw new Error('Phase 8.3 verification failed: executable inline script remains in production HTML.');
  }
}
if (/phase7\.(?:css|js)|pwa-register\.js/i.test(html)) {
  throw new Error('Phase 8.3 verification failed: legacy asset reference remains in production HTML.');
}
write(path.join(DIST, 'index.html'), html);

// 5) Service Worker: precache only generated hashed assets and bump cache generation.
let sw = read('sw.js')
  .replace(/const CACHE_VERSION = ['"][^'"]+['"];/, `const CACHE_VERSION = 'facebookreport-v8.3-${sha(html).slice(0, 8)}';`)
  .replace("coreUrl('./pwa-register.js'),\n  coreUrl('./phase7.css'),\n  coreUrl('./phase7.js')", `coreUrl('./assets/${cssName}'),\n  coreUrl('./assets/${jsName}')`);

const swResult = await minifyJs(sw, {
  compress: { passes: 2 },
  mangle: true,
  format: { comments: false }
});
if (!swResult.code) throw new Error('Terser produced no service worker.');
if (/sourceMappingURL/i.test(swResult.code)) throw new Error('Unexpected sourceMappingURL in service worker.');
write(path.join(DIST, 'sw.js'), swResult.code);

// 6) Copy stable public files. These stay unhashed because browsers/metadata use fixed URLs.
for (const file of ['404.html', 'offline.html', 'manifest.webmanifest', 'favicon.svg', 'robots.txt', 'sitemap.xml', '.nojekyll']) {
  const source = path.join(ROOT, file);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(DIST, file));
}

// 7) Production manifest for automated verification.
const manifest = {
  version: '8.3',
  generatedAt: new Date().toISOString(),
  sourceMaps: false,
  fullSourceExtraction: true,
  inlineStyleBlocks: 0,
  executableInlineScripts: 0,
  obfuscated: true,
  assets: {
    css: `assets/${cssName}`,
    js: `assets/${jsName}`,
    serviceWorker: 'sw.js'
  }
};
write(path.join(DIST, 'build-manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`Phase 8.3 build complete: ${path.relative(ROOT, DIST)}`);
console.log(` - ${manifest.assets.css}`);
console.log(` - ${manifest.assets.js}`);
console.log(` - extracted inline styles: ${inlineStyles.length}`);
console.log(` - extracted inline scripts: ${inlineScripts.length}`);
console.log(' - obfuscation: enabled (moderate/safe profile)');
console.log(' - source maps: disabled');

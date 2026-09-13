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
const readAbs = file => fs.readFileSync(file, 'utf8');
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

const stripVendorScriptTags = doc => doc.replace(
  /<script\b([^>]*)\bsrc=(['"])([^'"]+)\2([^>]*)><\/script>/gi,
  (full, before, quote, src) => {
    const value = src.toLowerCase();
    const isVendor =
      value.includes('/docx@8.5.0/') ||
      value.includes('/filesaver.js/2.0.5/') ||
      value.includes('/papaparse/5.4.1/');
    return isVendor ? '' : full;
  }
);

const ensureMobileMeta = doc => {
  if (/<meta\b[^>]*name=["']mobile-web-app-capable["'][^>]*>/i.test(doc)) return doc;
  const apple = /<meta\b[^>]*name=["']apple-mobile-web-app-capable["'][^>]*>/i;
  if (apple.test(doc)) {
    return doc.replace(apple, '<meta name="mobile-web-app-capable" content="yes">$&');
  }
  return doc.replace('</head>', '<meta name="mobile-web-app-capable" content="yes"></head>');
};

const rewriteCsp = doc => doc.replace(
  /<meta\b(?=[^>]*\bhttp-equiv=(['"])Content-Security-Policy\1)[^>]*>/i,
  tag => tag.replace(
    /\bcontent=(['"])([\s\S]*?)\1/i,
    (_, quote, policy) => {
      const directives = policy
        .split(';')
        .map(v => v.trim())
        .filter(Boolean)
        .map(v => {
          const [name, ...tokens] = v.split(/\s+/);
          return [name.toLowerCase(), tokens];
        });

      const map = new Map(directives);
      map.set('script-src', ["'self'"]);

      if (map.has('connect-src')) {
        map.set(
          'connect-src',
          map.get('connect-src').filter(token =>
            !/cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com/i.test(token)
          )
        );
      }

      const serialized = [...map.entries()]
        .map(([name, tokens]) => [name, ...tokens].join(' '))
        .join('; ') + ';';

      return `content=${quote}${serialized}${quote}`;
    }
  )
);

const findLicenseText = pkgDir => {
  for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'LICENCE.txt']) {
    const file = path.join(pkgDir, name);
    if (fs.existsSync(file)) return readAbs(file).trim();
  }
  return 'License file not found in installed package.';
};

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(ASSETS, { recursive: true });

// Phase 8.3.2: remove all third-party CDN script tags before extraction.
let html = stripVendorScriptTags(read('index.html'));
html = ensureMobileMeta(html);

// Extract every inline <style> and executable inline <script> from production HTML.
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

// Remove local runtime tags; they are bundled into the application asset below.
html = html
  .replace(/<script\b[^>]*src=["']\.\/pwa-register\.js["'][^>]*><\/script>/gi, '')
  .replace(/<script\b[^>]*src=["']\.\/phase7\.js["'][^>]*><\/script>/gi, '');

// 1) CSS: legacy stylesheet + extracted inline styles.
const cssInput = [read('phase7.css'), ...inlineStyles].join('\n');
const cssResult = new CleanCSS({ level: 2 }).minify(cssInput);
if (cssResult.errors.length) throw new Error(cssResult.errors.join('\n'));
const cssName = `app.${sha(cssResult.styles)}.min.css`;
write(path.join(ASSETS, cssName), cssResult.styles);

html = html.replace(
  /<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']\.\/phase7\.css["'][^>]*>/i,
  `<link rel="stylesheet" href="./assets/${cssName}">`
);

// 2) Vendor bundle: exact versions formerly loaded from CDN, now self-hosted from npm.
// Keep global API compatibility: docx, saveAs and Papa are provided by their UMD builds.
const vendorSpecs = [
  { name: 'docx', version: '8.5.0', file: 'node_modules/docx/build/index.umd.js' },
  { name: 'file-saver', version: '2.0.5', file: 'node_modules/file-saver/dist/FileSaver.min.js' },
  { name: 'papaparse', version: '5.4.1', file: 'node_modules/papaparse/papaparse.min.js' }
];

for (const vendor of vendorSpecs) {
  const file = path.join(ROOT, vendor.file);
  if (!fs.existsSync(file)) throw new Error(`Missing vendor build: ${vendor.file}`);
}

const vendorInput = vendorSpecs.map(v => read(v.file)).join('\n;\n');
const vendorResult = await minifyJs(vendorInput, {
  compress: false,
  mangle: false,
  format: { comments: /@license|^!/i }
});
if (!vendorResult.code) throw new Error('Terser produced no vendor bundle.');
if (/sourceMappingURL/i.test(vendorResult.code)) throw new Error('Unexpected sourceMappingURL in vendor bundle.');
const vendorName = `vendor.${sha(vendorResult.code)}.min.js`;
write(path.join(ASSETS, vendorName), vendorResult.code);

// 3) Application bundle: inline app logic + PWA registration + Phase 7 runtime.
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

// Vendor executes before app because deferred scripts preserve document order.
html = html.replace(
  '</head>',
  `<script src="./assets/${vendorName}" defer></script><script src="./assets/${jsName}" defer></script></head>`
);

// 4) CSP: no external script hosts and no inline executable script hashes are required.
html = rewriteCsp(html);

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

// 5) Hard production assertions.
if (/<style\b/i.test(html)) throw new Error('Phase 8.3.2 failed: inline <style> remains.');
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (isExecutableInlineScript(match[1]) && match[2].trim()) {
    throw new Error('Phase 8.3.2 failed: executable inline script remains.');
  }
}
if (/phase7\.(?:css|js)|pwa-register\.js/i.test(html)) {
  throw new Error('Phase 8.3.2 failed: legacy asset reference remains.');
}
if (/cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com/i.test(html)) {
  throw new Error('Phase 8.3.2 failed: CDN vendor host remains in production HTML/CSP.');
}
if (/<script\b[^>]*\bsrc=["']https?:\/\//i.test(html)) {
  throw new Error('Phase 8.3.2 failed: external script remains in production HTML.');
}
if (!/<meta\b[^>]*name=["']mobile-web-app-capable["'][^>]*content=["']yes["']/i.test(html)) {
  throw new Error('Phase 8.3.2 failed: mobile-web-app-capable metadata missing.');
}
write(path.join(DIST, 'index.html'), html);

// 6) Service Worker: precache generated vendor/app/CSS assets and rotate cache generation.
let sw = read('sw.js')
  .replace(/const CACHE_VERSION = ['"][^'"]+['"];/, `const CACHE_VERSION = 'facebookreport-v8.3.2-${sha(html).slice(0, 8)}';`)
  .replace(
    /coreUrl\('\.\/pwa-register\.js'\),\s*coreUrl\('\.\/phase7\.css'\),\s*coreUrl\('\.\/phase7\.js'\)/m,
    `coreUrl('./assets/${cssName}'),\n  coreUrl('./assets/${vendorName}'),\n  coreUrl('./assets/${jsName}')`
  );

if (/pwa-register\.js|phase7\.(?:css|js)/i.test(sw)) {
  throw new Error('Phase 8.3.2 failed: service worker still references legacy assets.');
}

const swResult = await minifyJs(sw, {
  compress: { passes: 2 },
  mangle: true,
  format: { comments: false }
});
if (!swResult.code) throw new Error('Terser produced no service worker.');
if (/sourceMappingURL/i.test(swResult.code)) throw new Error('Unexpected sourceMappingURL in service worker.');
write(path.join(DIST, 'sw.js'), swResult.code);

// 7) Stable public files.
for (const file of ['404.html', 'offline.html', 'manifest.webmanifest', 'favicon.svg', 'robots.txt', 'sitemap.xml', '.nojekyll']) {
  const source = path.join(ROOT, file);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(DIST, file));
}

// 8) Third-party notices generated from the installed package licenses.
const noticeSections = vendorSpecs.map(vendor => {
  const dir = path.join(ROOT, 'node_modules', vendor.name);
  const pkg = JSON.parse(readAbs(path.join(dir, 'package.json')));
  return [
    `${pkg.name} ${pkg.version}`,
    `Declared license: ${pkg.license || 'unknown'}`,
    '',
    findLicenseText(dir)
  ].join('\n');
});
write(
  path.join(DIST, 'THIRD_PARTY_NOTICES.txt'),
  `FacebookReport — third-party notices\nGenerated at build time.\n\n${noticeSections.join('\n\n' + '='.repeat(72) + '\n\n')}\n`
);

// 9) Production manifest.
const manifest = {
  version: '8.3.2',
  generatedAt: new Date().toISOString(),
  sourceMaps: false,
  fullSourceExtraction: true,
  inlineStyleBlocks: 0,
  executableInlineScripts: 0,
  obfuscated: true,
  vendorSelfHosted: true,
  externalScriptHosts: [],
  vendors: vendorSpecs.map(({ name, version }) => ({ name, version })),
  assets: {
    css: `assets/${cssName}`,
    vendor: `assets/${vendorName}`,
    js: `assets/${jsName}`,
    serviceWorker: 'sw.js'
  }
};
write(path.join(DIST, 'build-manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`Phase 8.3.2 build complete: ${path.relative(ROOT, DIST)}`);
console.log(` - ${manifest.assets.css}`);
console.log(` - ${manifest.assets.vendor}`);
console.log(` - ${manifest.assets.js}`);
console.log(` - extracted inline styles: ${inlineStyles.length}`);
console.log(` - extracted inline scripts: ${inlineScripts.length}`);
console.log(' - vendor scripts: self-hosted');
console.log(' - external script hosts: 0');
console.log(' - source maps: disabled');

# FacebookReport Security Baseline — Phase 8.5

This file defines the frozen production security baseline for the GitHub Pages deployment.

## Frozen runtime baseline

- Phase: **8.5.0 — Final Security Audit + Production Freeze**
- Node build runtime: **22.x**
- All direct build dependencies use exact versions (no `^`, `~`, `*`, or ranges).
- JavaScript, CSS, vendor libraries, Prompt fonts, and Sarabun fonts are all same-origin production assets.
- Source maps are disabled and rejected by CI.
- Executable inline scripts are forbidden.
- Inline `<style>` blocks are forbidden.
- Application JavaScript is minified/obfuscated with deterministic seed `850`.
- Every generated runtime asset has a SHA-256 digest in `build-manifest.json`.
- Every deployed file is covered by `SHA256SUMS.txt`.
- CI builds twice and compares both `dist/` trees. A non-reproducible build fails deployment.

## Frozen CSP baseline

Static runtime:

- `default-src 'self'`
- `script-src 'self'`
- `script-src-elem 'self'`
- `script-src-attr 'none'`
- `style-src 'self'`
- `style-src-elem 'self'`
- `style-src-attr 'unsafe-inline'` — retained only for the current UI's style attributes / `element.style` updates
- `font-src 'self'`
- `object-src 'none'`
- `base-uri 'none'`
- `frame-src 'none'`
- `worker-src 'self'`
- `form-action 'self'`
- `manifest-src 'self'`
- `upgrade-insecure-requests`

Allowed external **data/image** origins only:

- `https://docs.google.com`
- `https://images.unsplash.com`
- `https://*.fbcdn.net`
- `https://*.googleusercontent.com`

No external JavaScript, stylesheet, or font host is permitted in production.

## Mandatory CI gates

Deployment must fail when any of the following reappears:

- `.map`, `.ts`, `.tsx`, `.scss`, `.sass`, `.less`, or `.env` production files
- `sourceMappingURL`
- Google Fonts, jsDelivr, or cdnjs runtime references
- external `<script src="https://...">`
- external stylesheet links
- executable inline JavaScript
- CSP drift from the frozen allowlist
- missing PWA core files
- missing or mismatched SHA-256 asset digests
- failed DOCX generation smoke test
- failed PapaParse CSV smoke test
- missing FileSaver `saveAs` runtime export
- non-reproducible production builds
- critical npm vulnerability audit failure

## Residual platform limitations

GitHub Pages does not provide repository-controlled arbitrary HTTP response headers. The CSP is therefore delivered by `<meta http-equiv="Content-Security-Policy">`. Some protections, especially CSP `frame-ancestors`, require an HTTP response header and cannot be fully enforced by this static Pages setup. A reverse proxy/CDN or a hosting platform with configurable response headers is required for that final layer.

Published Google Sheets/CSV data requested by browser JavaScript is public to the browser by design. Do not place credentials, private records, API secrets, access tokens, or authorization logic in client-side code or published sheets.

## Change policy after freeze

Any change to CSP, dependencies, build tooling, service-worker policy, external origin allowlists, report export dependencies, or production asset rules should be treated as a new reviewed security phase. Do not edit generated `dist/` artifacts manually; production must come only from the GitHub Actions build.

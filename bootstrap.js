(() => {
  'use strict';

  const PARTS = [
    '.parts/app00.b64',
    '.parts/app01.b64',
    '.parts/app02.b64',
    '.parts/app03.b64',
    '.parts/app04.b64'
  ];
  const EXPECTED_SHA256 = 'fc2f44ea7dd9ae2937e9886135d87a55f9fa5ef74b541b6efb39f42d432d076d';

  function toHex(buffer) {
    return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
  }

  async function loadPart(path) {
    const response = await fetch(path, {
      cache: 'no-store',
      credentials: 'same-origin',
      referrerPolicy: 'no-referrer'
    });
    if (!response.ok) throw new Error(`โหลด ${path} ไม่สำเร็จ (HTTP ${response.status})`);
    return (await response.text()).trim();
  }

  async function boot() {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('เบราว์เซอร์นี้ไม่รองรับ DecompressionStream กรุณาใช้ Chrome, Edge หรือ Firefox รุ่นปัจจุบัน');
    }

    const base64 = (await Promise.all(PARTS.map(loadPart))).join('');
    const binary = atob(base64);
    const compressed = Uint8Array.from(binary, ch => ch.charCodeAt(0));
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
    const html = await new Response(stream).text();

    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html));
    const actual = toHex(digest);
    if (actual !== EXPECTED_SHA256) {
      throw new Error('ตรวจสอบความถูกต้องของ Dashboard ไม่ผ่าน (SHA-256 mismatch)');
    }

    document.open();
    document.write(html);
    document.close();
  }

  boot().catch(error => {
    console.error('Dashboard bootstrap failed:', error);
    document.body.replaceChildren();
    const main = document.createElement('main');
    main.style.cssText = 'max-width:760px;margin:64px auto;padding:24px;font-family:system-ui,sans-serif;line-height:1.65';
    const h1 = document.createElement('h1');
    h1.textContent = 'โหลดแดชบอร์ดไม่สำเร็จ';
    const p = document.createElement('p');
    p.textContent = error && error.message ? error.message : String(error);
    main.append(h1, p);
    document.body.append(main);
  });
})();

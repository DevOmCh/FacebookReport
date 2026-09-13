# FacebookReport — โรงเรียนวัดร้องอ้อ

Production dashboard สำหรับติดตาม ค้นหา สรุป และจัดทำรายงานกิจกรรมของโรงเรียนวัดร้องอ้อ

## Live site

https://devomch.github.io/FacebookReport/

## Production architecture

- Direct Secure Build: `index.html` เป็นตัวแอปโดยตรง ไม่มี runtime bootstrap/base64 payload
- Content Security Policy (CSP) ในเอกสารหลัก
- Subresource Integrity (SRI) สำหรับ `docx`, `FileSaver.js` และ `PapaParse`
- Google Sheets ใช้ CSV `fetch()`; ไม่มี JSONP และไม่มี dynamic CDN fallback
- PWA: manifest + service worker + offline fallback
- SEO/Social: canonical, description, Open Graph, Twitter Card, robots.txt และ sitemap.xml
- GitHub Pages: `.nojekyll` เพื่อเสิร์ฟ static files โดยตรง

## Data freshness

Service Worker จะไม่ cache `docs.google.com` เพื่อป้องกันข้อมูลกิจกรรมเก่าถูกแสดงแบบเงียบ ๆ ข้อมูล Google Sheets จึงยังเป็น network-first ตามระบบหลัก

## Security note

GitHub Pages ไม่เปิดให้กำหนด HTTP security headers ของ origin ได้ทั้งหมด ดังนั้น CSP ปัจจุบันใช้ `<meta http-equiv="Content-Security-Policy">`. หากย้ายไป hosting ที่กำหนด response headers ได้ ควรเพิ่ม CSP response header (รวม `frame-ancestors`), HSTS, `X-Content-Type-Options` และ `Permissions-Policy`.

(() => {
  'use strict';
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', {
        scope: './',
        updateViaCache: 'none'
      });

      registration.update().catch(() => {});
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            console.info('FacebookReport: เวอร์ชันใหม่พร้อมใช้งานหลังรีเฟรชหน้า');
          }
        });
      });
    } catch (error) {
      console.warn('FacebookReport: ลงทะเบียน Service Worker ไม่สำเร็จ', error);
    }
  }, { once: true });
})();

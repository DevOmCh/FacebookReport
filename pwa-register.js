(() => {
  'use strict';
  if (!('serviceWorker' in navigator)) return;

  const emit = (name, registration) => {
    window.dispatchEvent(new CustomEvent(name, { detail: { registration } }));
  };

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', {
        scope: './',
        updateViaCache: 'none'
      });
      emit('facebookreport:sw-ready', registration);

      if (registration.waiting) emit('facebookreport:update-ready', registration);

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            emit('facebookreport:update-ready', registration);
          }
        });
      });

      registration.update().catch(() => {});
    } catch (error) {
      console.warn('FacebookReport: ลงทะเบียน Service Worker ไม่สำเร็จ', error);
      window.dispatchEvent(new CustomEvent('facebookreport:sw-error', { detail: { message: String(error?.message || error) } }));
    }
  }, { once: true });
})();

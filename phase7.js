(() => {
  'use strict';

  const metrics = {
    errors: 0,
    resourceErrors: 0,
    longTasks: 0,
    lcp: null,
    cls: 0,
    nav: null,
    installAvailable: false,
    updateReady: false
  };
  const logs = [];
  let deferredInstallPrompt = null;
  let updateRegistration = null;

  const log = (type, message) => {
    const item = { type, message: String(message).slice(0, 180), at: new Date().toLocaleTimeString('th-TH') };
    logs.unshift(item);
    logs.splice(12);
    render();
  };

  function buildUI() {
    const banner = document.createElement('div');
    banner.className = 'p7-banner';
    banner.id = 'p7Banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');

    const shell = document.createElement('div');
    shell.className = 'p7-shell';
    shell.id = 'p7Shell';
    shell.innerHTML = `
      <section class="p7-panel" id="p7Panel" aria-label="System Health">
        <div class="p7-head"><h2 class="p7-title">System Health</h2><button class="p7-close" id="p7Close" type="button" aria-label="ปิด">×</button></div>
        <div class="p7-status"><span><span class="p7-label">เครือข่าย</span><br><span id="p7Network" class="p7-badge">—</span></span><span class="p7-value" id="p7Connection">—</span></div>
        <div class="p7-status"><span><span class="p7-label">Service Worker</span><br><span id="p7Sw" class="p7-badge">กำลังตรวจสอบ</span></span><span class="p7-value" id="p7Version">Phase 7</span></div>
        <div class="p7-grid">
          <div class="p7-card"><span class="p7-label">Page load</span><strong id="p7Load">—</strong></div>
          <div class="p7-card"><span class="p7-label">LCP</span><strong id="p7Lcp">—</strong></div>
          <div class="p7-card"><span class="p7-label">CLS</span><strong id="p7Cls">0.000</strong></div>
          <div class="p7-card"><span class="p7-label">Errors</span><strong id="p7Errors">0</strong></div>
        </div>
        <div class="p7-actions">
          <button class="p7-btn" id="p7Install" type="button" hidden>ติดตั้งแอป</button>
          <button class="p7-btn" id="p7Update" type="button" hidden>อัปเดตตอนนี้</button>
          <button class="p7-btn secondary" id="p7Check" type="button">ตรวจอัปเดต</button>
          <button class="p7-btn secondary" id="p7Clear" type="button">ล้าง Log</button>
        </div>
        <div class="p7-log"><h3>เหตุการณ์ล่าสุด</h3><ol class="p7-log-list" id="p7Logs"><li>ยังไม่มีเหตุการณ์ผิดปกติ</li></ol></div>
        <p class="p7-muted">Monitoring ทำงานเฉพาะใน browser นี้ และไม่ส่งข้อมูลออกไปยัง analytics ภายนอก</p>
      </section>
      <button class="p7-fab" id="p7Fab" type="button" aria-expanded="false" aria-controls="p7Panel"><span class="p7-dot" aria-hidden="true"></span><span>System Health</span></button>`;

    document.body.append(banner, shell);

    const panel = document.getElementById('p7Panel');
    const fab = document.getElementById('p7Fab');
    const close = document.getElementById('p7Close');
    const toggle = open => {
      if (open) panel.setAttribute('open', ''); else panel.removeAttribute('open');
      fab.setAttribute('aria-expanded', String(open));
    };
    fab.addEventListener('click', () => toggle(!panel.hasAttribute('open')));
    close.addEventListener('click', () => toggle(false));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') toggle(false); });

    document.getElementById('p7Install').addEventListener('click', installApp);
    document.getElementById('p7Update').addEventListener('click', applyUpdate);
    document.getElementById('p7Check').addEventListener('click', checkUpdate);
    document.getElementById('p7Clear').addEventListener('click', () => { logs.length = 0; render(); });
    render();
  }

  function setBanner(message, actionLabel, action) {
    const banner = document.getElementById('p7Banner');
    if (!banner) return;
    banner.replaceChildren();
    const text = document.createElement('span');
    text.textContent = message;
    banner.append(text);
    if (actionLabel && action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = actionLabel;
      btn.addEventListener('click', action, { once: true });
      banner.append(btn);
    }
    banner.classList.add('show');
  }

  function clearBanner() {
    document.getElementById('p7Banner')?.classList.remove('show');
  }

  function networkLabel() {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) return navigator.onLine ? 'Online' : 'Offline';
    return navigator.onLine ? `${c.effectiveType || 'online'}${c.downlink ? ` · ${c.downlink} Mbps` : ''}` : 'Offline';
  }

  function render() {
    const shell = document.getElementById('p7Shell');
    if (!shell) return;
    const online = navigator.onLine;
    shell.classList.toggle('is-offline', !online);
    const network = document.getElementById('p7Network');
    network.textContent = online ? 'ออนไลน์' : 'ออฟไลน์';
    network.className = `p7-badge ${online ? 'ok' : 'warn'}`;
    document.getElementById('p7Connection').textContent = networkLabel();
    document.getElementById('p7Load').textContent = metrics.nav ? `${Math.round(metrics.nav)} ms` : '—';
    document.getElementById('p7Lcp').textContent = metrics.lcp ? `${Math.round(metrics.lcp)} ms` : '—';
    document.getElementById('p7Cls').textContent = metrics.cls.toFixed(3);
    document.getElementById('p7Errors').textContent = String(metrics.errors + metrics.resourceErrors);
    document.getElementById('p7Install').hidden = !metrics.installAvailable;
    document.getElementById('p7Update').hidden = !metrics.updateReady;
    const list = document.getElementById('p7Logs');
    if (logs.length) {
      list.replaceChildren(...logs.map(item => {
        const li = document.createElement('li');
        li.textContent = `[${item.at}] ${item.message}`;
        return li;
      }));
    } else {
      const li = document.createElement('li');
      li.textContent = 'ยังไม่มีเหตุการณ์ผิดปกติ';
      list.replaceChildren(li);
    }
  }

  async function installApp() {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice.catch(() => null);
    log('install', choice?.outcome === 'accepted' ? 'เริ่มติดตั้งแอปแล้ว' : 'ยกเลิกการติดตั้งแอป');
    deferredInstallPrompt = null;
    metrics.installAvailable = false;
    render();
  }

  async function applyUpdate() {
    const worker = updateRegistration?.waiting;
    if (!worker) return;
    worker.postMessage({ type: 'SKIP_WAITING' });
    setBanner('กำลังเปิดเวอร์ชันใหม่…');
  }

  async function checkUpdate() {
    if (!('serviceWorker' in navigator)) return;
    const registration = updateRegistration || await navigator.serviceWorker.getRegistration('./');
    if (!registration) { log('sw', 'ยังไม่มี Service Worker registration'); return; }
    try {
      await registration.update();
      log('sw', registration.waiting ? 'พบเวอร์ชันใหม่พร้อมอัปเดต' : 'ตรวจแล้ว เป็นเวอร์ชันล่าสุด');
    } catch (error) {
      log('sw', `ตรวจอัปเดตไม่สำเร็จ: ${error.message || error}`);
    }
  }

  function observePerformance() {
    try {
      const nav = performance.getEntriesByType('navigation')[0];
      if (nav) metrics.nav = nav.loadEventEnd || nav.duration;
    } catch (_) {}

    if ('PerformanceObserver' in window) {
      try {
        new PerformanceObserver(list => {
          const entries = list.getEntries();
          const last = entries[entries.length - 1];
          if (last) { metrics.lcp = last.startTime; render(); }
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      } catch (_) {}
      try {
        new PerformanceObserver(list => {
          for (const e of list.getEntries()) if (!e.hadRecentInput) metrics.cls += e.value;
          render();
        }).observe({ type: 'layout-shift', buffered: true });
      } catch (_) {}
      try {
        new PerformanceObserver(list => {
          metrics.longTasks += list.getEntries().length;
          if (metrics.longTasks === 1) log('perf', 'พบ long task บน main thread');
        }).observe({ type: 'longtask', buffered: true });
      } catch (_) {}
    }
    render();
  }

  function observeErrors() {
    window.addEventListener('error', event => {
      if (event.target && event.target !== window) {
        metrics.resourceErrors += 1;
        const src = event.target.src || event.target.href || event.target.tagName;
        log('resource', `โหลด resource ไม่สำเร็จ: ${src}`);
      } else {
        metrics.errors += 1;
        log('error', event.message || 'JavaScript error');
      }
    }, true);
    window.addEventListener('unhandledrejection', event => {
      metrics.errors += 1;
      const reason = event.reason?.message || event.reason || 'Unhandled promise rejection';
      log('promise', reason);
    });
  }

  function observeNetwork() {
    window.addEventListener('online', () => { clearBanner(); log('network', 'กลับมาออนไลน์แล้ว'); render(); });
    window.addEventListener('offline', () => { setBanner('ขณะนี้ออฟไลน์ ข้อมูล Google Sheets อาจไม่อัปเดต'); log('network', 'อุปกรณ์ออฟไลน์'); render(); });
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    c?.addEventListener?.('change', render);
    if (!navigator.onLine) setBanner('ขณะนี้ออฟไลน์ ข้อมูล Google Sheets อาจไม่อัปเดต');
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    metrics.installAvailable = true;
    setBanner('ติดตั้ง Dashboard เป็นแอปบนอุปกรณ์นี้ได้', 'ติดตั้ง', installApp);
    render();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    metrics.installAvailable = false;
    clearBanner();
    log('install', 'ติดตั้งแอปสำเร็จ');
  });

  window.addEventListener('facebookreport:sw-ready', event => {
    updateRegistration = event.detail?.registration || null;
    const sw = document.getElementById('p7Sw');
    if (sw) { sw.textContent = 'พร้อมใช้งาน'; sw.className = 'p7-badge ok'; }
    render();
  });
  window.addEventListener('facebookreport:update-ready', event => {
    updateRegistration = event.detail?.registration || updateRegistration;
    metrics.updateReady = true;
    setBanner('มี Dashboard เวอร์ชันใหม่พร้อมใช้งาน', 'อัปเดต', applyUpdate);
    log('update', 'พบเวอร์ชันใหม่');
    render();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (metrics.updateReady) location.reload();
    });
  }

  const init = () => {
    buildUI();
    observeErrors();
    observeNetwork();
    observePerformance();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();

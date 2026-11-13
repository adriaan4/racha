(() => {
  const PEOPLE = [
    { id: 'claudia', name: 'CLAUDIA' },
    { id: 'carla', name: 'CARLA' },
  ];
  const $ = (s) => document.querySelector(s);
  let state = null;

  // ── API ──────────────────────────────────────────────────────────────
  async function api(path, body) {
    const r = await fetch('/api/' + path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  // ── Brasas flotantes ─────────────────────────────────────────────────
  (function embers() {
    const box = $('#embers');
    const icons = ['🔥', '🔥', '✨', '💖', '🔥'];
    for (let i = 0; i < 14; i++) {
      const s = document.createElement('span');
      s.textContent = icons[i % icons.length];
      s.style.left = Math.random() * 100 + '%';
      s.style.fontSize = 14 + Math.random() * 22 + 'px';
      s.style.animationDuration = 9 + Math.random() * 12 + 's';
      s.style.animationDelay = -Math.random() * 20 + 's';
      box.appendChild(s);
    }
  })();

  // ── Render ───────────────────────────────────────────────────────────
  function render() {
    if (!state) return;
    $('#streak').textContent = state.streak;
    $('#streakLabel').textContent = state.streak === 1 ? 'día de racha' : 'días de racha';
    $('#best').textContent = state.best > 0 ? `🏆 Récord: ${state.best} ${state.best === 1 ? 'día' : 'días'}` : '';

    $('#summary').innerHTML = PEOPLE.map((p) =>
      `<span class="chip ${state[p.id] ? 'done' : 'pending'}">${state[p.id] ? '✅' : '⏳'} ${p.name} ${state[p.id] ? 'ACTIVADA' : 'PENDIENTE'}</span>`
    ).join('');

    $('#cards').innerHTML = PEOPLE.map((p) => {
      const done = state[p.id];
      return `
        <article class="card ${done ? 'done' : ''}" data-person="${p.id}">
          <div class="card-head">
            <h2>${p.name} 🔥</h2>
            <span class="badge">${done ? '✅ HECHO' : '⏳ PENDIENTE'}</span>
          </div>
          <p class="q">¿Has activado la racha de TikTok?</p>
          <div class="btns">
            <button class="btn yes ${done ? 'active' : ''}" data-person="${p.id}" data-done="true">✅ SÍ, HE ACTIVADO LA RACHA</button>
            <button class="btn no ${!done ? 'active' : ''}" data-person="${p.id}" data-done="false">❌ NO, TODAVÍA NO</button>
          </div>
        </article>`;
    }).join('');

    $('#timesInfo').textContent = state.reminderTimes
      ? `Avisos diarios: ${state.reminderTimes.join(' · ')} (hasta que marques SÍ)`
      : '';

    // Pantalla de misión cumplida (una vez por día y por móvil, y se puede cerrar)
    const both = state.claudia && state.carla;
    if (both && localStorage.getItem('racha-win') !== state.date) {
      $('#winStreak').textContent = `🔥 Racha: ${state.streak} ${state.streak === 1 ? 'día' : 'días'} seguidos`;
      $('#win').hidden = false;
    }
    if (!both) $('#win').hidden = true;
  }

  $('#winClose').addEventListener('click', () => {
    try { localStorage.setItem('racha-win', state.date); } catch {}
    $('#win').hidden = true;
  });

  $('#cards').addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn');
    if (!btn) return;
    const person = btn.dataset.person;
    const done = btn.dataset.done === 'true';
    if (state[person] === done) return;
    state[person] = done;
    if (navigator.vibrate) navigator.vibrate(done ? [30, 40, 30] : 20);
    render();
    try {
      state = { ...state, ...(await api('status', { person, done })) };
    } catch {
      await refresh();
    }
    render();
  });

  async function refresh() {
    try {
      const s = await api('state');
      state = { ...state, ...s };
      render();
    } catch { /* sin conexión: se mantiene lo último visto */ }
  }

  // ── Notificaciones push ──────────────────────────────────────────────
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  function urlB64(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  const getSub = async () => {
    if (!pushSupported) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  };

  async function updateBell() {
    const btn = $('#bellBtn');
    const hint = $('#installHint');
    hint.hidden = true;
    if (isIOS && !isStandalone) {
      hint.hidden = false;
      hint.innerHTML = '📲 <b>iPhone:</b> pulsa <b>Compartir</b> → <b>Añadir a pantalla de inicio</b> y abre la app desde ahí. Es obligatorio para recibir avisos.';
    } else if (!pushSupported) {
      hint.hidden = false;
      hint.textContent = 'Este navegador no admite notificaciones push. Prueba con Chrome (Android) o Safari instalada (iPhone).';
    }
    const sub = pushSupported ? await getSub() : null;
    const who = (() => { try { return JSON.parse(localStorage.getItem('racha-who') || '[]'); } catch { return []; } })();
    if (sub && who.length) {
      btn.classList.add('on');
      btn.textContent = `🔔 Avisos activados (${who.map((w) => w.toUpperCase()).join(' + ')})`;
    } else {
      btn.classList.remove('on');
      btn.textContent = '🔔 Activar avisos en este móvil';
    }
    return !!sub;
  }

  async function openSheet() {
    const sub = await getSub().catch(() => null);
    $('#sheetChoose').hidden = false;
    $('#sheetManage').hidden = !sub;
    $('#sheetText').textContent = sub ? 'Avisos activados. Puedes cambiar quién usa este móvil:' : '¿Quién usa este móvil?';
    $('#sheetMsg').textContent = '';
    $('#sheet').hidden = false;
  }

  async function enablePush(persons) {
    const msg = $('#sheetMsg');
    try {
      if (isIOS && !isStandalone) throw new Error('Primero añade la app a la pantalla de inicio (Compartir → Añadir a pantalla de inicio).');
      if (!pushSupported) throw new Error('Este navegador no soporta notificaciones push.');
      if (!state || !state.vapidPublicKey) throw new Error('No se pudo contactar con el servidor. Inténtalo otra vez.');
      msg.textContent = 'Pidiendo permiso…';
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Has bloqueado las notificaciones. Actívalas en los ajustes del móvil para esta app.');
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(state.vapidPublicKey) });
      await api('subscribe', { persons, subscription: sub.toJSON() });
      localStorage.setItem('racha-who', JSON.stringify(persons));
      msg.textContent = '✅ ¡Listo! Te voy a perseguir cada día 😈';
      $('#sheetManage').hidden = false;
      await updateBell();
    } catch (err) {
      msg.textContent = '⚠️ ' + (err.message || 'Algo ha fallado');
    }
  }

  $('#bellBtn').addEventListener('click', openSheet);
  $('#sheetClose').addEventListener('click', () => ($('#sheet').hidden = true));
  $('#sheetChoose').addEventListener('click', (e) => {
    const b = e.target.closest('[data-who]');
    if (!b) return;
    enablePush(b.dataset.who === 'both' ? ['claudia', 'carla'] : [b.dataset.who]);
  });
  $('#testBtn').addEventListener('click', async () => {
    const sub = await getSub();
    if (!sub) return;
    $('#sheetMsg').textContent = 'Enviando…';
    try {
      const r = await api('test', { endpoint: sub.endpoint });
      $('#sheetMsg').textContent = r.ok ? '📨 Aviso enviado, debería llegar en unos segundos.' : '⚠️ No se pudo enviar. Prueba a desactivar y activar de nuevo.';
    } catch {
      $('#sheetMsg').textContent = '⚠️ Error de conexión.';
    }
  });
  $('#offBtn').addEventListener('click', async () => {
    const sub = await getSub();
    if (sub) {
      try { await api('unsubscribe', { endpoint: sub.endpoint }); } catch {}
      await sub.unsubscribe();
    }
    localStorage.removeItem('racha-who');
    $('#sheetManage').hidden = true;
    $('#sheetMsg').textContent = '🔕 Avisos desactivados en este móvil.';
    await updateBell();
  });

  // ── Instalar la app ──────────────────────────────────────────────────
  let deferredPrompt = null;
  const installBtn = $('#installBtn');
  const showInstall = () => { installBtn.hidden = isStandalone; };

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstall();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installBtn.hidden = true;
  });

  installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice.catch(() => {});
      deferredPrompt = null;
      installBtn.hidden = true;
      return;
    }
    $('#installText').innerHTML = isIOS
      ? 'En el iPhone se instala desde Safari:<br><br>1️⃣ Pulsa el botón <b>Compartir</b> (el cuadrado con la flecha ⬆️)<br>2️⃣ Elige <b>Añadir a pantalla de inicio</b><br>3️⃣ Abre la app desde el nuevo icono 🔥'
      : 'Abre el menú del navegador <b>⋮</b> y pulsa <b>Instalar aplicación</b> (o <b>Añadir a pantalla de inicio</b>).';
    $('#installSheet').hidden = false;
  });
  $('#installClose').addEventListener('click', () => ($('#installSheet').hidden = true));

  // En iPhone no existe el aviso automático: se muestra el botón con instrucciones.
  // En el resto aparece cuando el navegador permite instalar (o tras 2 s con instrucciones).
  if (!isStandalone) {
    if (isIOS) showInstall();
    else setTimeout(() => { if (!deferredPrompt && !isStandalone) showInstall(); }, 2000);
  }

  // ── Arranque ─────────────────────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('SW', e));
  }
  refresh().then(updateBell);
  setInterval(refresh, 8000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('focus', refresh);
})();

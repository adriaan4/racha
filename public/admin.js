(() => {
  const $ = (s) => document.querySelector(s);
  const NAMES = { claudia: 'CLAUDIA', carla: 'CARLA' };
  const KEY = 'racha-admin-key';
  const TEMPLATES = [
    { n: '🚨 Ya', t: '🚨 {nombre}, ACTIVA LA RACHA YA', b: 'Abre TikTok, manda el mensaje y márcalo aquí ✅' },
    { n: '🔥 No la dejes morir', t: '🔥 {nombre}, NO DEJES MORIR LA RACHA', b: 'Son 5 segundos. Tú puedes. 💪' },
    { n: '😤 Te toca', t: '😤 {nombre}, TE TOCA A TI', b: 'No me hagas insistir.' },
    { n: '👀 ¿Qué hacéis?', t: '¿PERO QUÉ HACÉIS? ¡LA RACHA NO SE ACTIVA SOLA!', b: '{nombre}, venga ya 👀' },
    { n: '😭 Último aviso', t: 'ÚLTIMO AVISO, QUE TIKTOK NO PERDONA', b: '{nombre}, es ahora o nunca: ¡activa la racha! 🔥😭' },
  ];
  let data = null;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const key = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };

  async function api(path, body) {
    const opts = { headers: { 'x-admin-key': key() }, cache: 'no-store' };
    if (body) {
      opts.method = 'POST';
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const r = await fetch('/api/admin/' + path, opts);
    let j = {};
    try { j = await r.json(); } catch {}
    if (r.status === 401) { showLogin(); throw Object.assign(new Error('unauthorized'), { auth: true }); }
    if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
    return j;
  }

  // ── Acceso ─────────────────────────────────────────────────────────────
  function showLogin(msg) {
    $('#panel').hidden = true;
    $('#login').hidden = false;
    $('#loginMsg').textContent = msg || '';
  }
  $('#loginBtn').addEventListener('click', async () => {
    try { localStorage.setItem(KEY, $('#pass').value); } catch {}
    $('#loginMsg').textContent = 'Comprobando…';
    try {
      await load();
    } catch (e) {
      if (e.auth) showLogin('⚠️ Contraseña incorrecta');
    }
  });
  $('#pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#loginBtn').click(); });

  // ── Datos ──────────────────────────────────────────────────────────────
  async function load() {
    data = await api('overview');
    $('#login').hidden = true;
    $('#panel').hidden = false;
    $('#openWarn').hidden = data.protected;
    $('#tzName').textContent = data.tz;
    if (!$('#date').value) $('#date').value = data.now.date;
    if (!$('#time').value) $('#time').value = nextMinute(data.now.time);
    render();
  }

  function nextMinute(t) {
    let [h, m] = t.split(':').map(Number);
    m += 5;
    if (m >= 60) { m -= 60; h = (h + 1) % 24; }
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  const names = (to) => to.map((p) => NAMES[p]).join(' + ');
  const dateEs = (d) => { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; };

  function render() {
    const st = data.state;
    $('#status').innerHTML = ['claudia', 'carla'].map((p) =>
      `<span class="chip ${st[p] ? 'done' : 'pending'}">${st[p] ? '✅' : '⏳'} ${NAMES[p]} · ${data.devices[p]} 📱</span>`
    ).join('');

    $('#schedList').innerHTML = data.scheduled.length
      ? data.scheduled.map((i) => `
        <div class="item">
          <div class="main"><b>${esc(i.title)}</b>
            <span class="meta">${i.repeat === 'daily' ? '🔁 Cada día a las ' + i.time + ' (desde ' + dateEs(i.date) + ')' : dateEs(i.date) + ' · ' + i.time} · ${names(i.to)}${i.onlyPending ? ' · solo pendientes' : ''}</span></div>
          <button class="x" data-id="${i.id}" aria-label="Borrar">🗑️</button>
        </div>`).join('')
      : '<p class="empty">No hay avisos programados.</p>';

    $('#logList').innerHTML = data.log.length
      ? data.log.map((l) => {
        const d = new Date(l.at);
        const when = d.toLocaleString('es-ES', { timeZone: data.tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        return `<div class="item"><div class="main"><b>${esc(l.title)}</b>
          <span class="meta">${when} · ${l.kind} · ${names(l.to)} · ${l.sent}/${l.targets} 📱</span></div></div>`;
      }).join('')
      : '<p class="empty">Todavía no has enviado nada desde aquí.</p>';
  }

  // ── Formulario ─────────────────────────────────────────────────────────
  $('#tpls').innerHTML = TEMPLATES.map((t, i) => `<button class="tpl" data-i="${i}">${t.n}</button>`).join('');
  $('#tpls').addEventListener('click', (e) => {
    const b = e.target.closest('.tpl');
    if (!b) return;
    const t = TEMPLATES[b.dataset.i];
    $('#title').value = t.t;
    $('#body').value = t.b;
    preview();
  });
  $('#who').addEventListener('click', (e) => {
    const b = e.target.closest('.tg');
    if (b) { b.classList.toggle('on'); preview(); }
  });

  const recipients = () => [...document.querySelectorAll('#who .tg.on')].map((b) => b.dataset.p);
  const fill = (t) => t.replace(/\{nombre\}/gi, recipients().map((p) => NAMES[p]).join(' Y ') || 'NOMBRE');
  function preview() {
    $('#pvTitle').textContent = fill($('#title').value) || 'Título del aviso';
    $('#pvBody').textContent = fill($('#body').value);
  }
  $('#title').addEventListener('input', preview);
  $('#body').addEventListener('input', preview);

  function form() {
    return {
      to: recipients(),
      title: $('#title').value.trim(),
      body: $('#body').value.trim(),
      onlyPending: $('#onlyPending').checked,
    };
  }
  function validate(f, el) {
    if (!f.to.length) { el.textContent = '⚠️ Elige al menos a una persona.'; return false; }
    if (!f.title) { el.textContent = '⚠️ Escribe un título.'; return false; }
    return true;
  }
  const fail = (el, e) => { if (!e.auth) el.textContent = '⚠️ ' + (e.message || 'Error'); };

  $('#sendBtn').addEventListener('click', async () => {
    const f = form();
    const msg = $('#sendMsg');
    if (!validate(f, msg)) return;
    const btn = $('#sendBtn');
    btn.disabled = true;
    msg.textContent = 'Enviando…';
    try {
      const r = await api('send', f);
      msg.textContent = r.targets === 0
        ? '⚠️ No hay móviles que reciban esto (¿ya marcaron SÍ o nadie tiene los avisos activados?).'
        : r.ok ? `🚀 Enviado a ${r.sent}/${r.targets} móvil(es).` : '⚠️ No se pudo entregar a ningún móvil.';
      await load();
    } catch (e) { fail(msg, e); }
    btn.disabled = false;
  });

  $('#schedBtn').addEventListener('click', async () => {
    const f = { ...form(), date: $('#date').value, time: $('#time').value, repeat: $('#repeat').value };
    const msg = $('#schedMsg');
    if (!validate(f, msg)) return;
    if (!f.date || !f.time) { msg.textContent = '⚠️ Elige día y hora.'; return; }
    const btn = $('#schedBtn');
    btn.disabled = true;
    msg.textContent = 'Programando…';
    try {
      await api('schedule', f);
      msg.textContent = `✅ Programado para el ${dateEs(f.date)} a las ${f.time}.`;
      await load();
    } catch (e) { fail(msg, e); }
    btn.disabled = false;
  });

  $('#schedList').addEventListener('click', async (e) => {
    const b = e.target.closest('.x');
    if (!b) return;
    try { await api('schedule/delete', { id: b.dataset.id }); await load(); } catch {}
  });

  // Probar: se manda solo a ESTE móvil (necesita tener los avisos activados desde la app).
  $('#testBtn').addEventListener('click', async () => {
    const msg = $('#sendMsg');
    const btn = $('#testBtn');
    btn.disabled = true;
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Este navegador no admite notificaciones push.');
      const reg = await navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready);
      const sub = await reg.pushManager.getSubscription();
      if (!sub) throw new Error('Este móvil no tiene los avisos activados. Ve a la app y pulsa “🔔 Activar avisos”.');
      msg.textContent = 'Enviando prueba…';
      const f = form();
      const r = await api('test', { endpoint: sub.endpoint, title: f.title, body: f.body });
      msg.textContent = r.ok
        ? '📨 Prueba enviada, te llega en unos segundos (solo a este móvil).'
        : r.reason === 'not-subscribed'
          ? '⚠️ El servidor no tiene este móvil registrado. Desactiva y activa los avisos en la app.'
          : '⚠️ No se pudo entregar. Prueba a desactivar y activar los avisos otra vez.';
    } catch (e) { fail(msg, e); }
    btn.disabled = false;
  });

  // ── Arranque ───────────────────────────────────────────────────────────
  preview();
  (async () => {
    try {
      const { protected: prot } = await fetch('/api/admin/status').then((r) => r.json());
      if (prot && !key()) return showLogin();
      await load();
      setInterval(() => { if (!document.hidden && !$('#panel').hidden) load().catch(() => {}); }, 30000);
    } catch (e) { if (!e.auth) showLogin('⚠️ No se pudo conectar con el servidor.'); }
  })();
})();

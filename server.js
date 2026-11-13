require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const webpush = require('web-push');
const store = require('./lib/store');
const { todayKey, minutesNow, dayDiff, TZ } = require('./lib/time');

const PORT = process.env.PORT || 3000;
const PEOPLE = ['claudia', 'carla'];
const NAMES = { claudia: 'CLAUDIA', carla: 'CARLA' };

// ── Horas de los recordatorios (hora local) ─────────────────────────────
const SLOT_TIMES = (process.env.REMINDER_TIMES || '10:00,12:30,15:00,17:30,19:30,21:00,22:15,23:15')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const SLOTS = SLOT_TIMES.map((t) => {
  const [h, m] = t.split(':').map(Number);
  return { t, min: h * 60 + (m || 0) };
}).sort((a, b) => a.min - b.min);
const GRACE_MIN = 45; // si el servidor estuvo caído, no manda avisos "viejos"

// ── Estado ──────────────────────────────────────────────────────────────
const defaults = () => ({
  date: todayKey(),
  claudia: false,
  carla: false,
  base: 0, // racha acumulada hasta el día anterior
  best: 0,
  sent: [], // slots ya enviados hoy
  subs: [], // [{ person, sub }]
  scheduled: [], // avisos programados desde /admin
  log: [], // últimos avisos enviados desde /admin
  vapid: null,
});

// Cambio de día (00:00): se reinician los estados y se actualiza la racha.
function rollover(state) {
  const today = todayKey();
  if (state.date === today) return;
  const completedOld = state.claudia && state.carla;
  const diff = dayDiff(state.date, today);
  state.base = completedOld && diff === 1 ? state.base + 1 : 0;
  state.best = Math.max(state.best, state.base);
  state.claudia = false;
  state.carla = false;
  state.sent = [];
  state.date = today;
}

const streakOf = (s) => s.base + (s.claudia && s.carla ? 1 : 0);

function publicState(s) {
  const streak = streakOf(s);
  return {
    date: s.date,
    claudia: s.claudia,
    carla: s.carla,
    streak,
    best: Math.max(s.best, streak),
    vapidPublicKey: s.vapid ? s.vapid.publicKey : null,
    reminderTimes: SLOT_TIMES,
  };
}

const mutate = (fn) => store.update(defaults, (s) => {
  rollover(s);
  return fn(s);
});

// ── Mensajes divertidos ─────────────────────────────────────────────────
function buildMessage(person, slotIdx, total, state) {
  const name = NAMES[person];
  const other = PEOPLE.find((p) => p !== person);
  const bothPending = !state[person] && !state[other];

  if (slotIdx === total - 1) {
    return { title: 'ÚLTIMO AVISO, QUE TIKTOK NO PERDONA', body: `${name}, es ahora o nunca: ¡activa la racha! 🔥😭` };
  }
  const pool = [
    { title: `🚨 ${name}, ACTIVA LA RACHA YA`, body: 'Abre TikTok, manda el mensaje y márcalo aquí ✅' },
    { title: `🔥 ${name}, NO DEJES MORIR LA RACHA`, body: 'Son 5 segundos. Tú puedes. 💪' },
  ];
  if (bothPending) {
    pool.push({ title: '¿PERO QUÉ HACÉIS? ¡LA RACHA NO SE ACTIVA SOLA!', body: `${name}, ${NAMES[other]} tampoco la ha activado 👀` });
  } else {
    pool.push({ title: `😤 ${name}, TE TOCA A TI`, body: `${NAMES[other]} ya cumplió. No me hagas insistir.` });
  }
  return pool[slotIdx % pool.length];
}

// ── Notificaciones push ─────────────────────────────────────────────────
async function sendPush(entry, payload) {
  try {
    await webpush.sendNotification(entry.sub, JSON.stringify(payload), { TTL: 3600, urgency: 'high' });
    return true;
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) return 'dead';
    console.warn('Push fallido:', err.statusCode || err.message);
    return false;
  }
}

async function deliver(jobs) {
  if (!jobs.length) return 0;
  const results = await Promise.all(jobs.map((j) => sendPush(j.entry, j.payload)));
  const dead = jobs.filter((_, i) => results[i] === 'dead').map((j) => j.entry.sub.endpoint);
  if (dead.length) await mutate((s) => { s.subs = s.subs.filter((e) => !dead.includes(e.sub.endpoint)); });
  return results.filter((r) => r === true).length;
}

// ── Avisos personalizados (admin) ───────────────────────────────────────
const LATE_MIN = 180; // un aviso programado que se pasó más de 3 h (servidor caído) ya no se manda

// Agrupa por dispositivo: si un móvil está registrado como "LAS DOS" recibe un solo aviso.
// {nombre} se sustituye por quien corresponda (CLAUDIA, CARLA o CLAUDIA Y CARLA).
function customJobs(s, to, title, body, tag, onlyPending, onlyEndpoint) {
  const targets = to.filter((p) => PEOPLE.includes(p) && !(onlyPending && s[p]));
  const byEndpoint = new Map();
  for (const entry of s.subs) {
    if (!targets.includes(entry.person)) continue;
    if (onlyEndpoint && entry.sub.endpoint !== onlyEndpoint) continue;
    const g = byEndpoint.get(entry.sub.endpoint) || { entry, persons: [] };
    if (!g.persons.includes(entry.person)) g.persons.push(entry.person);
    byEndpoint.set(entry.sub.endpoint, g);
  }
  return [...byEndpoint.values()].map(({ entry, persons }) => {
    const nombre = persons.map((p) => NAMES[p]).join(' Y ');
    const fill = (t) => String(t || '').replace(/\{nombre\}/gi, nombre);
    return { entry, payload: { title: fill(title), body: fill(body), tag, url: '/' } };
  });
}

function pushLog(s, info, sent, targets) {
  s.log.unshift({ at: new Date().toISOString(), ...info, sent, targets });
  s.log.length = Math.min(s.log.length, 15);
}

async function dispatch(jobs, info) {
  const sent = await deliver(jobs);
  if (jobs.length) await mutate((s) => pushLog(s, info, sent, jobs.length));
  return sent;
}

// Se ejecuta cada minuto: manda el aviso de la franja que toque a quien siga pendiente
// y los avisos programados desde /admin que ya les toque.
async function tick() {
  const groups = await mutate((s) => {
    const out = [];
    const now = minutesNow();
    const today = todayKey();

    // 1) Recordatorios automáticos
    const due = SLOTS.filter((sl) => sl.min <= now && !s.sent.includes(sl.t));
    if (due.length) {
      due.forEach((sl) => s.sent.push(sl.t));
      const latest = due[due.length - 1];
      if (now - latest.min <= GRACE_MIN) { // si la franja pasó hace mucho, no avisar
        const idx = SLOTS.findIndex((sl) => sl.t === latest.t);
        const jobs = [];
        for (const person of PEOPLE) {
          if (s[person]) continue; // ya marcó SÍ hoy → no más avisos
          const msg = buildMessage(person, idx, SLOTS.length, s);
          for (const entry of s.subs.filter((e) => e.person === person)) {
            jobs.push({ entry, payload: { ...msg, tag: `racha-${person}`, person, url: '/' } });
          }
        }
        if (jobs.length) out.push({ jobs });
      }
    }

    // 2) Avisos programados desde /admin
    const keep = [];
    for (const it of s.scheduled) {
      const mins = it.time.split(':').map(Number);
      const itMin = mins[0] * 60 + mins[1];
      const started = it.date < today || (it.date === today && itMin <= now);
      const once = it.repeat !== 'daily';
      if (!started || (!once && it.last === today)) { keep.push(it); continue; }
      const overdue = dayDiff(it.date, today) * 1440 + now - itMin;
      if (!once) { it.last = today; keep.push(it); }
      if (once ? overdue > LATE_MIN : now - itMin > LATE_MIN) continue; // demasiado tarde
      const jobs = customJobs(s, it.to, it.title, it.body, `admin-${it.id}`, it.onlyPending);
      out.push({ jobs, info: { kind: 'programado', to: it.to, title: it.title } });
    }
    s.scheduled = keep;
    return out;
  });

  let sent = 0;
  let total = 0;
  for (const g of groups) {
    total += g.jobs.length;
    sent += g.info ? await dispatch(g.jobs, g.info) : await deliver(g.jobs);
  }
  if (total) console.log(`🔔 Avisos enviados: ${sent}/${total}`);
  return sent;
}

// ── App ─────────────────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '50kb' }));

app.get('/health', (_req, res) => res.send('ok'));

app.get('/api/state', async (_req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await mutate((s) => publicState(s)));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
});

app.post('/api/status', async (req, res) => {
  const { person, done } = req.body || {};
  if (!PEOPLE.includes(person) || typeof done !== 'boolean') return res.status(400).json({ error: 'bad request' });
  try {
    res.json(await mutate((s) => { s[person] = done; s.best = Math.max(s.best, streakOf(s)); return publicState(s); }));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
});

app.post('/api/subscribe', async (req, res) => {
  const { persons, subscription } = req.body || {};
  if (!Array.isArray(persons) || !persons.length || !persons.every((p) => PEOPLE.includes(p)) ||
      !subscription || !subscription.endpoint || !subscription.keys) {
    return res.status(400).json({ error: 'bad request' });
  }
  try {
    await mutate((s) => {
      s.subs = s.subs.filter((e) => e.sub.endpoint !== subscription.endpoint);
      for (const person of persons) s.subs.push({ person, sub: subscription });
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
});

app.post('/api/unsubscribe', async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'bad request' });
  await mutate((s) => { s.subs = s.subs.filter((e) => e.sub.endpoint !== endpoint); });
  res.json({ ok: true });
});

app.post('/api/test', async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'bad request' });
  const jobs = await mutate((s) =>
    s.subs.filter((e) => e.sub.endpoint === endpoint).map((entry) => ({
      entry,
      payload: { title: `🔥 ${NAMES[entry.person]}, ¡FUNCIONAN LOS AVISOS!`, body: 'Así te voy a perseguir cada día 😈', tag: `test-${entry.person}`, url: '/' },
    }))
  );
  const sent = await deliver(jobs);
  res.json({ ok: sent > 0, sent });
});

// ── Admin (/admin) ──────────────────────────────────────────────────────
// Si defines ADMIN_PASSWORD, el panel pide contraseña. Sin ella queda abierto como el resto de la app.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const failures = new Map(); // ip → { n, until }

const safeEq = (a, b) => {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};

function adminAuth(req, res, next) {
  if (!ADMIN_PASSWORD) return next();
  const f = failures.get(req.ip);
  if (f && f.n >= 10 && f.until > Date.now()) return res.status(429).json({ error: 'demasiados intentos' });
  if (safeEq(req.get('x-admin-key') || '', ADMIN_PASSWORD)) {
    failures.delete(req.ip);
    return next();
  }
  failures.set(req.ip, { n: (f ? f.n : 0) + 1, until: Date.now() + 10 * 60 * 1000 });
  res.status(401).json({ error: 'unauthorized' });
}

const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const cleanTo = (to) => (Array.isArray(to) ? [...new Set(to.filter((p) => PEOPLE.includes(p)))] : []);

app.get('/admin', (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/admin/status', (_req, res) => res.json({ protected: !!ADMIN_PASSWORD }));

app.get('/api/admin/overview', adminAuth, async (_req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await mutate((s) => {
      const mins = minutesNow();
      const hh = String(Math.floor(mins / 60)).padStart(2, '0');
      const mm = String(mins % 60).padStart(2, '0');
      return {
        protected: !!ADMIN_PASSWORD,
        tz: TZ,
        now: { date: todayKey(), time: `${hh}:${mm}` },
        state: publicState(s),
        devices: Object.fromEntries(PEOPLE.map((p) => [p, s.subs.filter((e) => e.person === p).length])),
        scheduled: [...s.scheduled].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)),
        log: s.log,
      };
    }));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
});

// Enviar ahora (personalizado)
app.post('/api/admin/send', adminAuth, async (req, res) => {
  const to = cleanTo(req.body && req.body.to);
  const title = clean(req.body && req.body.title, 100);
  const body = clean(req.body && req.body.body, 300);
  const onlyPending = !!(req.body && req.body.onlyPending);
  if (!to.length || !title) return res.status(400).json({ error: 'Falta el destinatario o el título' });
  try {
    const jobs = await mutate((s) => customJobs(s, to, title, body, `admin-${Date.now()}`, onlyPending));
    const sent = await dispatch(jobs, { kind: 'ahora', to, title });
    res.json({ ok: sent > 0, sent, targets: jobs.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
});

// Programar un aviso (una vez o todos los días a esa hora)
app.post('/api/admin/schedule', adminAuth, async (req, res) => {
  const b = req.body || {};
  const to = cleanTo(b.to);
  const title = clean(b.title, 100);
  const body = clean(b.body, 300);
  const date = clean(b.date, 10);
  const time = clean(b.time, 5);
  const repeat = b.repeat === 'daily' ? 'daily' : 'once';
  if (!to.length || !title) return res.status(400).json({ error: 'Falta el destinatario o el título' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return res.status(400).json({ error: 'Fecha u hora no válidas' });
  }
  try {
    const out = await mutate((s) => {
      const [h, m] = time.split(':').map(Number);
      const overdue = dayDiff(date, todayKey()) * 1440 + minutesNow() - (h * 60 + m);
      if (repeat === 'once' && overdue > 1) return { error: 'Esa hora ya ha pasado' };
      if (s.scheduled.length >= 50) return { error: 'Demasiados avisos programados' };
      const item = {
        id: crypto.randomBytes(4).toString('hex'),
        to, title, body, date, time, repeat,
        onlyPending: !!b.onlyPending,
        last: null,
      };
      s.scheduled.push(item);
      return { ok: true, item };
    });
    if (out.error) return res.status(400).json(out);
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
});

app.post('/api/admin/schedule/delete', adminAuth, async (req, res) => {
  const id = clean(req.body && req.body.id, 40);
  await mutate((s) => { s.scheduled = s.scheduled.filter((i) => i.id !== id); });
  res.json({ ok: true });
});

// Botón de probar: manda lo que hay escrito en el formulario SOLO a este móvil.
app.post('/api/admin/test', adminAuth, async (req, res) => {
  const endpoint = clean(req.body && req.body.endpoint, 2000);
  const title = clean(req.body && req.body.title, 100) || '🔥 Aviso de prueba';
  const body = clean(req.body && req.body.body, 300) || 'Si lees esto, las notificaciones funcionan ✅';
  if (!endpoint) return res.status(400).json({ error: 'bad request' });
  try {
    const jobs = await mutate((s) => {
      const persons = s.subs.filter((e) => e.sub.endpoint === endpoint).map((e) => e.person);
      return customJobs(s, persons, title, body, 'admin-test', false, endpoint);
    });
    if (!jobs.length) return res.json({ ok: false, reason: 'not-subscribed' });
    const sent = await deliver(jobs);
    res.json({ ok: sent > 0, sent });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
});

// Para hostings que "duermen" la app: un cron externo puede llamar aquí cada minuto.
app.all('/api/tick', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && (req.query.key || req.get('x-cron-key')) !== secret) return res.status(401).json({ error: 'unauthorized' });
  res.json({ ok: true, sent: await tick() });
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, file) {
    if (file.endsWith('sw.js') || file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// ── Arranque ────────────────────────────────────────────────────────────
(async () => {
  await store.init();

  const keys = await mutate((s) => {
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      s.vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    } else if (!s.vapid) {
      s.vapid = webpush.generateVAPIDKeys();
      console.log('🔑 Claves VAPID generadas y guardadas');
    }
    return s.vapid;
  });
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:racha@example.com', keys.publicKey, keys.privateKey);

  setInterval(() => tick().catch((e) => console.error('tick', e)), 60 * 1000);
  setTimeout(() => tick().catch((e) => console.error('tick', e)), 3000);

  app.listen(PORT, () => {
    console.log(`🔥 RACHA OBLIGATORIA en http://localhost:${PORT}  (zona horaria: ${TZ})`);
    console.log(`⏰ Avisos: ${SLOT_TIMES.join(', ')}`);
    console.log(ADMIN_PASSWORD ? '🛠️  Admin en /admin (con contraseña)' : '⚠️  Admin en /admin SIN contraseña: define ADMIN_PASSWORD');
  });
})().catch((e) => {
  console.error('Error al arrancar:', e);
  process.exit(1);
});

require('dotenv').config();
const path = require('path');
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

// Se ejecuta cada minuto: manda el aviso de la franja que toque a quien siga pendiente.
async function tick() {
  const jobs = await mutate((s) => {
    const now = minutesNow();
    const due = SLOTS.filter((sl) => sl.min <= now && !s.sent.includes(sl.t));
    if (!due.length) return [];
    due.forEach((sl) => s.sent.push(sl.t));
    const latest = due[due.length - 1];
    if (now - latest.min > GRACE_MIN) return []; // franja pasada hace mucho: no avisar
    const idx = SLOTS.findIndex((sl) => sl.t === latest.t);
    const out = [];
    for (const person of PEOPLE) {
      if (s[person]) continue; // ya marcó SÍ hoy → no más avisos
      const msg = buildMessage(person, idx, SLOTS.length, s);
      for (const entry of s.subs.filter((e) => e.person === person)) {
        out.push({ entry, payload: { ...msg, tag: `racha-${person}`, person, url: '/' } });
      }
    }
    return out;
  });
  const n = await deliver(jobs);
  if (jobs.length) console.log(`🔔 Avisos enviados: ${n}/${jobs.length}`);
  return n;
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
  });
})().catch((e) => {
  console.error('Error al arrancar:', e);
  process.exit(1);
});

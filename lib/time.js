// Utilidades de fecha/hora en la zona horaria de la app (por defecto Europe/Madrid)
const TZ = process.env.APP_TZ || 'Europe/Madrid';

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function parts(date = new Date()) {
  const o = {};
  for (const p of fmt.formatToParts(date)) o[p.type] = p.value;
  return o;
}

// "2026-11-13"
function todayKey(date = new Date()) {
  const o = parts(date);
  return `${o.year}-${o.month}-${o.day}`;
}

// Minutos transcurridos desde las 00:00 (hora local de la app)
function minutesNow(date = new Date()) {
  const o = parts(date);
  return Number(o.hour) * 60 + Number(o.minute);
}

// Diferencia en días entre dos claves "YYYY-MM-DD"
function dayDiff(a, b) {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
}

module.exports = { TZ, todayKey, minutesNow, dayDiff };

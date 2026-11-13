// Almacenamiento compartido de todo el estado de la app.
// - Con DATABASE_URL (Postgres): los datos sobreviven a cualquier redeploy. RECOMENDADO en producción.
// - Sin DATABASE_URL: se guarda en un fichero JSON (útil en local o con un volumen persistente).
const fs = require('fs');
const path = require('path');

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'db.json');
const KEY = 'app';
let pool = null;

async function init() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = require('pg');
    const local = /localhost|127\.0\.0\.1/.test(url);
    const useSsl = process.env.PGSSL === 'disable' ? false : !local;
    pool = new Pool({
      connectionString: url,
      ssl: useSsl ? { rejectUnauthorized: false } : false,
    });
    await pool.query('CREATE TABLE IF NOT EXISTS kv (k text PRIMARY KEY, v jsonb NOT NULL)');
    console.log('💾 Almacenamiento: Postgres');
  } else {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    console.log('💾 Almacenamiento: fichero JSON (' + DATA_FILE + ')');
  }
}

async function load() {
  if (pool) {
    const r = await pool.query('SELECT v FROM kv WHERE k = $1', [KEY]);
    return r.rows[0] ? r.rows[0].v : null;
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function save(state) {
  if (pool) {
    await pool.query(
      'INSERT INTO kv (k, v) VALUES ($1, $2::jsonb) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v',
      [KEY, JSON.stringify(state)]
    );
    return;
  }
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, DATA_FILE);
}

// Cola para que las escrituras nunca se pisen entre sí.
let queue = Promise.resolve();

// update(defaults, fn): carga el estado (mezclado con defaults), ejecuta fn(state) y lo guarda.
function update(defaults, fn) {
  const run = queue.then(async () => {
    const state = Object.assign(defaults(), (await load()) || {});
    const result = await fn(state);
    await save(state);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

module.exports = { init, update };

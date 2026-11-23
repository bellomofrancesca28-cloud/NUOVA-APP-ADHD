// db.js
// Connessione al database PostgreSQL (prima era un file SQLite locale).
//
// Parametri di connessione, tutti da variabili d'ambiente (mai nel codice):
//   PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD  -> letti direttamente dal driver "pg"
//   DB_SSL       = require (default) | verify | disable
//                  require: connessione cifrata TLS senza verifica del certificato
//                           (equivale a sslmode=require di psql: serve finché il
//                           server usa un certificato autofirmato)
//                  verify:  TLS con verifica del certificato (serve DB_SSL_CA)
//                  disable: niente TLS (solo per un Postgres locale di sviluppo)
//   DB_SSL_CA    = percorso del certificato CA (solo con DB_SSL=verify)
//   DB_POOL_MAX  = connessioni massime nel pool (default 10; il ruolo ha limite 20)
//
// NB: non usiamo una DATABASE_URL con "?sslmode=require" perché il driver
// Node la interpreta come verify-full, che fallirebbe con il certificato
// autofirmato del server: il TLS lo configuriamo qui in modo esplicito.
//
// Le query nel resto del codice usano i segnaposto "?" come prima: qui
// vengono convertiti in $1, $2, ... come vuole Postgres.
const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

// La Container App "spm-adhd-coach" passa i parametri come DB_HOST, DB_PORT,
// DB_NAME, DB_USER, DB_PASSWORD (secret): li accettiamo come alternativa ai
// nomi PG* standard (che, se presenti, hanno la precedenza).
for (const [pgName, altName] of [
  ['PGHOST', 'DB_HOST'], ['PGPORT', 'DB_PORT'], ['PGDATABASE', 'DB_NAME'],
  ['PGUSER', 'DB_USER'], ['PGPASSWORD', 'DB_PASSWORD'],
]) {
  if (!process.env[pgName] && process.env[altName]) process.env[pgName] = process.env[altName];
}

// ---- Conversione dei tipi, per restituire all'app gli stessi valori di prima ----
// COUNT(*) e SUM() in Postgres sono bigint: il driver li darebbe come stringa.
types.setTypeParser(20, v => parseInt(v, 10));    // int8
types.setTypeParser(1700, v => parseFloat(v));    // numeric
// Le date restano stringhe "YYYY-MM-DD" (il driver di default le convertirebbe
// in oggetti Date nel fuso del server, spostando il giorno).
types.setTypeParser(1082, v => v);                // date
// I timestamp tornano nel formato che SQLite usava e che il frontend si aspetta:
// "YYYY-MM-DD HH:MM:SS" in UTC (la sessione è impostata a UTC più sotto).
types.setTypeParser(1184, v => v.slice(0, 19));   // timestamptz
types.setTypeParser(1114, v => v.slice(0, 19));   // timestamp

function sslConfig() {
  const mode = (process.env.DB_SSL || 'require').toLowerCase();
  if (mode === 'disable') return false;
  if (mode === 'verify') {
    if (!process.env.DB_SSL_CA) throw new Error('DB_SSL=verify richiede DB_SSL_CA');
    return { rejectUnauthorized: true, ca: fs.readFileSync(process.env.DB_SSL_CA, 'utf8') };
  }
  if (mode !== 'require') throw new Error(`DB_SSL non valido: ${mode}`);
  return { rejectUnauthorized: false };
}

const pool = new Pool({
  ssl: sslConfig(),
  max: Number(process.env.DB_POOL_MAX) || 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  application_name: 'adhd-coach',
  options: '-c TimeZone=UTC',
});

// Un errore su una connessione inattiva del pool (es. il server la chiude)
// non deve far cadere tutto il processo: la connessione viene scartata.
pool.on('error', err => console.error('Errore connessione database (inattiva):', err.message));

function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function query(sql, params) {
  return pool.query(toPg(sql), params || []);
}

const db = {
  // Prima riga del risultato (o undefined): sostituisce stmt.get()
  async get(sql, ...params) { return (await query(sql, params)).rows[0]; },
  // Tutte le righe: sostituisce stmt.all()
  async all(sql, ...params) { return (await query(sql, params)).rows; },
  // Comando senza risultato atteso: sostituisce stmt.run()
  async run(sql, ...params) {
    const r = await query(sql, params);
    return { changes: r.rowCount, rows: r.rows };
  },
  pool,
};

// ---- Migrazioni ----
// Ogni file in server/migrations (001_..., 002_...) viene applicato una sola
// volta, in ordine, dentro una transazione; la tabella schema_migrations
// ricorda quali sono già stati applicati. Il lock evita che due istanze
// dell'app (es. due repliche del container) le applichino in contemporanea.
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const MIGRATION_LOCK_ID = 727274; // numero arbitrario ma fisso

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const done = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map(r => r.version));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => /^\d+_.+\.sql$/.test(f)).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`Migrazione applicata: ${file}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migrazione ${file} fallita: ${e.message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}

// Transazione: esegue fn(tx) su UNA connessione dedicata tra BEGIN e COMMIT.
// Se fn lancia un errore fa ROLLBACK (nessuna scrittura a metà) e lo rilancia.
// tx ha gli stessi metodi di db: get / all / run, con i segnaposto "?".
//   await db.tx(async tx => { await tx.run(...); await tx.get(...); });
async function tx(fn) {
  const client = await pool.connect();
  const q = async (sql, params) => client.query(toPg(sql), params || []);
  const t = {
    async get(sql, ...params) { return (await q(sql, params)).rows[0]; },
    async all(sql, ...params) { return (await q(sql, params)).rows; },
    async run(sql, ...params) { const r = await q(sql, params); return { changes: r.rowCount, rows: r.rows }; },
  };
  try {
    await client.query('BEGIN');
    const out = await fn(t);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

db.tx = tx;
db.migrate = migrate;
db.close = () => pool.end();

module.exports = db;

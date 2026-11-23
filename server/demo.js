// demo.js — avvia una COPIA di prova dell'app (porta 3001) con un account
// adolescente già pronto, su un database Postgres SEPARATO da indicare in
// DEMO_PGDATABASE (es. un Postgres locale di sviluppo). Non tocca i dati veri.
// Uso: DEMO_PGDATABASE=adhd_demo npm run demo   ->  http://localhost:3001
// Accesso: teen@demo.it / DemoPass123
try {
  const envPath = require('path').join(__dirname, '..', '.env');
  require('fs').readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) { /* nessun .env */ }
if (process.env.NODE_ENV === 'production') {
  console.error('Demo bloccata: NODE_ENV=production.');
  process.exit(1);
}
if (!process.env.DEMO_PGDATABASE || process.env.DEMO_PGDATABASE === 'db_spm') {
  console.error('Imposta DEMO_PGDATABASE con un database di prova separato (non db_spm).');
  process.exit(1);
}
process.env.PGDATABASE = process.env.DEMO_PGDATABASE;
process.env.PORT = process.env.PORT || '3001';
const bcrypt = require('bcryptjs');
const db = require('./db');

(async () => {
  await db.migrate();
  const hash = bcrypt.hashSync('DemoPass123', 10);
  const now = new Date().toISOString();
  if (!await db.get('SELECT id FROM users WHERE email = ?', 'tutor@demo.it')) {
    await db.run(`INSERT INTO users (email, password_hash, role, name, specialty, bio, approved, order_number)
      VALUES ('tutor@demo.it', ?, 'therapist', 'Dott.ssa Demo', 'Psicologa, adolescenti', 'Tutor di prova.', 1, 'Albo n. 0000')`, hash);
  }
  if (!await db.get('SELECT id FROM users WHERE email = ?', 'teen@demo.it')) {
    await db.run(`INSERT INTO users (email, password_hash, role, name, age_range, age_group, birth_date, notif_push, notif_email, notif_reminders, privacy_accepted_at, consent_accepted_at)
      VALUES ('teen@demo.it', ?, 'patient', 'Marco', 'teen', 'teen', '2011-05-12', 0, 0, 0, ?, ?)`, hash, now, now);
  }
  const t = await db.get("SELECT id FROM users WHERE email = 'tutor@demo.it'");
  const p = await db.get("SELECT id FROM users WHERE email = 'teen@demo.it'");
  if (!await db.get('SELECT 1 FROM patient_therapist WHERE patient_id = ?', p.id)) {
    await db.run("INSERT INTO patient_therapist (patient_id, therapist_id, status) VALUES (?, ?, 'active')", p.id, t.id);
  }
  console.log('\n>>> DEMO ADOLESCENTE su http://localhost:3001  (email: teen@demo.it  password: DemoPass123)\n');
  require('./index.js');
})().catch(e => {
  console.error('Demo fallita:', e.message);
  process.exit(1);
});

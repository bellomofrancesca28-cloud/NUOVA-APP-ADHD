// demo.js — avvia una COPIA di prova dell'app (porta 3001, database separato)
// con un account adolescente già pronto. Non tocca i tuoi dati veri.
// Uso: npm run demo   ->  http://localhost:3001
// Accesso: teen@demo.it / DemoPass123
const path = require('path');
process.env.DB_PATH = path.join(__dirname, 'data', 'demo.sqlite');
process.env.PORT = process.env.PORT || '3001';
const bcrypt = require('bcryptjs');
const db = require('./db');

const hash = bcrypt.hashSync('DemoPass123', 10);
const now = new Date().toISOString();
if (!db.prepare('SELECT id FROM users WHERE email = ?').get('tutor@demo.it')) {
  db.prepare(`INSERT INTO users (email, password_hash, role, name, specialty, bio, approved, order_number)
    VALUES ('tutor@demo.it', ?, 'therapist', 'Dott.ssa Demo', 'Psicologa, adolescenti', 'Tutor di prova.', 1, 'Albo n. 0000')`).run(hash);
}
if (!db.prepare('SELECT id FROM users WHERE email = ?').get('teen@demo.it')) {
  db.prepare(`INSERT INTO users (email, password_hash, role, name, age_range, age_group, birth_date, notif_push, notif_email, notif_reminders, privacy_accepted_at, consent_accepted_at)
    VALUES ('teen@demo.it', ?, 'patient', 'Marco', 'teen', 'teen', '2011-05-12', 0, 0, 0, ?, ?)`).run(hash, now, now);
}
const t = db.prepare("SELECT id FROM users WHERE email = 'tutor@demo.it'").get();
const p = db.prepare("SELECT id FROM users WHERE email = 'teen@demo.it'").get();
if (!db.prepare('SELECT 1 FROM patient_therapist WHERE patient_id = ?').get(p.id)) {
  db.prepare("INSERT INTO patient_therapist (patient_id, therapist_id, status) VALUES (?, ?, 'active')").run(p.id, t.id);
}
console.log('\n>>> DEMO ADOLESCENTE su http://localhost:3001  (email: teen@demo.it  password: DemoPass123)\n');
require('./index.js');

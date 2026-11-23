// seed.js
// Script FACOLTATIVO da lanciare a mano con "npm run seed", solo per test.
// Crea qualche terapeuta demo cosi' la schermata "scegli il tuo terapeuta" non
// è vuota durante lo sviluppo. NON va lanciato su un ambiente con pazienti
// reali: creerebbe account con password demo conosciute pubblicamente.
// Per sicurezza si rifiuta di partire se NODE_ENV=production.
try {
  const envPath = require('path').join(__dirname, '..', '.env');
  require('fs').readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) { /* nessun .env */ }
if (process.env.NODE_ENV === 'production') {
  console.error('Seed bloccato: NODE_ENV=production. Gli account demo hanno password pubbliche.');
  process.exit(1);
}
const bcrypt = require('bcryptjs');
const db = require('./db');

const demoTherapists = [
  { email: 'demo.calvo@example.com', name: 'Dott.ssa Calvo', specialty: 'Psicologa clinica, adolescenti e famiglie', bio: 'Mi occupo di ADHD in adolescenza e supporto alla routine scolastica.' },
  { email: 'demo.rinaldi@example.com', name: 'Dott. Rinaldi', specialty: 'Psicologo, ADHD in età adulta', bio: 'Supporto organizzativo e gestione del tempo per adulti con ADHD.' },
  { email: 'demo.ferri@example.com', name: 'Dott.ssa Ferri', specialty: 'Psichiatra', bio: 'Follow-up clinico e coordinamento con il resto del team.' },
];

(async () => {
  await db.migrate();
  console.log(`Database: ${process.env.PGDATABASE || '(default)'} su ${process.env.PGHOST || 'localhost'}`);
  for (const t of demoTherapists) {
    const existing = await db.get('SELECT id FROM users WHERE email = ?', t.email);
    if (existing) { console.log(`Già presente: ${t.email}`); continue; }
    await db.run(
      "INSERT INTO users (email, password_hash, role, name, bio, specialty) VALUES (?, ?, 'therapist', ?, ?, ?)",
      t.email, bcrypt.hashSync('DemoPass123', 10), t.name, t.bio, t.specialty,
    );
    console.log(`Creato terapeuta demo: ${t.email} (password: DemoPass123)`);
  }
  console.log('Seed completato.');
  await db.close();
})().catch(async e => {
  console.error('Seed fallito:', e.message);
  await db.close().catch(() => {});
  process.exit(1);
});

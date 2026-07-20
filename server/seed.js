// seed.js
// Script FACOLTATIVO da lanciare a mano con "npm run seed", solo per test.
// Crea qualche terapeuta demo cosi' la schermata "scegli il tuo terapeuta" non
// è vuota durante lo sviluppo. NON va lanciato su un ambiente con pazienti
// reali: creerebbe account con password demo conosciute pubblicamente.
const bcrypt = require('bcryptjs');
const db = require('./db');

const demoTherapists = [
  { email: 'demo.calvo@example.com', name: 'Dott.ssa Calvo', specialty: 'Psicologa clinica, adolescenti e famiglie', bio: 'Mi occupo di ADHD in adolescenza e supporto alla routine scolastica.' },
  { email: 'demo.rinaldi@example.com', name: 'Dott. Rinaldi', specialty: 'Psicologo, ADHD in età adulta', bio: 'Supporto organizzativo e gestione del tempo per adulti con ADHD.' },
  { email: 'demo.ferri@example.com', name: 'Dott.ssa Ferri', specialty: 'Psichiatra', bio: 'Follow-up clinico e coordinamento con il resto del team.' },
];

const insert = db.prepare(`
  INSERT INTO users (email, password_hash, role, name, bio, specialty)
  VALUES (@email, @passwordHash, 'therapist', @name, @bio, @specialty)
`);

for (const t of demoTherapists) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(t.email);
  if (existing) { console.log(`Già presente: ${t.email}`); continue; }
  insert.run({ ...t, passwordHash: bcrypt.hashSync('DemoPass123', 10) });
  console.log(`Creato terapeuta demo: ${t.email} (password: DemoPass123)`);
}
console.log('Seed completato.');

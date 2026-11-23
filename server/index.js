// index.js — punto di ingresso del server.
// "Server" qui vuol dire: un programma Node.js sempre in esecuzione che
// ascolta su una porta di rete (di default 3000) e risponde sia con i file
// dell'interfaccia (cartella /public) sia con i dati via API (/api/...).
// Carica le variabili del file .env (se esiste) senza librerie esterne.
try {
  const envPath = require('path').join(__dirname, '..', '.env');
  require('fs').readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) { /* nessun .env: va bene, si usano le variabili del sistema */ }
const db = require('./db'); // connessione a PostgreSQL (vedi server/db.js)
const path = require('path');
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const realtime = require('./realtime');
const storage = require('./storage');

const app = express();

// Sonda di salute per Azure Container Apps (liveness e readiness su /healthz).
// Sta prima di tutto il resto (niente autenticazione, cookie o file statici) e
// NON interroga il database: se il database avesse un momento di difficoltà,
// la sonda fallita farebbe riavviare il container a ripetizione senza
// risolvere nulla. Il server comincia ad ascoltare solo dopo essersi collegato
// al database (vedi in fondo), quindi un 200 qui implica che all'avvio il
// database era raggiungibile.
app.get('/healthz', (req, res) => res.sendStatus(200));

// Header di sicurezza (helmet), trust proxy e limiti ai tentativi: vedi server/security.js.
const security = require('./security');
security.applySecurity(app);

app.use(cookieParser());

// Modalità di test (TEST_MODE): se attiva, chiede nome utente e password di
// prova prima di QUALSIASI pagina, file o API (tranne /healthz, qui sopra).
// Se non è attiva non fa nulla. Vedi server/test-gate.js.
app.use(require('./test-gate').middleware());

// Limite più alto del default (100kb): le foto profilo arrivano come testo
// base64 dentro il corpo JSON, quindi devono poter passare richieste più
// grandi (vedi server/routes/profile.js, rotta PUT /photo).
app.use(express.json({ limit: '5mb' }));

// Limiti ai tentativi (dopo il parsing del corpo: il limite per account legge l'email).
app.post('/api/auth/login', ...security.loginLimiters);
app.post('/api/auth/register', security.registerLimiter);

// Foto profilo: stanno nello storage (non sul disco), quindi le serviamo da qui
// PRIMA dei file statici. I nomi file sono univoci per ogni caricamento, quindi
// la cache del browser può essere lunga.
const AVATAR_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
app.get('/uploads/avatars/:file', async (req, res, next) => {
  try {
    const m = req.params.file.match(/^[A-Za-z0-9_-]+\.(png|jpg|webp)$/);
    if (!m) return res.sendStatus(404);
    const file = await storage.read(`avatars/${req.params.file}`);
    if (!file) return res.sendStatus(404);
    res.set({
      'Content-Type': AVATAR_TYPES[m[1]],
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    if (file.length != null) res.set('Content-Length', String(file.length));
    file.stream.on('error', err => { console.error('Avatar: errore di lettura', err.message); res.destroy(err); });
    file.stream.pipe(res);
  } catch (e) { next(e); }
});

// Serve i file statici del frontend (index.html, css, js)
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/therapists', require('./routes/therapists'));
app.use('/api/family', require('./routes/family'));
app.use('/api/agenda', require('./routes/agenda'));
app.use('/api/checkins', require('./routes/checkins'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/coach', require('./routes/coach'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/reviews', require('./routes/reviews'));

// Qualsiasi errore non gestito nelle rotte finisce qui invece di far
// "crashare" silenziosamente il server o mostrare uno stack trace all'utente.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Errore interno del server.' });
});

// Creiamo un server HTTP "esplicito" (invece del solito app.listen) perché la
// videochiamata ha bisogno di una connessione WebSocket sullo stesso server:
// http.createServer(app) fa comunque partire il sito normalmente, ma ci
// permette di "agganciarci" anche per quel canale in diretta.
const server = http.createServer(app);
realtime.attach(server);

const PORT = process.env.PORT || 3000;

// Prima di accettare richieste: verifichiamo la connessione al database e
// applichiamo le eventuali migrazioni dello schema. Se il database non è
// raggiungibile il server non parte (meglio un errore chiaro all'avvio che
// errori a ogni richiesta).
storage.check()
  .then(() => db.migrate())
  .then(() => {
    server.listen(PORT, () => {
      console.log(`ADHD Coach in ascolto su http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Avvio fallito: storage dei file o database non disponibile, oppure migrazione non riuscita.');
    // Alcuni errori di rete (es. AggregateError) hanno il messaggio vuoto: mostriamo anche il codice.
    const details = err.errors ? err.errors.map(e => e.code || e.message) : [];
    console.error(`${err.code || ''} ${err.message || ''} ${details.join(', ')}`.trim());
    console.error(`(host: ${process.env.PGHOST || 'localhost'}, database: ${process.env.PGDATABASE || '-'}, utente: ${process.env.PGUSER || '-'}, password impostata: ${process.env.PGPASSWORD ? 'sì' : 'no'})`);
    process.exit(1);
  });

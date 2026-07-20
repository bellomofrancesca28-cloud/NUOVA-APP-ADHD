// index.js — punto di ingresso del server.
// "Server" qui vuol dire: un programma Node.js sempre in esecuzione che
// ascolta su una porta di rete (di default 3000) e risponde sia con i file
// dell'interfaccia (cartella /public) sia con i dati via API (/api/...).
require('./db'); // crea/apre il database e le tabelle al primo avvio
const path = require('path');
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const realtime = require('./realtime');

const app = express();
app.use(express.json());
app.use(cookieParser());

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
server.listen(PORT, () => {
  console.log(`ADHD Coach in ascolto su http://localhost:${PORT}`);
});

// middleware.js
// Un "middleware" in Express è una funzione che si inserisce prima della
// risposta vera e propria, per fare controlli comuni (qui: "questo utente è
// loggato?", "ha il ruolo giusto?"). Se il controllo fallisce, la richiesta si
// ferma qui con un errore 401/403 e non arriva mai alla logica della rotta.
const db = require('./db');
const { readToken } = require('./auth-utils');

function requireAuth(req, res, next) {
  const payload = readToken(req);
  if (!payload) return res.status(401).json({ error: 'Non autenticato. Effettua di nuovo il login.' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
  if (!user) return res.status(401).json({ error: 'Utente non trovato.' });
  req.user = user; // riga completa dal database, sempre aggiornata
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: 'Questa azione non è disponibile per il tuo ruolo.' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };

// auth-utils.js
// Piccolo glossario dei concetti usati qui:
// - "hashing" (bcrypt): trasformiamo la password in una stringa illeggibile e
//   irreversibile. Sul database non è mai salvata la password vera, solo il suo
//   hash: anche noi sviluppatori non possiamo "recuperarla", solo verificare se
//   una password inserita produce lo stesso hash.
// - "JWT" (JSON Web Token): un pacchetto di dati firmato digitalmente (qui:
//   id utente e ruolo) che il server può verificare senza dover interrogare il
//   database ad ogni richiesta solo per sapere "chi è loggato".
// - "cookie httpOnly": un piccolo file che il browser conserva e rimanda al
//   server automaticamente ad ogni richiesta. "httpOnly" vuol dire che il
//   JavaScript della pagina non può leggerlo (protezione da furto del token
//   tramite script malevoli).
const jwt = require('jsonwebtoken');

// In produzione questa chiave deve arrivare da una variabile d'ambiente
// (impostabile sul servizio di hosting), non stare scritta nel codice.
const JWT_SECRET = process.env.JWT_SECRET || 'CAMBIA-QUESTA-CHIAVE-PRIMA-DI-DISTRIBUIRE-DAVVERO';
const COOKIE_NAME = 'adhd_coach_token';
const TOKEN_TTL = '30d';

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function setAuthCookie(res, user) {
  const token = signToken(user);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    // 'secure' va messo a true quando l'app gira davvero su https (in produzione).
    secure: process.env.NODE_ENV === 'production',
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

function readToken(req) {
  const raw = req.cookies && req.cookies[COOKIE_NAME];
  if (!raw) return null;
  try {
    return jwt.verify(raw, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

module.exports = { signToken, setAuthCookie, clearAuthCookie, readToken, COOKIE_NAME };

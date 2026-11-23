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

// La chiave arriva SEMPRE da una variabile d'ambiente. In produzione, se manca
// (o è troppo corta), il server non parte: con una chiave di ripiego nota i
// token sarebbero falsificabili. Solo in sviluppo si usa una chiave locale.
// Questo è l'unico punto in cui viene letta (la usa anche realtime.js).
const DEV_FALLBACK_SECRET = 'solo-sviluppo-locale-non-usare-in-produzione';
// Sulla Container App la chiave è il secret "session-secret", esposto come
// SESSION_SECRET: lo accettiamo come alternativa a JWT_SECRET.
let JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET;
if (process.env.NODE_ENV === 'production') {
  if (!JWT_SECRET || JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET mancante o troppo corta (minimo 32 caratteri): impostala nelle variabili d\'ambiente.');
  }
} else if (!JWT_SECRET) {
  JWT_SECRET = DEV_FALLBACK_SECRET;
  console.warn('Attenzione: JWT_SECRET non impostata, uso una chiave di sviluppo. Non usare così in produzione.');
}
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
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
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

// Verifica un token grezzo (usata anche dal WebSocket della videochiamata).
function verifyToken(raw) {
  try { return jwt.verify(raw, JWT_SECRET); } catch (e) { return null; }
}

module.exports = { signToken, setAuthCookie, clearAuthCookie, readToken, verifyToken, COOKIE_NAME };

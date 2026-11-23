// test-gate.js — "cancello" di accesso per la modalità di test.
//
// Quando TEST_MODE è attivo, PRIMA di qualsiasi pagina o API dell'app viene
// chiesto un nome utente e una password di prova (diversi dagli account veri
// dell'app). Serve a pubblicare l'app su internet facendola vedere solo alle
// persone a cui si danno queste credenziali. Non sostituisce il login dell'app:
// dopo il cancello si entra nella normale schermata di accesso.
//
// Variabili d'ambiente:
//   TEST_MODE            = true | 1 | on   -> cancello attivo (altrimenti spento)
//   TEST_ACCESS_USERS    = elenco "utente:password" separati da virgola o a capo
//                          (da tenere in un SECRET). Al posto della password si
//                          può mettere un hash bcrypt ("utente:$2b$10$...").
//   TEST_ACCESS_DAYS     = durata dell'accesso in giorni (default 7)
//   TEST_ACCESS_SECRET   = chiave per firmare il cookie (default: JWT_SECRET /
//                          SESSION_SECRET; se mancano, una chiave casuale che
//                          cambia a ogni riavvio, e allora si rientra).
//
// Togliere un utente dall'elenco o cambiargli la password invalida subito il
// suo accesso, anche se ha già il cookie.
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');

const ENABLED = /^(1|true|on|yes)$/i.test(process.env.TEST_MODE || '');
const COOKIE = 'adhd_test_access';
const BASE = '/_test-access';
const DAYS = Math.max(1, Number(process.env.TEST_ACCESS_DAYS) || 7);
const KEY = process.env.TEST_ACCESS_SECRET || process.env.JWT_SECRET || process.env.SESSION_SECRET
  || crypto.randomBytes(32).toString('hex');

// utente -> { secret, fingerprint }
function parseUsers(raw) {
  const users = new Map();
  for (const entry of String(raw || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean)) {
    const idx = entry.indexOf(':');
    if (idx < 1 || idx === entry.length - 1) continue;
    const name = entry.slice(0, idx).trim().toLowerCase();
    const secret = entry.slice(idx + 1);
    users.set(name, { secret, fingerprint: crypto.createHash('sha256').update(entry).digest('hex') });
  }
  return users;
}
const USERS = parseUsers(process.env.TEST_ACCESS_USERS);

if (ENABLED && USERS.size === 0) {
  // Meglio non partire che pubblicare l'app "aperta" credendola protetta.
  throw new Error('TEST_MODE attivo ma TEST_ACCESS_USERS è vuota o non valida (formato "utente:password").');
}

function checkPassword(user, password) {
  if (user.secret.startsWith('$2')) return bcrypt.compareSync(password, user.secret);
  const a = crypto.createHash('sha256').update(String(password)).digest();
  const b = crypto.createHash('sha256').update(user.secret).digest();
  return crypto.timingSafeEqual(a, b);
}

function sign(payload, fingerprint) {
  return crypto.createHmac('sha256', KEY).update(`${payload}.${fingerprint}`).digest('base64url');
}

function makeCookieValue(name) {
  const payload = Buffer.from(JSON.stringify({ u: name, exp: Date.now() + DAYS * 864e5 })).toString('base64url');
  return `${payload}.${sign(payload, USERS.get(name).fingerprint)}`;
}

// Restituisce il nome utente se il cookie è valido, altrimenti null.
function verifyCookieValue(value) {
  if (!value || typeof value !== 'string') return null;
  const [payload, mac] = value.split('.');
  if (!payload || !mac) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch (e) { return null; }
  const user = data && USERS.get(data.u);
  if (!user || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
  const expected = Buffer.from(sign(payload, user.fingerprint));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  return data.u;
}

// Per il WebSocket della videochiamata, che non passa dai middleware Express.
function allowsCookieHeader(header) {
  if (!ENABLED) return true;
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1 && part.slice(0, idx).trim() === COOKIE) {
      try { return verifyCookieValue(decodeURIComponent(part.slice(idx + 1).trim())) !== null; } catch (e) { return false; }
    }
  }
  return false;
}

// ---- Limite ai tentativi sbagliati (per indirizzo IP, in memoria) ----
const MAX_FAILS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const fails = new Map();
// Indirizzo del client secondo la configurazione "trust proxy" di Express
// (vedi security.js e la variabile TRUST_PROXY_HOPS): stesso criterio usato
// per i limiti sul login. Gli indirizzi più a sinistra di X-Forwarded-For li
// può inventare il client, per questo si contano solo i proxy fidati.
function clientIp(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}
function tooManyFails(ip) {
  const f = fails.get(ip);
  if (!f) return false;
  if (Date.now() - f.since > WINDOW_MS) { fails.delete(ip); return false; }
  return f.count >= MAX_FAILS;
}
function recordFail(ip) {
  const f = fails.get(ip);
  if (!f || Date.now() - f.since > WINDOW_MS) fails.set(ip, { count: 1, since: Date.now() });
  else f.count++;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, f] of fails) if (now - f.since > WINDOW_MS) fails.delete(ip);
}, WINDOW_MS).unref();

// Solo percorsi interni all'app ("/qualcosa"), mai URL verso altri siti.
// Si rifiuta: "//host" (protocol-relative), "/\host" (i browser trattano "\"
// come "/", quindi diventerebbe "//host"), qualunque "\" e i caratteri di
// controllo (a capo, tab), usati per aggirare i filtri.
function safeNext(value) {
  const v = typeof value === 'string' ? value : '/';
  if (v.length > 2000) return '/';
  if (!/^\/(?![\/\\])[^\\\x00-\x1f\x7f]*$/.test(v)) return '/';
  if (v.startsWith(BASE)) return '/';
  return v;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function page(next, message) {
  return `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>ADHD Coach — accesso di prova</title>
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,sans-serif;background:#f4f2fb;color:#1f1d2b}
  @media (prefers-color-scheme:dark){body{background:#16151d;color:#ece9f6}.card{background:#211f2b!important;border-color:#34314a!important}input{background:#16151d!important;color:inherit!important;border-color:#3d3a52!important}}
  .card{width:min(360px,calc(100vw - 32px));background:#fff;border:1px solid #e3def3;border-radius:16px;padding:28px 24px;box-sizing:border-box}
  .badge{display:inline-block;font-size:12px;font-weight:600;letter-spacing:.04em;padding:3px 8px;border-radius:999px;background:#ffe9b3;color:#6b4b00}
  h1{font-size:20px;margin:12px 0 4px}p{margin:0 0 18px;font-size:14px;opacity:.8;line-height:1.45}
  label{display:block;font-size:13px;font-weight:600;margin:12px 0 6px}
  input{width:100%;box-sizing:border-box;padding:11px 12px;font-size:16px;border:1px solid #d6d0ea;border-radius:10px}
  button{margin-top:18px;width:100%;padding:12px;font-size:16px;font-weight:600;border:0;border-radius:10px;background:#6b4fd8;color:#fff;cursor:pointer}
  .err{margin-top:14px;font-size:14px;color:#c0392b}
</style></head><body>
<form class="card" method="post" action="${BASE}" autocomplete="on">
  <span class="badge">TEST MODE</span>
  <h1>ADHD Coach</h1>
  <p>Questa è una versione di prova ad accesso riservato. Inserisci le credenziali che ti sono state fornite.</p>
  <input type="hidden" name="next" value="${escapeHtml(next)}">
  <label for="u">Nome utente</label><input id="u" name="username" autocomplete="username" required autofocus>
  <label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required>
  <button type="submit">Entra</button>
  ${message ? `<div class="err" role="alert">${escapeHtml(message)}</div>` : ''}
</form></body></html>`;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: DAYS * 864e5,
    path: '/',
  };
}

// Va montato DOPO /healthz (che deve restare libero per le sonde di Azure)
// e PRIMA di file statici e API.
function middleware() {
  const router = express.Router();
  if (!ENABLED) return router; // modalità normale: il cancello non esiste

  console.log(`TEST MODE attivo: accesso riservato a ${USERS.size} utente/i di prova.`);

  router.use((req, res, next) => {
    res.set('X-Robots-Tag', 'noindex, nofollow'); // l'ambiente di test non va indicizzato
    next();
  });

  router.get(BASE, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.send(page(safeNext(req.query.next)));
  });

  router.post(BASE, express.urlencoded({ extended: false, limit: '10kb' }), (req, res) => {
    res.set('Cache-Control', 'no-store');
    const ip = clientIp(req);
    const next = safeNext(req.body && req.body.next);
    if (tooManyFails(ip)) {
      return res.status(429).send(page(next, 'Troppi tentativi. Riprova tra qualche minuto.'));
    }
    const name = String((req.body && req.body.username) || '').trim().toLowerCase();
    const password = String((req.body && req.body.password) || '');
    const user = USERS.get(name);
    if (!user || !checkPassword(user, password)) {
      recordFail(ip);
      console.warn(`TEST MODE: accesso negato (utente "${name.slice(0, 40)}", ip ${ip}, x-forwarded-for "${String(req.headers['x-forwarded-for'] || '').slice(0, 120)}")`);
      return res.status(401).send(page(next, 'Nome utente o password non corretti.'));
    }
    fails.delete(ip);
    console.log(`TEST MODE: accesso consentito a "${name}" (ip ${ip})`);
    res.cookie(COOKIE, makeCookieValue(name), cookieOptions());
    res.redirect(303, next);
  });

  router.get(`${BASE}/logout`, (req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.redirect(303, BASE);
  });

  router.use((req, res, next) => {
    if (verifyCookieValue(req.cookies && req.cookies[COOKIE])) return next();
    if (req.path.startsWith('/api/') || req.method !== 'GET') {
      return res.status(401).json({ error: 'Accesso di prova richiesto.' });
    }
    res.redirect(303, `${BASE}?next=${encodeURIComponent(req.originalUrl)}`);
  });

  return router;
}

module.exports = { middleware, allowsCookieHeader, ENABLED };

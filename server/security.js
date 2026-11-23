// security.js — header di sicurezza e limiti ai tentativi.
//
// 1) Header (helmet): HSTS, CSP, frame-ancestors 'none' / X-Frame-Options DENY,
//    nosniff, Referrer-Policy, x-powered-by disattivato.
// 2) Rate limit su login e registrazione (in memoria, per istanza: va bene con
//    una sola replica, vedi maxReplicas=1; con più repliche ogni istanza
//    conterrebbe i propri tentativi).
//
// NOTA SULLA CSP: l'interfaccia usa ancora attributi inline (onclick="...",
// style="..."), quindi per ora script-src-attr e style-src ammettono
// 'unsafe-inline'. Restano però bloccati: <script> inline, script da altri
// domini, framing, base/form verso altri siti. Per stringere ancora si
// dovranno spostare i gestori onclick in app.js (addEventListener) e poi
// togliere 'unsafe-inline' da script-src-attr.
// CSP_REPORT_ONLY=true => la CSP segnala nella console del browser senza
// bloccare (utile per provare una modifica).
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const isProd = process.env.NODE_ENV === 'production';

function applySecurity(app) {
  app.disable('x-powered-by');
  // Quanti proxy stanno DAVANTI all'app e vanno considerati affidabili per
  // ricavare l'IP del client (req.ip). Default 1 = solo l'ingress di Azure
  // Container Apps. Se davanti c'è anche un altro componente che aggiunge il
  // proprio indirizzo a X-Forwarded-For (es. un firewall/reverse proxy), va
  // portato a 2 con TRUST_PROXY_HOPS=2. Contare male qui falsa i limiti ai
  // tentativi (tutti gli utenti risulterebbero lo stesso indirizzo).
  const hops = Number.parseInt(process.env.TRUST_PROXY_HOPS, 10);
  app.set('trust proxy', Number.isInteger(hops) && hops >= 0 ? hops : 1);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      reportOnly: process.env.CSP_REPORT_ONLY === 'true',
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'unsafe-inline'"], // TEMPORANEO: onclick inline in index.html/app.js
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'], // icone Tabler
        fontSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"], // include il WebSocket della videochiamata (stesso host)
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(isProd ? { upgradeInsecureRequests: [] } : {}), // in locale (http) romperebbe le risorse
      },
    },
    hsts: isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    frameguard: { action: 'deny' },
    // I token (es. approvazione tutor) viaggiano nell'URL: niente Referer verso altri siti.
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginEmbedderPolicy: false,
  }));

  // La videochiamata usa camera e microfono, ma solo dal nostro stesso sito.
  app.use((req, res, next) => {
    res.set('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
    next();
  });
}

const tooMany = (message) => (req, res) => res.status(429).json({ error: message });
const common = { standardHeaders: 'draft-7', legacyHeaders: false };

// Login: due limiti sui tentativi FALLITI (i login riusciti non contano).
//  - per indirizzo IP: frena chi prova molte password/molti account;
//  - per email: frena chi attacca un solo account da molti IP.
//    (Effetto collaterale noto: chi sbaglia 10 volte la propria password
//    aspetta qualche minuto. Accettabile.)
const loginByIp = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  handler: tooMany('Troppi tentativi di accesso. Riprova tra qualche minuto.'),
});
const loginByAccount = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `login:${String((req.body && req.body.email) || '').toLowerCase().trim().slice(0, 200)}`,
  handler: tooMany('Troppi tentativi per questo account. Riprova tra qualche minuto.'),
});

// Registrazione: evita creazione massiva di account e invio massivo di email
// all'amministratrice (ogni tutor genera una mail con il CV allegato).
const registerLimit = rateLimit({
  ...common,
  windowMs: 60 * 60 * 1000,
  limit: 20,
  handler: tooMany('Troppe registrazioni da questo indirizzo. Riprova più tardi.'),
});

module.exports = { applySecurity, loginLimiters: [loginByIp, loginByAccount], registerLimiter: registerLimit };

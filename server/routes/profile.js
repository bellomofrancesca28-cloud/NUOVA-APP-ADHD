const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware');
const { publicUser, Router } = require('../helpers');
const storage = require('../storage');

const router = Router();

// Le foto profilo (oggi usate dal tutor, ma la rotta non è limitata al
// ruolo: potrà servire anche altrove in futuro) NON stanno nel database né
// sul disco del container (che si azzera a ogni riavvio): vanno nello storage
// (Azure Blob in produzione, vedi server/storage.js) e si leggono dall'URL
// /uploads/avatars/<file>, servito da index.js.
// Accettiamo solo un piccolo elenco di formati immagine comuni.
const ALLOWED_IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MAX_PHOTO_BYTES = 3 * 1024 * 1024; // 3MB, generoso per una foto profilo

// "/uploads/avatars/12-ab34.jpg" (come salvato nel database) -> "avatars/12-ab34.jpg"
function avatarKey(url) {
  const m = typeof url === 'string' && url.match(/^\/uploads\/(avatars\/[A-Za-z0-9_-]+\.[a-z]{3,4})$/);
  return m ? m[1] : null;
}

router.put('/', requireAuth, async (req, res) => {
  const { name, nickname, avatar, job, goal, bio, specialty, birth_date } = req.body || {};
  if (req.user.role === 'patient') {
    const bd = String(birth_date || '');
    const d = new Date(bd);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bd) || isNaN(d) || d > new Date() || d.getFullYear() < 1900) {
      return res.status(400).json({ error: 'Inserisci una data di nascita valida.' });
    }
  }
  await db.run(`
    UPDATE users SET
      name = COALESCE(NULLIF(?, ''), name),
      nickname = ?,
      avatar = COALESCE(NULLIF(?, ''), avatar),
      job = ?,
      goal = ?,
      bio = ?,
      specialty = ?,
      birth_date = COALESCE(?::date, birth_date)
    WHERE id = ?
  `,
    name || '',
    nickname || null,
    avatar || '',
    job || null,
    goal || null,
    bio || null,
    specialty || null,
    birth_date || null,
    req.user.id,
  );
  const user = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
  res.json({ user: publicUser(user) });
});

// Preferenze di notifica, chieste una volta subito dopo la registrazione
// (schermata dedicata) ma modificabili in qualsiasi momento in seguito.
router.put('/notifications', requireAuth, async (req, res) => {
  const { push, email, reminders, morningTime, leadMin } = req.body || {};
  await db.run('UPDATE users SET notif_push = ?, notif_email = ?, notif_reminders = ? WHERE id = ?', push ? 1 : 0, email ? 1 : 0, reminders ? 1 : 0, req.user.id);
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(morningTime || '')) {
    await db.run('UPDATE users SET notif_morning_time = ? WHERE id = ?', morningTime, req.user.id);
  }
  if ([5, 10, 15, 30, 60].includes(Number(leadMin))) {
    await db.run('UPDATE users SET notif_lead_min = ? WHERE id = ?', Number(leadMin), req.user.id);
  }
  const user = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
  res.json({ user: publicUser(user) });
});

// Accettazione di privacy e consenso informato, subito dopo la
// registrazione: entrambi obbligatori, quindi qui richiediamo che siano true
// e salviamo la data/ora esatta come prova dell'accettazione.
router.put('/consent', requireAuth, async (req, res) => {
  const { privacy, consent } = req.body || {};
  if (!privacy || !consent) {
    return res.status(400).json({ error: 'Devi accettare privacy e consenso informato per continuare.' });
  }
  const now = new Date().toISOString();
  await db.run('UPDATE users SET privacy_accepted_at = ?, consent_accepted_at = ? WHERE id = ?', now, now, req.user.id);
  const user = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
  res.json({ user: publicUser(user) });
});

// Carica/sostituisce la foto del profilo. Il client manda l'immagine come
// "data URL" (es. "data:image/png;base64,AAAA...") letta dal file scelto
// dall'utente: niente librerie di upload aggiuntive da installare, il corpo
// arriva come JSON normale (vedi il limite più alto impostato in index.js).
router.put('/photo', requireAuth, async (req, res) => {
  const { imageBase64 } = req.body || {};
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return res.status(400).json({ error: 'Nessuna immagine ricevuta.' });
  }
  const match = imageBase64.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if (!match) {
    return res.status(400).json({ error: 'Formato immagine non valido. Usa PNG, JPG o WEBP.' });
  }
  const [, mimeType, base64Data] = match;
  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length > MAX_PHOTO_BYTES) {
    return res.status(400).json({ error: 'Immagine troppo grande: massimo 3MB.' });
  }

  const previous = await db.get('SELECT avatar_photo FROM users WHERE id = ?', req.user.id);

  const ext = ALLOWED_IMAGE_TYPES[mimeType];
  const filename = `${req.user.id}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  await storage.save(`avatars/${filename}`, buffer, mimeType);
  await db.run('UPDATE users SET avatar_photo = ? WHERE id = ?', `/uploads/avatars/${filename}`, req.user.id);

  // Solo dopo aver salvato la nuova, rimuoviamo la vecchia (al meglio: se
  // fallisce, resta un file orfano ma l'utente ha comunque la foto nuova).
  const oldKey = previous && avatarKey(previous.avatar_photo);
  if (oldKey) await storage.remove(oldKey);
  const user = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
  res.json({ user: publicUser(user) });
});

router.delete('/photo', requireAuth, async (req, res) => {
  const previous = await db.get('SELECT avatar_photo FROM users WHERE id = ?', req.user.id);
  await db.run('UPDATE users SET avatar_photo = NULL WHERE id = ?', req.user.id);
  const oldKey = previous && avatarKey(previous.avatar_photo);
  if (oldKey) await storage.remove(oldKey);
  const user = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
  res.json({ user: publicUser(user) });
});

// Obiettivi scelti dal paziente in fase di onboarding (selezione multipla).
router.put('/goals', requireAuth, requireRole('patient'), async (req, res) => {
  const goals = Array.isArray((req.body || {}).goals) ? req.body.goals : [];
  await db.run('UPDATE users SET goals = ? WHERE id = ?', goals.join(','), req.user.id);
  const user = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
  res.json({ user: publicUser(user) });
});

module.exports = router;

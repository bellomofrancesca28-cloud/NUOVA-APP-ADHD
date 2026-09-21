const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware');
const { publicUser } = require('../helpers');

const router = express.Router();

// Le foto profilo (oggi usate dal tutor, ma la rotta non è limitata al
// ruolo: potrà servire anche altrove in futuro) vengono salvate come file
// veri su disco, non dentro il database — più leggero da leggere/servire.
// Accettiamo solo un piccolo elenco di formati immagine comuni.
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'avatars');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const ALLOWED_IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MAX_PHOTO_BYTES = 3 * 1024 * 1024; // 3MB, generoso per una foto profilo

router.put('/', requireAuth, (req, res) => {
  const { name, nickname, avatar, job, goal, bio, specialty } = req.body || {};
  db.prepare(`
    UPDATE users SET
      name = COALESCE(NULLIF(@name, ''), name),
      nickname = @nickname,
      avatar = COALESCE(NULLIF(@avatar, ''), avatar),
      job = @job,
      goal = @goal,
      bio = @bio,
      specialty = @specialty
    WHERE id = @id
  `).run({
    id: req.user.id,
    name: name || '',
    nickname: nickname || null,
    avatar: avatar || '',
    job: job || null,
    goal: goal || null,
    bio: bio || null,
    specialty: specialty || null,
  });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

// Preferenze di notifica, chieste una volta subito dopo la registrazione
// (schermata dedicata) ma modificabili in qualsiasi momento in seguito.
router.put('/notifications', requireAuth, (req, res) => {
  const { push, email, reminders } = req.body || {};
  db.prepare('UPDATE users SET notif_push = ?, notif_email = ?, notif_reminders = ? WHERE id = ?')
    .run(push ? 1 : 0, email ? 1 : 0, reminders ? 1 : 0, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

// Accettazione di privacy e consenso informato, subito dopo la
// registrazione: entrambi obbligatori, quindi qui richiediamo che siano true
// e salviamo la data/ora esatta come prova dell'accettazione.
router.put('/consent', requireAuth, (req, res) => {
  const { privacy, consent } = req.body || {};
  if (!privacy || !consent) {
    return res.status(400).json({ error: 'Devi accettare privacy e consenso informato per continuare.' });
  }
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET privacy_accepted_at = ?, consent_accepted_at = ? WHERE id = ?')
    .run(now, now, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

// Carica/sostituisce la foto del profilo. Il client manda l'immagine come
// "data URL" (es. "data:image/png;base64,AAAA...") letta dal file scelto
// dall'utente: niente librerie di upload aggiuntive da installare, il corpo
// arriva come JSON normale (vedi il limite più alto impostato in index.js).
router.put('/photo', requireAuth, (req, res) => {
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

  // Rimuoviamo l'eventuale foto precedente di questo utente prima di
  // salvarne una nuova, per non lasciare file orfani sul disco.
  const previous = db.prepare('SELECT avatar_photo FROM users WHERE id = ?').get(req.user.id);
  if (previous && previous.avatar_photo) {
    const oldPath = path.join(__dirname, '..', '..', 'public', previous.avatar_photo);
    fs.unlink(oldPath, () => {}); // best-effort, non blocchiamo la richiesta se fallisce
  }

  const ext = ALLOWED_IMAGE_TYPES[mimeType];
  const filename = `${req.user.id}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
  const url = `/uploads/avatars/${filename}`;
  db.prepare('UPDATE users SET avatar_photo = ? WHERE id = ?').run(url, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

router.delete('/photo', requireAuth, (req, res) => {
  const previous = db.prepare('SELECT avatar_photo FROM users WHERE id = ?').get(req.user.id);
  if (previous && previous.avatar_photo) {
    const oldPath = path.join(__dirname, '..', '..', 'public', previous.avatar_photo);
    fs.unlink(oldPath, () => {});
  }
  db.prepare('UPDATE users SET avatar_photo = NULL WHERE id = ?').run(req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

// Obiettivi scelti dal paziente in fase di onboarding (selezione multipla).
router.put('/goals', requireAuth, requireRole('patient'), (req, res) => {
  const goals = Array.isArray((req.body || {}).goals) ? req.body.goals : [];
  db.prepare('UPDATE users SET goals = ? WHERE id = ?').run(goals.join(','), req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

module.exports = router;

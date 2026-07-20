const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware');
const { publicUser } = require('../helpers');

const router = express.Router();

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

// Obiettivi scelti dal paziente in fase di onboarding (selezione multipla).
router.put('/goals', requireAuth, requireRole('patient'), (req, res) => {
  const goals = Array.isArray((req.body || {}).goals) ? req.body.goals : [];
  db.prepare('UPDATE users SET goals = ? WHERE id = ?').run(goals.join(','), req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

module.exports = router;

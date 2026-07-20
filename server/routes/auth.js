const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { setAuthCookie, clearAuthCookie } = require('../auth-utils');
const { requireAuth } = require('../middleware');
const { ageGroupFromRange, publicUser } = require('../helpers');

const router = express.Router();

const VALID_AGE_RANGES = ['teen', 'adult']; // teen = 14-17, adult = >18 (solo pazienti)

router.post('/register', (req, res) => {
  const { email, password, role, name, ageRange, job, goal, bio, specialty } = req.body || {};

  if (!email || !password || !role || !name) {
    return res.status(400).json({ error: 'Compila email, password, nome e ruolo.' });
  }
  if (!['patient', 'therapist', 'parent'].includes(role)) {
    return res.status(400).json({ error: 'Ruolo non valido.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'La password deve avere almeno 8 caratteri.' });
  }
  if (role === 'patient' && !VALID_AGE_RANGES.includes(ageRange)) {
    return res.status(400).json({ error: 'Seleziona 14-17 oppure >18.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) {
    return res.status(409).json({ error: 'Esiste già un account con questa email.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const ageGroup = role === 'patient' ? ageGroupFromRange(ageRange) : null;

  const info = db.prepare(`
    INSERT INTO users (email, password_hash, role, name, age_range, age_group, job, goal, bio, specialty)
    VALUES (@email, @passwordHash, @role, @name, @ageRange, @ageGroup, @job, @goal, @bio, @specialty)
  `).run({
    email: email.toLowerCase().trim(),
    passwordHash,
    role,
    name: name.trim(),
    ageRange: role === 'patient' ? ageRange : null,
    ageGroup,
    job: job || null,
    goal: goal || null,
    bio: role === 'therapist' ? (bio || null) : null,
    specialty: role === 'therapist' ? (specialty || null) : null,
  });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  setAuthCookie(res, user);
  res.json({ user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Inserisci email e password.' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Email o password non corrette.' });
  }
  setAuthCookie(res, user);
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  let therapistLink = null;
  if (req.user.role === 'patient') {
    const link = db.prepare(`
      SELECT pt.*, u.name as therapist_name, u.avatar as therapist_avatar, u.specialty as therapist_specialty
      FROM patient_therapist pt JOIN users u ON u.id = pt.therapist_id
      WHERE pt.patient_id = ?
    `).get(req.user.id);
    therapistLink = link || null;
  }
  res.json({ user: publicUser(req.user), therapistLink });
});

module.exports = router;

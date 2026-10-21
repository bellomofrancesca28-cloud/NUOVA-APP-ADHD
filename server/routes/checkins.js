const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware');

const router = express.Router();

router.get('/', requireAuth, requireRole('patient'), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const rows = db.prepare('SELECT * FROM checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(req.user.id, limit);
  res.json({ checkins: rows });
});

// Diario di un paziente specifico, visto dal suo terapeuta: verifichiamo che
// il paziente sia davvero collegato a chi fa la richiesta (stesso controllo
// usato altrove per non far vedere dati di pazienti non propri).
router.get('/patient/:id', requireAuth, requireRole('therapist'), (req, res) => {
  const patientId = Number(req.params.id);
  const link = db.prepare('SELECT 1 FROM patient_therapist WHERE therapist_id = ? AND patient_id = ? AND status = \'active\'').get(req.user.id, patientId);
  if (!link) return res.status(403).json({ error: 'Utente non collegato al tuo account.' });
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const rows = db.prepare('SELECT * FROM checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(patientId, limit);
  res.json({ checkins: rows });
});

router.post('/', requireAuth, requireRole('patient'), (req, res) => {
  const { mood, energy, focus, stress, sleep, cognitiveLoad, note } = req.body || {};
  const clamp = v => (v === undefined || v === null) ? null : Math.max(1, Math.min(10, Number(v)));
  const info = db.prepare(`
    INSERT INTO checkins (user_id, mood, energy, focus, stress, sleep, cognitive_load, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, clamp(mood), clamp(energy), clamp(focus), clamp(stress), clamp(sleep), clamp(cognitiveLoad), (note || '').slice(0, 2000));
  const row = db.prepare('SELECT * FROM checkins WHERE id = ?').get(info.lastInsertRowid);
  res.json({ checkin: row });
});

// "Come ti senti oggi?": scelta rapida con le faccine dalla Home. Una sola
// voce al giorno: se l'utente cambia idea, aggiorniamo quella di oggi.
const QUICK_MOODS = { benissimo: 10, bene: 8, cosi_cosi: 5, triste: 3, arrabbiato: 2 };

router.get('/quick/today', requireAuth, requireRole('patient'), (req, res) => {
  const row = db.prepare(`
    SELECT mood_label FROM checkins
    WHERE user_id = ? AND mood_label IS NOT NULL AND date(created_at) = date('now')
    ORDER BY created_at DESC, id DESC LIMIT 1
  `).get(req.user.id);
  res.json({ label: row ? row.mood_label : null });
});

router.post('/quick', requireAuth, requireRole('patient'), (req, res) => {
  const label = req.body && req.body.label;
  if (!Object.prototype.hasOwnProperty.call(QUICK_MOODS, label)) {
    return res.status(400).json({ error: 'Scelta non valida.' });
  }
  const existing = db.prepare(`
    SELECT id FROM checkins
    WHERE user_id = ? AND mood_label IS NOT NULL AND date(created_at) = date('now')
    ORDER BY created_at DESC, id DESC LIMIT 1
  `).get(req.user.id);
  if (existing) {
    db.prepare('UPDATE checkins SET mood = ?, mood_label = ? WHERE id = ?').run(QUICK_MOODS[label], label, existing.id);
  } else {
    db.prepare('INSERT INTO checkins (user_id, mood, mood_label) VALUES (?, ?, ?)').run(req.user.id, QUICK_MOODS[label], label);
  }
  res.json({ label });
});

module.exports = router;

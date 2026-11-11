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

// Stato d'animo di ogni giorno di un mese (per il Calendario): per ciascun
// giorno prendiamo la faccina scelta con "Come ti senti oggi?", altrimenti
// l'umore dell'ultimo check-in di quel giorno.
router.get('/month', requireAuth, requireRole('patient'), (req, res) => {
  const year = Number(req.query.year), month = Number(req.query.month);
  if (!year || !month || month < 1 || month > 12) return res.status(400).json({ error: 'Mese non valido.' });
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = `${year}-${String(month).padStart(2, '0')}-31`;
  const rows = db.prepare(`
    SELECT date(created_at) as d, mood, mood_label FROM checkins
    WHERE user_id = ? AND date(created_at) BETWEEN ? AND ? AND mood IS NOT NULL
    ORDER BY created_at ASC, id ASC
  `).all(req.user.id, start, end);
  const byDay = {};
  rows.forEach(r => {
    const cur = byDay[r.d];
    // una faccina "Come ti senti oggi?" ha la precedenza su un check-in a cursori
    if (!cur || r.mood_label || !cur.mood_label) byDay[r.d] = { date: r.d, mood: r.mood, mood_label: r.mood_label || null };
  });
  res.json({ days: Object.values(byDay) });
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

// Domande del Diario: una scheda al giorno, salvata passo dopo passo.
const QKEYS = ['umore','umore_f','energia','energia_f','focus','focus_f','stress','stress_f','sonno','sonno_f','carico','carico_f'];
router.get('/questionnaire/today', requireAuth, requireRole('patient'), (req, res) => {
  const row = db.prepare("SELECT answers FROM diary_answers WHERE user_id = ? AND day = date('now')").get(req.user.id);
  res.json({ answers: row ? JSON.parse(row.answers) : {} });
});
router.post('/questionnaire', requireAuth, requireRole('patient'), (req, res) => {
  const { key, value } = req.body || {};
  if (!QKEYS.includes(key)) return res.status(400).json({ error: 'Domanda non valida.' });
  const row = db.prepare("SELECT answers FROM diary_answers WHERE user_id = ? AND day = date('now')").get(req.user.id);
  const answers = row ? JSON.parse(row.answers) : {};
  if (value === null || value === undefined || value === '') delete answers[key];
  else answers[key] = String(value).slice(0, 200);
  db.prepare(`INSERT INTO diary_answers (user_id, day, answers) VALUES (?, date('now'), ?)
    ON CONFLICT(user_id, day) DO UPDATE SET answers = excluded.answers, updated_at = CURRENT_TIMESTAMP`)
    .run(req.user.id, JSON.stringify(answers));
  res.json({ answers });
});
// Risposte recenti di un utente, viste dal suo tutor.
router.get('/questionnaire/patient/:id', requireAuth, requireRole('therapist'), (req, res) => {
  const patientId = Number(req.params.id);
  const link = db.prepare("SELECT 1 FROM patient_therapist WHERE therapist_id = ? AND patient_id = ? AND status = 'active'").get(req.user.id, patientId);
  if (!link) return res.status(403).json({ error: 'Utente non collegato al tuo account.' });
  const rows = db.prepare('SELECT day, answers FROM diary_answers WHERE user_id = ? ORDER BY day DESC LIMIT 14').all(patientId);
  res.json({ entries: rows.map(r => ({ day: r.day, answers: JSON.parse(r.answers) })) });
});

module.exports = router;

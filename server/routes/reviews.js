const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware');

const router = express.Router();

// Stesso pattern di isolamento usato per i messaggi: la coppia
// paziente/terapeuta rilevante si ricava sempre da chi è loggato, mai da un
// id passato liberamente dal client.
function resolvePair(req) {
  if (req.user.role === 'patient') {
    const link = db.prepare('SELECT * FROM patient_therapist WHERE patient_id = ?').get(req.user.id);
    if (!link) return null;
    return { patientId: req.user.id, therapistId: link.therapist_id };
  }
  const patientId = Number(req.query.patientId || (req.body && req.body.patientId));
  if (!patientId) return null;
  const link = db.prepare('SELECT * FROM patient_therapist WHERE patient_id = ? AND therapist_id = ?').get(patientId, req.user.id);
  if (!link) return null;
  return { patientId, therapistId: req.user.id };
}

router.get('/', requireAuth, (req, res) => {
  const pair = resolvePair(req);
  if (!pair) return res.status(403).json({ error: 'Nessun collegamento paziente-terapeuta trovato.' });
  const slots = db.prepare(`
    SELECT * FROM review_slots WHERE patient_id = ? AND therapist_id = ?
    ORDER BY slot_date ASC, slot_time ASC
  `).all(pair.patientId, pair.therapistId);
  res.json({ slots });
});

// Solo il terapeuta propone un orario (deciso insieme a Barbara): il
// paziente potrà solo confermare o rifiutare quanto proposto.
router.post('/', requireAuth, requireRole('therapist'), (req, res) => {
  const pair = resolvePair(req);
  if (!pair) return res.status(403).json({ error: 'Paziente non collegato al tuo account.' });
  const { date, time, cadence } = req.body || {};
  if (!date || !time) return res.status(400).json({ error: 'Indica data e orario.' });
  const validCadence = ['once', 'weekly', 'biweekly', 'monthly'].includes(cadence) ? cadence : 'once';
  const info = db.prepare(`
    INSERT INTO review_slots (patient_id, therapist_id, slot_date, slot_time, cadence, status, proposed_by)
    VALUES (?, ?, ?, ?, ?, 'proposed', 'therapist')
  `).run(pair.patientId, pair.therapistId, date, time, validCadence);
  const slot = db.prepare('SELECT * FROM review_slots WHERE id = ?').get(info.lastInsertRowid);
  res.json({ slot });
});

router.patch('/:id', requireAuth, (req, res) => {
  const pair = resolvePair(req);
  if (!pair) return res.status(403).json({ error: 'Nessun collegamento paziente-terapeuta trovato.' });
  const slot = db.prepare('SELECT * FROM review_slots WHERE id = ? AND patient_id = ? AND therapist_id = ?')
    .get(req.params.id, pair.patientId, pair.therapistId);
  if (!slot) return res.status(404).json({ error: 'Proposta non trovata.' });

  const { status } = req.body || {};
  if (!['confirmed', 'declined', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Stato non valido.' });
  }
  if ((status === 'confirmed' || status === 'declined') && req.user.role !== 'patient') {
    return res.status(403).json({ error: 'Solo il paziente può confermare o rifiutare una proposta.' });
  }
  if ((status === 'confirmed' || status === 'declined') && slot.status !== 'proposed') {
    return res.status(409).json({ error: 'Questa proposta non è più in attesa di risposta.' });
  }
  if (status === 'cancelled' && slot.status === 'declined') {
    return res.status(409).json({ error: 'Questa proposta è già stata rifiutata.' });
  }

  db.prepare('UPDATE review_slots SET status = ? WHERE id = ?').run(status, slot.id);
  res.json({ ok: true });
});

module.exports = router;

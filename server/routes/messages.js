const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware');

const router = express.Router();

// Trova (se esiste) il collegamento paziente-terapeuta rilevante per l'utente
// che sta chiamando l'API, e verifica che abbia il diritto di vederlo.
// Questo è IL punto in cui garantiamo che un paziente non possa mai leggere
// la chat di un altro paziente: la query parte sempre da chi è loggato.
function resolveConversation(req) {
  if (req.user.role === 'patient') {
    const link = db.prepare('SELECT * FROM patient_therapist WHERE patient_id = ? AND status = \'active\'').get(req.user.id);
    if (!link) return null;
    return { patientId: req.user.id, therapistId: link.therapist_id };
  }
  // terapeuta: deve specificare quale paziente, e quel paziente deve essere
  // davvero suo.
  const patientId = Number(req.query.patientId || (req.body && req.body.patientId));
  if (!patientId) return null;
  const link = db.prepare('SELECT * FROM patient_therapist WHERE patient_id = ? AND therapist_id = ? AND status = \'active\'').get(patientId, req.user.id);
  if (!link) return null;
  return { patientId, therapistId: req.user.id };
}

router.get('/', requireAuth, (req, res) => {
  const convo = resolveConversation(req);
  if (!convo) return res.status(403).json({ error: 'Conversazione non disponibile.' });
  const rows = db.prepare('SELECT * FROM messages WHERE patient_id = ? AND therapist_id = ? ORDER BY created_at ASC')
    .all(convo.patientId, convo.therapistId);
  res.json({ messages: rows });
});

router.post('/', requireAuth, (req, res) => {
  const convo = resolveConversation(req);
  if (!convo) return res.status(403).json({ error: 'Conversazione non disponibile.' });
  const body = (req.body && req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Il messaggio non può essere vuoto.' });
  const info = db.prepare('INSERT INTO messages (patient_id, therapist_id, sender_role, body) VALUES (?, ?, ?, ?)')
    .run(convo.patientId, convo.therapistId, req.user.role, body.slice(0, 4000));
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
  res.json({ message: row });
});

module.exports = router;

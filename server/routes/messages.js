const db = require('../db');
const { requireAuth } = require('../middleware');
const { Router } = require('../helpers');

const router = Router();

// Trova (se esiste) il collegamento paziente-terapeuta rilevante per l'utente
// che sta chiamando l'API, e verifica che abbia il diritto di vederlo.
// Questo è IL punto in cui garantiamo che un paziente non possa mai leggere
// la chat di un altro paziente: la query parte sempre da chi è loggato.
async function resolveConversation(req) {
  if (req.user.role === 'patient') {
    const link = await db.get('SELECT * FROM patient_therapist WHERE patient_id = ? AND status = \'active\'', req.user.id);
    if (!link) return null;
    return { patientId: req.user.id, therapistId: link.therapist_id };
  }
  // terapeuta: deve specificare quale paziente, e quel paziente deve essere
  // davvero suo.
  const patientId = Number(req.query.patientId || (req.body && req.body.patientId));
  if (!patientId) return null;
  const link = await db.get('SELECT * FROM patient_therapist WHERE patient_id = ? AND therapist_id = ? AND status = \'active\'', patientId, req.user.id);
  if (!link) return null;
  return { patientId, therapistId: req.user.id };
}

router.get('/', requireAuth, async (req, res) => {
  const convo = await resolveConversation(req);
  if (!convo) return res.status(403).json({ error: 'Conversazione non disponibile.' });
  const rows = await db.all('SELECT * FROM messages WHERE patient_id = ? AND therapist_id = ? ORDER BY created_at ASC, id ASC', convo.patientId, convo.therapistId);
  res.json({ messages: rows });
});

router.post('/', requireAuth, async (req, res) => {
  const convo = await resolveConversation(req);
  if (!convo) return res.status(403).json({ error: 'Conversazione non disponibile.' });
  const body = (req.body && req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Il messaggio non può essere vuoto.' });
  const row = await db.get('INSERT INTO messages (patient_id, therapist_id, sender_role, body) VALUES (?, ?, ?, ?) RETURNING *', convo.patientId, convo.therapistId, req.user.role, body.slice(0, 4000));
  res.json({ message: row });
});

module.exports = router;

const db = require('../db');
const { requireAuth, requireRole } = require('../middleware');
const { Router } = require('../helpers');
const { sendMail } = require('../mailer');

const router = Router();

// Stesso pattern di isolamento usato per i messaggi: la coppia
// paziente/terapeuta rilevante si ricava sempre da chi è loggato, mai da un
// id passato liberamente dal client.
async function resolvePair(req) {
  if (req.user.role === 'patient') {
    const link = await db.get('SELECT * FROM patient_therapist WHERE patient_id = ? AND status = \'active\'', req.user.id);
    if (!link) return null;
    return { patientId: req.user.id, therapistId: link.therapist_id };
  }
  const patientId = Number(req.query.patientId || (req.body && req.body.patientId));
  if (!patientId) return null;
  const link = await db.get('SELECT * FROM patient_therapist WHERE patient_id = ? AND therapist_id = ? AND status = \'active\'', patientId, req.user.id);
  if (!link) return null;
  return { patientId, therapistId: req.user.id };
}

router.get('/', requireAuth, async (req, res) => {
  const pair = await resolvePair(req);
  if (!pair) return res.status(403).json({ error: 'Nessun collegamento paziente-tutor trovato.' });
  const slots = await db.all(`
    SELECT * FROM review_slots WHERE patient_id = ? AND therapist_id = ?
    ORDER BY slot_date ASC, slot_time ASC
  `, pair.patientId, pair.therapistId);
  res.json({ slots });
});

// Richiesta di revisione: l'utente la invia al proprio tutor, che la vede nel
// profilo di quell'utente e risponde proponendo data e ora.
router.get('/request', requireAuth, async (req, res) => {
  const pair = await resolvePair(req);
  if (!pair) return res.status(403).json({ error: 'Nessun collegamento paziente-tutor trovato.' });
  const request = await db.get('SELECT * FROM review_requests WHERE patient_id = ? AND therapist_id = ?', pair.patientId, pair.therapistId);
  res.json({ request: request || null });
});

router.post('/request', requireAuth, requireRole('patient'), async (req, res) => {
  const pair = await resolvePair(req);
  if (!pair) return res.status(403).json({ error: 'Per chiedere una revisione devi essere collegato a un tutor.' });
  const existing = await db.get('SELECT * FROM review_requests WHERE patient_id = ?', pair.patientId);
  if (existing) return res.status(409).json({ error: 'Hai già inviato una richiesta: il tutor la vedrà a breve.' });
  await db.run('INSERT INTO review_requests (patient_id, therapist_id) VALUES (?, ?)', pair.patientId, pair.therapistId);
  const request = await db.get('SELECT * FROM review_requests WHERE patient_id = ?', pair.patientId);
  // Avvisiamo il tutor anche via email.
  const tutor = await db.get('SELECT name, email FROM users WHERE id = ?', pair.therapistId);
  if (tutor && tutor.email) {
    sendMail({
      to: tutor.email,
      subject: 'Richiesta di revisione su ADHD Coach',
      text: `Ciao ${tutor.name}, ${req.user.nickname || req.user.name} ha chiesto una revisione.\n\nAccedi all'app, apri il profilo dell'utente e proponi una data e un orario.`,
    });
  }
  res.json({ request });
});

router.delete('/request', requireAuth, requireRole('patient'), async (req, res) => {
  await db.run('DELETE FROM review_requests WHERE patient_id = ?', req.user.id);
  res.json({ ok: true });
});

// Solo il terapeuta propone un orario (deciso insieme a Barbara): il
// paziente potrà solo confermare o rifiutare quanto proposto.
router.post('/', requireAuth, requireRole('therapist'), async (req, res) => {
  const pair = await resolvePair(req);
  if (!pair) return res.status(403).json({ error: 'Utente non collegato al tuo account.' });
  const { date, time, cadence } = req.body || {};
  if (!date || !time) return res.status(400).json({ error: 'Indica data e orario.' });
  const validCadence = ['once', 'weekly', 'biweekly', 'monthly'].includes(cadence) ? cadence : 'once';
  // Proposta + chiusura della richiesta del paziente (se c'era): o entrambe o nessuna.
  const slot = await db.tx(async tx => {
    const created = await tx.get(`
      INSERT INTO review_slots (patient_id, therapist_id, slot_date, slot_time, cadence, status, proposed_by)
      VALUES (?, ?, ?, ?, ?, 'proposed', 'therapist') RETURNING *
    `, pair.patientId, pair.therapistId, date, time, validCadence);
    await tx.run('DELETE FROM review_requests WHERE patient_id = ?', pair.patientId);
    return created;
  });
  res.json({ slot });
});

router.patch('/:id', requireAuth, async (req, res) => {
  const pair = await resolvePair(req);
  if (!pair) return res.status(403).json({ error: 'Nessun collegamento paziente-tutor trovato.' });
  const slot = await db.get('SELECT * FROM review_slots WHERE id = ? AND patient_id = ? AND therapist_id = ?', req.params.id, pair.patientId, pair.therapistId);
  if (!slot) return res.status(404).json({ error: 'Proposta non trovata.' });

  const { status } = req.body || {};
  if (!['confirmed', 'declined', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Stato non valido.' });
  }
  if ((status === 'confirmed' || status === 'declined') && req.user.role !== 'patient') {
    return res.status(403).json({ error: 'Solo l\'utente può confermare o rifiutare una proposta.' });
  }
  if ((status === 'confirmed' || status === 'declined') && slot.status !== 'proposed') {
    return res.status(409).json({ error: 'Questa proposta non è più in attesa di risposta.' });
  }
  if (status === 'cancelled' && slot.status === 'declined') {
    return res.status(409).json({ error: 'Questa proposta è già stata rifiutata.' });
  }

  await db.run('UPDATE review_slots SET status = ? WHERE id = ?', status, slot.id);
  res.json({ ok: true });
});

module.exports = router;

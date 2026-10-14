const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware');
const { generateLinkCode } = require('../helpers');
const { sendMail } = require('../mailer');

const router = express.Router();

// Il terapeuta genera (o rigenera) il proprio codice da condividere con un
// paziente che vuole collegarsi direttamente a lui/lei, senza passare
// dall'elenco o dall'assegnazione casuale.
router.post('/code', requireAuth, requireRole('therapist'), (req, res) => {
  const code = generateLinkCode(db);
  db.prepare('UPDATE users SET link_code = ? WHERE id = ?').run(code, req.user.id);
  res.json({ code });
});

// Elenco terapeuti disponibili (per la schermata di scelta del paziente).
// Non esponiamo email/bio sensibili oltre a quanto il terapeuta ha scelto di
// mostrare pubblicamente (nome, avatar, specializzazione, bio).
router.get('/', requireAuth, requireRole('patient'), (req, res) => {
  const therapists = db.prepare(`
    SELECT u.id, u.name, u.avatar, u.avatar_photo, u.specialty, u.bio,
      (SELECT COUNT(*) FROM patient_therapist pt WHERE pt.therapist_id = u.id AND pt.status = 'active') as patients_count
    FROM users u WHERE u.role = 'therapist'
    ORDER BY patients_count ASC, u.name ASC
  `).all();
  res.json({ therapists });
});

// Un paziente può avere una sola riga in patient_therapist (colonna UNIQUE),
// che sia in attesa di conferma o già attiva: in entrambi i casi non deve
// poter inviare un'altra richiesta finché quella corrente non viene rifiutata
// o annullata.
function existingRequest(patientId) {
  return db.prepare('SELECT * FROM patient_therapist WHERE patient_id = ?').get(patientId);
}

// Il paziente invia una richiesta di collegamento: NON crea subito il
// collegamento, resta "in attesa" finché il terapeuta non la accetta dalla
// sua pagina (vedi le rotte /requests qui sotto).
router.post('/pair', requireAuth, requireRole('patient'), (req, res) => {
  const existing = existingRequest(req.user.id);
  if (existing) {
    return res.status(409).json({
      error: existing.status === 'active' ? 'Sei già collegato a un tutor.' : 'Hai già una richiesta in attesa di conferma.',
    });
  }
  const { therapistId, random, code } = req.body || {};
  let therapist;
  if (code) {
    // Collegamento diretto tramite il codice condiviso dal terapeuta.
    therapist = db.prepare('SELECT id FROM users WHERE link_code = ? AND role = \'therapist\'').get(code.toUpperCase().trim());
    if (!therapist) return res.status(404).json({ error: 'Codice non valido. Chiedi al tuo tutor di generarne uno nuovo dal suo profilo.' });
  } else if (random) {
    // Assegnazione casuale: prendiamo il terapeuta con meno pazienti collegati
    // (evita di sovraccaricare sempre lo stesso), e tra i pari scegliamo a caso.
    const candidates = db.prepare(`
      SELECT u.id, (SELECT COUNT(*) FROM patient_therapist pt WHERE pt.therapist_id = u.id AND pt.status = 'active') as c
      FROM users u WHERE u.role = 'therapist'
    `).all();
    if (!candidates.length) return res.status(404).json({ error: 'Nessun tutor disponibile al momento.' });
    const minC = Math.min(...candidates.map(c => c.c));
    const pool = candidates.filter(c => c.c === minC);
    therapist = pool[Math.floor(Math.random() * pool.length)];
  } else {
    if (!therapistId) return res.status(400).json({ error: 'Indica un tutor, un codice, oppure richiedi l\'assegnazione casuale.' });
    therapist = db.prepare('SELECT id FROM users WHERE id = ? AND role = \'therapist\'').get(therapistId);
    if (!therapist) return res.status(404).json({ error: 'Tutor non trovato.' });
  }

  db.prepare('INSERT INTO patient_therapist (patient_id, therapist_id, status) VALUES (?, ?, \'pending\')').run(req.user.id, therapist.id);
  const request = db.prepare(`
    SELECT pt.*, u.name as therapist_name, u.avatar as therapist_avatar, u.specialty as therapist_specialty
    FROM patient_therapist pt JOIN users u ON u.id = pt.therapist_id WHERE pt.patient_id = ?
  `).get(req.user.id);
  // Avvisiamo il tutor anche via email (oltre all'avviso dentro l'app).
  const tutor = db.prepare('SELECT name, email FROM users WHERE id = ?').get(therapist.id);
  if (tutor) {
    sendMail({
      to: tutor.email,
      subject: 'Nuova richiesta di collegamento su ADHD Coach',
      text: `Ciao ${tutor.name}, ${req.user.nickname || req.user.name} ha chiesto di collegarsi a te su ADHD Coach.\n\nAccedi all'app e, nella tua dashboard, trovi la richiesta in attesa da accettare o rifiutare.`,
    });
  }
  res.json({ request });
});

// Il paziente annulla la propria richiesta in attesa (non ancora accettata),
// per poterne inviare una nuova a un tutor diverso.
router.delete('/pair', requireAuth, requireRole('patient'), (req, res) => {
  const existing = existingRequest(req.user.id);
  if (!existing || existing.status !== 'pending') {
    return res.status(404).json({ error: 'Nessuna richiesta in attesa da annullare.' });
  }
  db.prepare('DELETE FROM patient_therapist WHERE id = ?').run(existing.id);
  res.json({ ok: true });
});

// Lista pazienti del terapeuta loggato, con un riassunto sintetico (usato in
// stats.js per il vero calcolo, qui restiamo solo sull'anagrafica di base).
// Solo i collegamenti già accettati (status = 'active') contano come pazienti
// in carico: quelli in attesa vivono nella sezione "Richieste in attesa".
router.get('/patients', requireAuth, requireRole('therapist'), (req, res) => {
  const patients = db.prepare(`
    SELECT u.id, u.name, u.nickname, u.avatar, u.age_group, u.email, u.birth_date, u.phone, pt.created_at as linked_since
    FROM patient_therapist pt JOIN users u ON u.id = pt.patient_id
    WHERE pt.therapist_id = ? AND pt.status = 'active'
    ORDER BY u.name ASC
  `).all(req.user.id);
  res.json({ patients });
});

// Richieste di collegamento in attesa di conferma per questo terapeuta.
// Includiamo anche gli obiettivi scelti dall'utente in fase di iscrizione,
// così il tutor capisce subito cosa si aspetta dall'app prima di accettare.
router.get('/requests', requireAuth, requireRole('therapist'), (req, res) => {
  const requests = db.prepare(`
    SELECT pt.id, pt.created_at, u.id as patient_id, u.name, u.nickname, u.avatar, u.age_group, u.goals, u.email, u.birth_date, u.phone
    FROM patient_therapist pt JOIN users u ON u.id = pt.patient_id
    WHERE pt.therapist_id = ? AND pt.status = 'pending'
    ORDER BY pt.created_at ASC
  `).all(req.user.id);
  requests.forEach(r => { r.goals = r.goals ? r.goals.split(',').filter(Boolean) : []; });
  res.json({ requests });
});

function ownedPendingRequest(id, therapistId) {
  return db.prepare('SELECT * FROM patient_therapist WHERE id = ? AND therapist_id = ? AND status = \'pending\'').get(id, therapistId);
}

// Il terapeuta accetta: solo da questo momento il collegamento è davvero
// attivo (l'utente lo vedrà comparire al suo prossimo accesso all'app).
router.post('/requests/:id/accept', requireAuth, requireRole('therapist'), (req, res) => {
  const request = ownedPendingRequest(req.params.id, req.user.id);
  if (!request) return res.status(404).json({ error: 'Richiesta non trovata.' });
  db.prepare('UPDATE patient_therapist SET status = \'active\' WHERE id = ?').run(request.id);
  res.json({ ok: true });
});

// Il terapeuta rifiuta: la riga viene rimossa così l'utente può richiedere
// un collegamento con un altro tutor.
router.post('/requests/:id/decline', requireAuth, requireRole('therapist'), (req, res) => {
  const request = ownedPendingRequest(req.params.id, req.user.id);
  if (!request) return res.status(404).json({ error: 'Richiesta non trovata.' });
  db.prepare('DELETE FROM patient_therapist WHERE id = ?').run(request.id);
  res.json({ ok: true });
});

function ownedActivePatient(therapistId, patientId) {
  return db.prepare('SELECT * FROM patient_therapist WHERE therapist_id = ? AND patient_id = ? AND status = \'active\'').get(therapistId, patientId);
}

// Per gli utenti minorenni il codice per collegare un genitore non compare
// più nel loro profilo: lo gestisce il tutor da qui, e lo condivide
// direttamente con la famiglia (lo stesso codice va bene per entrambi i
// genitori, fino a due).
router.get('/patients/:id/family-code', requireAuth, requireRole('therapist'), (req, res) => {
  const link = ownedActivePatient(req.user.id, Number(req.params.id));
  if (!link) return res.status(404).json({ error: 'Utente non trovato tra i tuoi collegamenti.' });
  const patient = db.prepare('SELECT link_code FROM users WHERE id = ?').get(req.params.id);
  res.json({ code: (patient && patient.link_code) || null });
});

router.post('/patients/:id/family-code', requireAuth, requireRole('therapist'), (req, res) => {
  const link = ownedActivePatient(req.user.id, Number(req.params.id));
  if (!link) return res.status(404).json({ error: 'Utente non trovato tra i tuoi collegamenti.' });
  const code = generateLinkCode(db);
  db.prepare('UPDATE users SET link_code = ? WHERE id = ?').run(code, req.params.id);
  res.json({ code });
});

module.exports = router;

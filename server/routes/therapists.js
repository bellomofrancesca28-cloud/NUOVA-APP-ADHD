const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware');
const { generateLinkCode } = require('../helpers');

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
    SELECT u.id, u.name, u.avatar, u.specialty, u.bio,
      (SELECT COUNT(*) FROM patient_therapist pt WHERE pt.therapist_id = u.id) as patients_count
    FROM users u WHERE u.role = 'therapist'
    ORDER BY patients_count ASC, u.name ASC
  `).all();
  res.json({ therapists });
});

function alreadyPaired(patientId) {
  return db.prepare('SELECT * FROM patient_therapist WHERE patient_id = ?').get(patientId);
}

router.post('/pair', requireAuth, requireRole('patient'), (req, res) => {
  if (alreadyPaired(req.user.id)) {
    return res.status(409).json({ error: 'Sei già collegato a un terapeuta.' });
  }
  const { therapistId, random, code } = req.body || {};
  let therapist;
  if (code) {
    // Collegamento diretto tramite il codice condiviso dal terapeuta.
    therapist = db.prepare('SELECT id FROM users WHERE link_code = ? AND role = \'therapist\'').get(code.toUpperCase().trim());
    if (!therapist) return res.status(404).json({ error: 'Codice non valido. Chiedi al tuo terapeuta di generarne uno nuovo dal suo profilo.' });
  } else if (random) {
    // Assegnazione casuale: prendiamo il terapeuta con meno pazienti collegati
    // (evita di sovraccaricare sempre lo stesso), e tra i pari scegliamo a caso.
    const candidates = db.prepare(`
      SELECT u.id, (SELECT COUNT(*) FROM patient_therapist pt WHERE pt.therapist_id = u.id) as c
      FROM users u WHERE u.role = 'therapist'
    `).all();
    if (!candidates.length) return res.status(404).json({ error: 'Nessun terapeuta disponibile al momento.' });
    const minC = Math.min(...candidates.map(c => c.c));
    const pool = candidates.filter(c => c.c === minC);
    therapist = pool[Math.floor(Math.random() * pool.length)];
  } else {
    if (!therapistId) return res.status(400).json({ error: 'Indica un terapeuta, un codice, oppure richiedi l\'assegnazione casuale.' });
    therapist = db.prepare('SELECT id FROM users WHERE id = ? AND role = \'therapist\'').get(therapistId);
    if (!therapist) return res.status(404).json({ error: 'Terapeuta non trovato.' });
  }

  db.prepare('INSERT INTO patient_therapist (patient_id, therapist_id) VALUES (?, ?)').run(req.user.id, therapist.id);
  const link = db.prepare(`
    SELECT pt.*, u.name as therapist_name, u.avatar as therapist_avatar, u.specialty as therapist_specialty
    FROM patient_therapist pt JOIN users u ON u.id = pt.therapist_id WHERE pt.patient_id = ?
  `).get(req.user.id);
  res.json({ therapistLink: link });
});

// Lista pazienti del terapeuta loggato, con un riassunto sintetico (usato in
// stats.js per il vero calcolo, qui restiamo solo sull'anagrafica di base).
router.get('/patients', requireAuth, requireRole('therapist'), (req, res) => {
  const patients = db.prepare(`
    SELECT u.id, u.name, u.nickname, u.avatar, u.age_group, pt.created_at as linked_since
    FROM patient_therapist pt JOIN users u ON u.id = pt.patient_id
    WHERE pt.therapist_id = ?
    ORDER BY u.name ASC
  `).all(req.user.id);
  res.json({ patients });
});

module.exports = router;

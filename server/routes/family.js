// family.js — collegamento genitore <-> figlio/a minorenne.
// Stesso principio del collegamento paziente-terapeuta: il paziente (qui,
// potenzialmente minorenne) genera un codice, il genitore lo inserisce una
// sola volta e da quel momento può vedere i dati condivisi di quel figlio/a.
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware');
const { publicUser, todayStr, generateLinkCode } = require('../helpers');
const stats = require('../stats-engine');

const router = express.Router();

// Il paziente genera (o rigenera) il proprio codice da condividere con un genitore.
router.post('/code', requireAuth, requireRole('patient'), (req, res) => {
  const code = generateLinkCode(db);
  db.prepare('UPDATE users SET link_code = ? WHERE id = ?').run(code, req.user.id);
  res.json({ code });
});

// Il genitore collega il proprio account inserendo il codice del figlio/a.
router.post('/link', requireAuth, requireRole('parent'), (req, res) => {
  const code = ((req.body && req.body.code) || '').toUpperCase().trim();
  if (!code) return res.status(400).json({ error: 'Inserisci il codice.' });

  const child = db.prepare('SELECT * FROM users WHERE link_code = ? AND role = \'patient\'').get(code);
  if (!child) return res.status(404).json({ error: 'Codice non valido. Chiedi a tuo figlio/a di generarne uno nuovo dal suo profilo.' });

  const already = db.prepare('SELECT * FROM parent_child WHERE child_id = ?').get(child.id);
  if (already) return res.status(409).json({ error: 'Questo account è già collegato a un genitore.' });

  db.prepare('INSERT INTO parent_child (parent_id, child_id) VALUES (?, ?)').run(req.user.id, child.id);
  res.json({ child: publicUser(child) });
});

// Elenco figli collegati al genitore loggato.
router.get('/children', requireAuth, requireRole('parent'), (req, res) => {
  const children = db.prepare(`
    SELECT u.id, u.name, u.nickname, u.avatar, u.age_group
    FROM parent_child pc JOIN users u ON u.id = pc.child_id
    WHERE pc.parent_id = ?
    ORDER BY u.name ASC
  `).all(req.user.id);
  res.json({ children });
});

function ownsChild(parentId, childId) {
  return db.prepare('SELECT * FROM parent_child WHERE parent_id = ? AND child_id = ?').get(parentId, childId);
}

// Vista completa (in sola lettura) di un figlio/a collegato: agenda di oggi,
// check-in recenti, statistiche e — su richiesta esplicita della famiglia —
// anche le note scambiate col terapeuta.
router.get('/children/:id/overview', requireAuth, requireRole('parent'), (req, res) => {
  const childId = Number(req.params.id);
  if (!ownsChild(req.user.id, childId)) {
    return res.status(403).json({ error: 'Non sei collegato a questo account.' });
  }
  const child = db.prepare('SELECT * FROM users WHERE id = ?').get(childId);
  if (!child) return res.status(404).json({ error: 'Account non trovato.' });

  const today = todayStr();
  const agenda = db.prepare('SELECT * FROM agenda_items WHERE user_id = ? AND item_date = ? ORDER BY time ASC').all(childId, today);
  const checkins = db.prepare('SELECT * FROM checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT 10').all(childId);
  const summary = stats.fullSummary(child);

  const therapistLink = db.prepare(`
    SELECT pt.*, u.name as therapist_name, u.avatar as therapist_avatar
    FROM patient_therapist pt JOIN users u ON u.id = pt.therapist_id
    WHERE pt.patient_id = ?
  `).get(childId);
  const messages = therapistLink
    ? db.prepare('SELECT * FROM messages WHERE patient_id = ? ORDER BY created_at ASC').all(childId)
    : [];

  res.json({
    child: { id: child.id, name: child.name, nickname: child.nickname, avatar: child.avatar, age_group: child.age_group },
    agenda,
    checkins,
    summary,
    therapistLink: therapistLink || null,
    messages,
  });
});

module.exports = router;

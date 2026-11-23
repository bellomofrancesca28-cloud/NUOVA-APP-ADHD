// family.js — collegamento genitore <-> figlio/a minorenne.
// Stesso principio del collegamento paziente-terapeuta: il paziente (qui,
// potenzialmente minorenne) genera un codice, il genitore lo inserisce una
// sola volta e da quel momento può vedere i dati condivisi di quel figlio/a.
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware');
const { publicUser, todayStr, generateLinkCode, Router } = require('../helpers');
const stats = require('../stats-engine');
const { computeStars } = require('../stars');

const router = Router();

// Il paziente genera (o rigenera) il proprio codice da condividere con un genitore.
router.post('/code', requireAuth, requireRole('patient'), async (req, res) => {
  const code = await generateLinkCode(db);
  await db.run('UPDATE users SET link_code = ? WHERE id = ?', code, req.user.id);
  res.json({ code });
});

// Il genitore collega il proprio account inserendo il codice del figlio/a.
// Il figlio/a può condividere lo stesso codice con entrambi i genitori
// (il codice non viene consumato al primo utilizzo): fino a due genitori
// possono collegarsi allo stesso account.
const MAX_PARENTS_PER_CHILD = 2;

router.post('/link', requireAuth, requireRole('parent'), async (req, res) => {
  const code = ((req.body && req.body.code) || '').toUpperCase().trim();
  if (!code) return res.status(400).json({ error: 'Inserisci il codice.' });

  const child = await db.get('SELECT * FROM users WHERE link_code = ? AND role = \'patient\'', code);
  if (!child) return res.status(404).json({ error: 'Codice non valido. Chiedi al tutor che segue tuo figlio/a di darti il codice corretto.' });

  const alreadyMe = await db.get('SELECT * FROM parent_child WHERE parent_id = ? AND child_id = ?', req.user.id, child.id);
  if (alreadyMe) return res.status(409).json({ error: 'Sei già collegato a questo account.' });

  const parentsCount = (await db.get('SELECT COUNT(*) as c FROM parent_child WHERE child_id = ?', child.id)).c;
  if (parentsCount >= MAX_PARENTS_PER_CHILD) {
    return res.status(409).json({ error: 'Questo account è già collegato al numero massimo di genitori.' });
  }

  await db.run('INSERT INTO parent_child (parent_id, child_id) VALUES (?, ?)', req.user.id, child.id);
  res.json({ child: publicUser(child) });
});

// Elenco figli collegati al genitore loggato.
router.get('/children', requireAuth, requireRole('parent'), async (req, res) => {
  const children = await db.all(`
    SELECT u.id, u.name, u.nickname, u.avatar, u.age_group
    FROM parent_child pc JOIN users u ON u.id = pc.child_id
    WHERE pc.parent_id = ?
    ORDER BY u.name ASC
  `, req.user.id);
  res.json({ children });
});

async function ownsChild(parentId, childId) {
  return db.get('SELECT * FROM parent_child WHERE parent_id = ? AND child_id = ?', parentId, childId);
}

// Vista completa (in sola lettura) di un figlio/a collegato: agenda di oggi,
// check-in recenti, statistiche e stelle. Le note scritte al tutor restano private.
router.get('/children/:id/overview', requireAuth, requireRole('parent'), async (req, res) => {
  const childId = Number(req.params.id);
  if (!await ownsChild(req.user.id, childId)) {
    return res.status(403).json({ error: 'Non sei collegato a questo account.' });
  }
  const child = await db.get('SELECT * FROM users WHERE id = ?', childId);
  if (!child) return res.status(404).json({ error: 'Account non trovato.' });

  const today = todayStr();
  const agenda = await db.all('SELECT * FROM agenda_items WHERE user_id = ? AND item_date = ? ORDER BY time ASC', childId, today);
  const checkins = await db.all('SELECT * FROM checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT 10', childId);
  const summary = await stats.fullSummary(child);

  const therapistLink = await db.get(`
    SELECT pt.*, u.name as therapist_name, u.avatar as therapist_avatar, u.avatar_photo as therapist_photo,
           u.specialty as therapist_specialty, u.bio as therapist_bio, u.order_number as therapist_order_number, u.email as therapist_email
    FROM patient_therapist pt JOIN users u ON u.id = pt.therapist_id
    WHERE pt.patient_id = ? AND pt.status = 'active'
  `, childId);

  res.json({
    child: { id: child.id, name: child.name, nickname: child.nickname, avatar: child.avatar, age_group: child.age_group },
    agenda,
    checkins,
    summary,
    stars: await computeStars(childId),
    therapistLink: therapistLink || null,
  });
});

module.exports = router;

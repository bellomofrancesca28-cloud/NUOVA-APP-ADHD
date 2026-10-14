const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware');
const { CATEGORY_SETS, todayStr } = require('../helpers');
const { computeStars } = require('../stars');

const router = express.Router();

function loadItemsWithSteps(userId, date) {
  const items = db.prepare('SELECT * FROM agenda_items WHERE user_id = ? AND item_date = ? ORDER BY time ASC').all(userId, date);
  const stepsStmt = db.prepare('SELECT * FROM agenda_steps WHERE agenda_item_id = ? ORDER BY position ASC, id ASC');
  return items.map(item => ({ ...item, steps: stepsStmt.all(item.id) }));
}

// Verifica che l'elemento agenda appartenga davvero all'utente che lo richiede.
// Senza questo controllo, un paziente potrebbe modificare/cancellare le voci di
// un altro paziente semplicemente indovinando un id numerico nell'URL.
function getOwnedItem(id, userId) {
  return db.prepare('SELECT * FROM agenda_items WHERE id = ? AND user_id = ?').get(id, userId);
}

router.get('/', requireAuth, requireRole('patient'), (req, res) => {
  const date = req.query.date || todayStr();
  res.json({ date, items: loadItemsWithSteps(req.user.id, date), categories: CATEGORY_SETS[req.user.age_group] });
});

// Riepilogo di un mese intero (quanti impegni per ciascun giorno): usato per
// mostrare un puntino sui giorni "pieni" nella vista Calendario, senza dover
// scaricare ogni singola voce di ogni giorno solo per sapere se ce ne sono.
router.get('/month', requireAuth, requireRole('patient'), (req, res) => {
  const year = parseInt(req.query.year, 10);
  const month = parseInt(req.query.month, 10); // 1-12
  if (!year || !month) return res.status(400).json({ error: 'Indica anno e mese.' });
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const rows = db.prepare(`
    SELECT item_date, COUNT(*) as count, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as done
    FROM agenda_items WHERE user_id = ? AND item_date LIKE ?
    GROUP BY item_date
  `).all(req.user.id, `${prefix}-%`);
  res.json({ days: rows });
});

// Stelle: ogni giorno in cui l'utente ha almeno un'attività e le ha completate
// tutte vale una stella. Non c'è una tabella dedicata: la stella si calcola
// dalle attività (se una viene riaperta, la stella di quel giorno sparisce).
router.get('/stars', requireAuth, requireRole('patient'), (req, res) => {
  res.json(computeStars(req.user.id));
});

router.post('/', requireAuth, requireRole('patient'), (req, res) => {
  const { date, time, title, category } = req.body || {};
  const validCats = CATEGORY_SETS[req.user.age_group];
  if (!title || !title.trim()) return res.status(400).json({ error: 'Serve un titolo per l\'attività.' });
  if (!validCats.includes(category)) return res.status(400).json({ error: 'Categoria non valida.' });
  const info = db.prepare(`
    INSERT INTO agenda_items (user_id, item_date, time, title, category, status)
    VALUES (?, ?, ?, ?, ?, 'todo')
  `).run(req.user.id, date || todayStr(), time || '12:00', title.trim(), category);
  const item = db.prepare('SELECT * FROM agenda_items WHERE id = ?').get(info.lastInsertRowid);
  res.json({ item: { ...item, steps: [] } });
});

router.patch('/:id', requireAuth, requireRole('patient'), (req, res) => {
  const item = getOwnedItem(req.params.id, req.user.id);
  if (!item) return res.status(404).json({ error: 'Attività non trovata.' });
  const { status } = req.body || {};
  if (!['todo', 'active', 'done'].includes(status)) return res.status(400).json({ error: 'Stato non valido.' });
  db.prepare('UPDATE agenda_items SET status = ? WHERE id = ?').run(status, item.id);
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, requireRole('patient'), (req, res) => {
  const item = getOwnedItem(req.params.id, req.user.id);
  if (!item) return res.status(404).json({ error: 'Attività non trovata.' });
  db.prepare('DELETE FROM agenda_items WHERE id = ?').run(item.id);
  res.json({ ok: true });
});

router.post('/:id/steps', requireAuth, requireRole('patient'), (req, res) => {
  const item = getOwnedItem(req.params.id, req.user.id);
  if (!item) return res.status(404).json({ error: 'Attività non trovata.' });
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Il passo non può essere vuoto.' });
  const posRow = db.prepare('SELECT COALESCE(MAX(position), -1) as m FROM agenda_steps WHERE agenda_item_id = ?').get(item.id);
  const info = db.prepare('INSERT INTO agenda_steps (agenda_item_id, text, position) VALUES (?, ?, ?)').run(item.id, text.trim(), posRow.m + 1);
  const step = db.prepare('SELECT * FROM agenda_steps WHERE id = ?').get(info.lastInsertRowid);
  res.json({ step });
});

router.patch('/:id/steps/:stepId', requireAuth, requireRole('patient'), (req, res) => {
  const item = getOwnedItem(req.params.id, req.user.id);
  if (!item) return res.status(404).json({ error: 'Attività non trovata.' });
  const step = db.prepare('SELECT * FROM agenda_steps WHERE id = ? AND agenda_item_id = ?').get(req.params.stepId, item.id);
  if (!step) return res.status(404).json({ error: 'Passo non trovato.' });
  const done = req.body && typeof req.body.done === 'boolean' ? (req.body.done ? 1 : 0) : (step.done ? 0 : 1);
  db.prepare('UPDATE agenda_steps SET done = ? WHERE id = ?').run(done, step.id);
  res.json({ ok: true });
});

router.delete('/:id/steps/:stepId', requireAuth, requireRole('patient'), (req, res) => {
  const item = getOwnedItem(req.params.id, req.user.id);
  if (!item) return res.status(404).json({ error: 'Attività non trovata.' });
  db.prepare('DELETE FROM agenda_steps WHERE id = ? AND agenda_item_id = ?').run(req.params.stepId, item.id);
  res.json({ ok: true });
});

// ===== Stato del giorno (slider energia/focus/stress/sonno) =====
router.get('/state/today', requireAuth, requireRole('patient'), (req, res) => {
  const date = req.query.date || todayStr();
  const state = db.prepare('SELECT * FROM daily_state WHERE user_id = ? AND date = ?').get(req.user.id, date);
  res.json({ state: state || { energy: 50, focus: 50, stress: 50, sleep: 50 } });
});

router.put('/state/today', requireAuth, requireRole('patient'), (req, res) => {
  const date = req.body.date || todayStr();
  const { energy, focus, stress, sleep } = req.body || {};
  db.prepare(`
    INSERT INTO daily_state (user_id, date, energy, focus, stress, sleep, updated_at)
    VALUES (@userId, @date, @energy, @focus, @stress, @sleep, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, date) DO UPDATE SET energy=@energy, focus=@focus, stress=@stress, sleep=@sleep, updated_at=CURRENT_TIMESTAMP
  `).run({ userId: req.user.id, date, energy, focus, stress, sleep });
  res.json({ ok: true });
});

module.exports = router;

const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware');
const coach = require('../coach-engine');

const router = express.Router();

router.post('/ask', requireAuth, requireRole('patient'), (req, res) => {
  const { message, area, energy } = req.body || {};
  if (!message || !message.trim()) return res.status(400).json({ error: 'Scrivi un messaggio per il coach.' });

  // Determiniamo la categoria reale PRIMA di generare la risposta, cosi' il
  // conteggio "quante volte ha già chiesto aiuto su questo tema" (usato solo
  // per far ruotare le varianti di risposta) è corretto sia quando l'utente
  // sceglie l'area a mano sia quando la lasciamo rilevare automaticamente.
  const normalized = coach.normalize(message);
  const resolvedCategory = (coach.CRISIS_RX.test(normalized) || coach.CLINICAL_RX.test(normalized))
    ? null
    : coach.inferCategory(normalized, area);

  const priorForCategory = resolvedCategory
    ? db.prepare('SELECT COUNT(*) as c FROM coach_logs WHERE user_id = ? AND category = ?').get(req.user.id, resolvedCategory).c
    : 0;

  const result = coach.respond({ message, area: resolvedCategory || area, energy, usageCount: priorForCategory });

  // Salviamo solo categoria ed esito (bloccato o no), MAI il testo scritto
  // dal paziente: è il modo in cui teniamo la conversazione col coach privata
  // anche dal terapeuta, mostrando eventualmente solo "quante volte" e "che
  // tipo" di aiuto è stato chiesto, non il contenuto.
  db.prepare('INSERT INTO coach_logs (user_id, category, blocked) VALUES (?, ?, ?)')
    .run(req.user.id, result.category, result.blocked ? 1 : 0);

  res.json(result);
});

module.exports = router;

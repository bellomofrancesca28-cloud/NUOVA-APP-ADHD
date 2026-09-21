const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware');
const stats = require('../stats-engine');
const { todayStr } = require('../helpers');

const router = express.Router();

router.get('/summary', requireAuth, requireRole('patient'), (req, res) => {
  res.json(stats.fullSummary(req.user));
});

// Pagina "Statistiche": oggi / settimana / mese, ciascuno con percentuale
// complessiva e distribuzione per categoria, calcolati sui dati reali.
router.get('/detailed', requireAuth, requireRole('patient'), (req, res) => {
  const user = req.user;
  const today = todayStr();

  const week = stats.weekHistory(user.id);
  const monthBuckets = stats.weeklyBuckets(user.id, 5);

  res.json({
    day: {
      pct: stats.dayCompletionPct(user.id, today),
      categoryBreakdown: stats.categoryBreakdownRange(user.id, user.age_group, 1),
    },
    week: {
      days: week,
      avgPct: stats.overallAvg(week.map(d => d.pct)),
      categoryBreakdown: stats.categoryBreakdownRange(user.id, user.age_group, 7),
    },
    month: {
      buckets: monthBuckets,
      avgPct: stats.overallAvg(monthBuckets.map(b => b.pct)),
      categoryBreakdown: stats.categoryBreakdownRange(user.id, user.age_group, 30),
    },
  });
});

// Vista terapeuta su UN paziente specifico: prima verifichiamo che quel
// paziente sia davvero collegato a questo terapeuta (isolamento dei dati).
router.get('/patient/:patientId', requireAuth, requireRole('therapist'), (req, res) => {
  const link = db.prepare('SELECT * FROM patient_therapist WHERE patient_id = ? AND therapist_id = ?').get(req.params.patientId, req.user.id);
  if (!link) return res.status(403).json({ error: 'Questo utente non è collegato al tuo account.' });
  const patient = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.patientId);
  const summary = stats.fullSummary(patient);
  const trend = stats.checkinTrend(patient.id, 7);
  const moodSeries = trend.map(t => t.mood).filter(v => v !== null);
  // I check-in usano una scala 1-10, le percentuali dell'agenda una scala
  // 0-100: portiamo l'umore in percentuale prima di confrontarlo con la
  // stessa soglia (altrimenti un salto pieno da 1 a 10 conterebbe come "poco").
  const moodAsPct = moodSeries.map(v => Math.round(((v - 1) / 9) * 100));
  const fallbackPct = [summary.week[0].pct, summary.week[6].pct].filter(v => v !== null);
  res.json({
    patient: { id: patient.id, name: patient.name, nickname: patient.nickname, avatar: patient.avatar, age_group: patient.age_group },
    summary,
    checkinTrend: trend,
    moodTrendInfo: stats.trendInfo(moodAsPct.length >= 2 ? moodAsPct : fallbackPct),
  });
});

module.exports = router;

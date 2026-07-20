// stats-engine.js
// Tutta la logica che trasforma le righe grezze del database in numeri e
// percentuali per i grafici. Nel prototipo originale questi numeri erano array
// scritti a mano nel codice; qui vengono ricalcolati ogni volta dai dati reali
// che l'utente ha effettivamente inserito (agenda completata, check-in fatti).
const db = require('./db');
const { CATEGORY_SETS, ROUTINE_CATEGORY, todayStr, daysAgoStr } = require('./helpers');

function dayCompletionPct(userId, date) {
  const rows = db.prepare('SELECT status FROM agenda_items WHERE user_id = ? AND item_date = ?').all(userId, date);
  if (!rows.length) return null; // nessuna attività pianificata quel giorno: non è "0%", è "dato assente"
  const done = rows.filter(r => r.status === 'done').length;
  return Math.round((done / rows.length) * 100);
}

function weekHistory(userId) {
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const date = daysAgoStr(i);
    out.push({ date, pct: dayCompletionPct(userId, date), label: i === 0 ? 'Oggi' : null });
  }
  return out;
}

function streakDays(userId) {
  let streak = 0;
  for (let i = 0; i < 60; i++) {
    const date = daysAgoStr(i);
    const pct = dayCompletionPct(userId, date);
    if (pct && pct > 0) streak++;
    else break;
  }
  return streak;
}

function categoryBreakdown(userId, ageGroup, date) {
  const cats = CATEGORY_SETS[ageGroup];
  return cats.map(cat => {
    const rows = db.prepare('SELECT status FROM agenda_items WHERE user_id = ? AND item_date = ? AND category = ?').all(userId, date, cat);
    const done = rows.filter(r => r.status === 'done').length;
    return { category: cat, done, total: rows.length, pct: rows.length ? Math.round((done / rows.length) * 100) : 0 };
  });
}

function goalRings(userId, ageGroup, date) {
  const routineCat = ROUTINE_CATEGORY[ageGroup];
  const otherCats = CATEGORY_SETS[ageGroup].filter(c => c !== routineCat);
  const routineRows = db.prepare('SELECT status FROM agenda_items WHERE user_id = ? AND item_date = ? AND category = ?').all(userId, date, routineCat);
  const placeholders = otherCats.map(() => '?').join(',');
  const otherRows = otherCats.length
    ? db.prepare(`SELECT status FROM agenda_items WHERE user_id = ? AND item_date = ? AND category IN (${placeholders})`).all(userId, date, ...otherCats)
    : [];
  const pct = (rows) => rows.length ? Math.round(rows.filter(r => r.status === 'done').length / rows.length * 100) : 0;
  return {
    routine: { done: routineRows.filter(r => r.status === 'done').length, total: routineRows.length, pct: pct(routineRows) },
    other: { done: otherRows.filter(r => r.status === 'done').length, total: otherRows.length, pct: pct(otherRows) },
  };
}

// Come categoryBreakdown, ma sommato su più giorni invece che su uno solo:
// usata per i riepiloghi "questa settimana" (7 giorni) e "ultimo mese" (30
// giorni) della pagina Statistiche.
function categoryBreakdownRange(userId, ageGroup, days) {
  const cats = CATEGORY_SETS[ageGroup];
  const dates = [];
  for (let i = 0; i < days; i++) dates.push(daysAgoStr(i));
  const placeholders = dates.map(() => '?').join(',');
  return cats.map(cat => {
    const rows = db.prepare(`SELECT status FROM agenda_items WHERE user_id = ? AND category = ? AND item_date IN (${placeholders})`).all(userId, cat, ...dates);
    const done = rows.filter(r => r.status === 'done').length;
    return { category: cat, done, total: rows.length, pct: rows.length ? Math.round((done / rows.length) * 100) : 0 };
  });
}

// Vista "mese": invece di 30 barre minuscole (poco leggibili), raggruppiamo
// gli ultimi giorni in blocchi di 7 ("questa settimana", "2 settimane fa", ecc.)
// e mostriamo la media di completamento di ciascun blocco.
function weeklyBuckets(userId, weeks) {
  weeks = weeks || 5;
  const buckets = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const pcts = [];
    for (let d = 0; d < 7; d++) {
      const pct = dayCompletionPct(userId, daysAgoStr(w * 7 + d));
      if (pct !== null) pcts.push(pct);
    }
    const avg = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null;
    buckets.push({ label: w === 0 ? 'Questa sett.' : `${w + 1} sett. fa`, pct: avg });
  }
  return buckets;
}

function overallAvg(values) {
  const usable = values.filter(v => v !== null && v !== undefined);
  return usable.length ? Math.round(usable.reduce((a, b) => a + b, 0) / usable.length) : null;
}

function checkinTrend(userId, limit) {
  const rows = db.prepare('SELECT * FROM checkins WHERE user_id = ? ORDER BY created_at ASC').all(userId);
  return rows.slice(-limit);
}

// Confronta il primo e l'ultimo valore utile della serie per stimare se
// l'andamento è in miglioramento, stabile o in calo (soglia presa dal
// prototipo originale: 8 punti percentuali).
function trendInfo(values) {
  const usable = values.filter(v => v !== null && v !== undefined);
  if (usable.length < 2) return { text: 'Dati insufficienti', trend: 'flat', watch: false };
  const diff = usable[usable.length - 1] - usable[0];
  if (diff >= 8) return { text: 'In miglioramento', trend: 'up', watch: false };
  if (diff <= -8) return { text: 'In calo — può valere un contatto', trend: 'down', watch: true };
  return { text: 'Stabile', trend: 'flat', watch: false };
}

function fullSummary(user) {
  const date = todayStr();
  return {
    date,
    week: weekHistory(user.id),
    streak: streakDays(user.id),
    categoryBreakdown: categoryBreakdown(user.id, user.age_group, date),
    goalRings: goalRings(user.id, user.age_group, date),
  };
}

module.exports = {
  dayCompletionPct, weekHistory, streakDays, categoryBreakdown, goalRings,
  checkinTrend, trendInfo, fullSummary, categoryBreakdownRange, weeklyBuckets, overallAvg,
};

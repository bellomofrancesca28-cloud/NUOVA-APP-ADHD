// stats-engine.js
// Tutta la logica che trasforma le righe grezze del database in numeri e
// percentuali per i grafici. Nel prototipo originale questi numeri erano array
// scritti a mano nel codice; qui vengono ricalcolati ogni volta dai dati reali
// che l'utente ha effettivamente inserito (agenda completata, check-in fatti).
//
// Con Postgres il database è in rete: invece di fare una query per ogni
// giorno (fino a 60 per la "streak"), carichiamo in una sola query il totale
// e i completati di ogni giorno del periodo che serve, e calcoliamo da lì.
const db = require('./db');
const { CATEGORY_SETS, ROUTINE_CATEGORY, todayStr, daysAgoStr } = require('./helpers');

const pctOf = (done, total) => Math.round((done / total) * 100);

// Mappa "YYYY-MM-DD" -> { total, done } per gli ultimi `days` giorni (oggi compreso).
async function completionByDay(userId, days) {
  const rows = await db.all(`
    SELECT item_date, COUNT(*) as total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done
    FROM agenda_items WHERE user_id = ? AND item_date BETWEEN ? AND ?
    GROUP BY item_date
  `, userId, daysAgoStr(days - 1), todayStr());
  const map = new Map();
  rows.forEach(r => map.set(r.item_date, { total: r.total, done: r.done }));
  return map;
}

// null = nessuna attività pianificata quel giorno: non è "0%", è "dato assente"
function pctFromMap(map, date) {
  const d = map.get(date);
  return d && d.total ? pctOf(d.done, d.total) : null;
}

async function dayCompletionPct(userId, date) {
  const rows = await db.all('SELECT status FROM agenda_items WHERE user_id = ? AND item_date = ?', userId, date);
  if (!rows.length) return null;
  const done = rows.filter(r => r.status === 'done').length;
  return pctOf(done, rows.length);
}

async function weekHistory(userId) {
  const map = await completionByDay(userId, 7);
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const date = daysAgoStr(i);
    out.push({ date, pct: pctFromMap(map, date), label: i === 0 ? 'Oggi' : null });
  }
  return out;
}

async function streakDays(userId) {
  const map = await completionByDay(userId, 60);
  let streak = 0;
  for (let i = 0; i < 60; i++) {
    const pct = pctFromMap(map, daysAgoStr(i));
    if (pct && pct > 0) streak++;
    else break;
  }
  return streak;
}

function breakdownRow(category, rows) {
  const done = rows.filter(r => r.status === 'done').length;
  return { category, done, total: rows.length, pct: rows.length ? pctOf(done, rows.length) : 0 };
}

async function categoryBreakdown(userId, ageGroup, date) {
  const cats = CATEGORY_SETS[ageGroup];
  const rows = await db.all('SELECT category, status FROM agenda_items WHERE user_id = ? AND item_date = ?', userId, date);
  return cats.map(cat => breakdownRow(cat, rows.filter(r => r.category === cat)));
}

async function goalRings(userId, ageGroup, date) {
  const routineCat = ROUTINE_CATEGORY[ageGroup];
  const otherCats = CATEGORY_SETS[ageGroup].filter(c => c !== routineCat);
  const rows = await db.all('SELECT category, status FROM agenda_items WHERE user_id = ? AND item_date = ?', userId, date);
  const routineRows = rows.filter(r => r.category === routineCat);
  const otherRows = rows.filter(r => otherCats.includes(r.category));
  const ring = (rs) => {
    const done = rs.filter(r => r.status === 'done').length;
    return { done, total: rs.length, pct: rs.length ? pctOf(done, rs.length) : 0 };
  };
  return { routine: ring(routineRows), other: ring(otherRows) };
}

// Come categoryBreakdown, ma sommato su più giorni invece che su uno solo:
// usata per i riepiloghi "questa settimana" (7 giorni) e "ultimo mese" (30
// giorni) della pagina Statistiche.
async function categoryBreakdownRange(userId, ageGroup, days) {
  const cats = CATEGORY_SETS[ageGroup];
  const rows = await db.all(
    'SELECT category, status FROM agenda_items WHERE user_id = ? AND item_date BETWEEN ? AND ?',
    userId, daysAgoStr(days - 1), todayStr(),
  );
  return cats.map(cat => breakdownRow(cat, rows.filter(r => r.category === cat)));
}

// Vista "mese": invece di 30 barre minuscole (poco leggibili), raggruppiamo
// gli ultimi giorni in blocchi di 7 ("questa settimana", "2 settimane fa", ecc.)
// e mostriamo la media di completamento di ciascun blocco.
async function weeklyBuckets(userId, weeks) {
  weeks = weeks || 5;
  const map = await completionByDay(userId, weeks * 7);
  const buckets = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const pcts = [];
    for (let d = 0; d < 7; d++) {
      const pct = pctFromMap(map, daysAgoStr(w * 7 + d));
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

async function checkinTrend(userId, limit) {
  // Gli ultimi `limit` check-in, restituiti dal più vecchio al più recente.
  const rows = await db.all('SELECT * FROM checkins WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?', userId, limit);
  return rows.reverse();
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

async function fullSummary(user) {
  const date = todayStr();
  const [week, streak, breakdown, rings] = await Promise.all([
    weekHistory(user.id),
    streakDays(user.id),
    categoryBreakdown(user.id, user.age_group, date),
    goalRings(user.id, user.age_group, date),
  ]);
  return { date, week, streak, categoryBreakdown: breakdown, goalRings: rings };
}

module.exports = {
  dayCompletionPct, weekHistory, streakDays, categoryBreakdown, goalRings,
  checkinTrend, trendInfo, fullSummary, categoryBreakdownRange, weeklyBuckets, overallAvg,
};

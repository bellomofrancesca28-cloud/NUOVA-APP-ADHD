// stars.js — calcolo di stelle e super stelle di un utente.
// Una stella = giorno con almeno un'attività e tutte completate.
// Una super stella = settimana (lunedì-domenica) con la stella in tutti e 7 i giorni.
// Non c'è una tabella dedicata: si calcola dalle attività, quindi se una
// attività viene riaperta la stella di quel giorno sparisce.
const db = require('./db');
const { todayStr } = require('./helpers');

function computeStars(userId) {
  const today = todayStr();
  const rows = db.prepare(`
    SELECT item_date, COUNT(*) as count, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as done
    FROM agenda_items WHERE user_id = ? AND item_date <= ?
    GROUP BY item_date
  `).all(userId, today);
  const starDates = rows.filter(r => r.count > 0 && r.done === r.count).map(r => r.item_date);
  const set = new Set(starDates);

  const addDays = (ds, n) => {
    const d = new Date(ds + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const weekStart = (ds) => addDays(ds, -((new Date(ds + 'T12:00:00').getDay() + 6) % 7)); // lunedì
  const weekDays = (monday) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  const weeks = new Set(starDates.map(weekStart));
  const superStars = [...weeks].filter(mon => weekDays(mon).every(d => set.has(d))).length;

  const week = weekDays(weekStart(today)).map(d => ({ date: d, star: set.has(d), future: d > today }));
  const weekStars = week.filter(d => d.star).length;
  return { total: starDates.length, superStars, week, weekStars, superThisWeek: weekStars === 7, todayStar: set.has(today) };
}

module.exports = { computeStars };

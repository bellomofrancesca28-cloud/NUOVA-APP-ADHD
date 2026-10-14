// helpers.js — funzioni condivise tra le varie rotte
const CATEGORY_SETS = {
  teen: ['Routine', 'Scuola', 'Focus', 'Energia'],
  adult: ['Lavoro', 'Casa', 'Benessere'],
};

// Le categorie "Routine"/"Lavoro" sono quelle che contano come "routine" per
// l'anello streak/routine nella dashboard; le altre contano come "attività".
const ROUTINE_CATEGORY = { teen: 'Routine', adult: 'Lavoro' };

function ageGroupFromRange(ageRange) {
  return ageRange === 'teen' ? 'teen' : 'adult';
}

// Restituisce la data di oggi come stringa 'YYYY-MM-DD' (fuso orario del server).
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// Versione "pubblica" di un utente: toglie l'hash della password prima di
// mandare i dati al browser. Non vogliamo mai far uscire quel campo dall'API.
function publicUser(u) {
  if (!u) return null;
  const { password_hash, approval_token, ...rest } = u;
  return rest;
}

// Genera un codice di collegamento (usato sia dal paziente per farsi
// collegare da un genitore, sia dal terapeuta per farsi collegare da un
// paziente): niente 0/O/1/I, facili da confondere quando il codice viene
// letto ad alta voce o ricopiato a mano.
const LINK_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateLinkCode(db) {
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) code += LINK_CODE_CHARS[Math.floor(Math.random() * LINK_CODE_CHARS.length)];
  } while (db.prepare('SELECT id FROM users WHERE link_code = ?').get(code));
  return code;
}

module.exports = { CATEGORY_SETS, ROUTINE_CATEGORY, ageGroupFromRange, todayStr, daysAgoStr, publicUser, generateLinkCode };

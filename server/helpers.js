// helpers.js — funzioni condivise tra le varie rotte
const CATEGORY_SETS = {
  teen: ['Studio', 'Tempo libero', 'Salute'],
  adult: ['Lavoro', 'Tempo libero', 'Salute'],
};

// Le categorie "Studio"/"Lavoro" sono quelle che contano come "routine" per
// l'anello streak/routine nella dashboard; le altre contano come "attività".
const ROUTINE_CATEGORY = { teen: 'Studio', adult: 'Lavoro' };

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
async function generateLinkCode(db) {
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) code += LINK_CODE_CHARS[Math.floor(Math.random() * LINK_CODE_CHARS.length)];
  } while (await db.get('SELECT id FROM users WHERE link_code = ?', code));
  return code;
}

// Le query al database ora sono asincrone (async/await). Express 4 però non
// intercetta da solo gli errori delle funzioni async: senza questo involucro
// un errore del database farebbe cadere l'intero server invece di
// rispondere "Errore interno" (vedi il gestore errori in index.js).
// Router() si usa esattamente come express.Router().
const express = require('express');
function wrapAsync(fn) {
  if (typeof fn !== 'function' || fn.length === 4) return fn; // i gestori d'errore restano com'erano
  return function (req, res, next) {
    try {
      const out = fn(req, res, next);
      if (out && typeof out.catch === 'function') out.catch(next);
    } catch (e) {
      next(e);
    }
  };
}
function Router() {
  const router = express.Router();
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const original = router[method].bind(router);
    router[method] = (routePath, ...handlers) => original(routePath, ...handlers.map(wrapAsync));
  }
  return router;
}

module.exports = { CATEGORY_SETS, ROUTINE_CATEGORY, ageGroupFromRange, todayStr, daysAgoStr, publicUser, generateLinkCode, Router, wrapAsync };

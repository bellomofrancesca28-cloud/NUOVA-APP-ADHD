// realtime.js — la parte "in diretta" della videochiamata di Revisione.
//
// Come funziona una videochiamata WebRTC, in breve: il video e l'audio veri e
// propri viaggiano DIRETTAMENTE tra i due browser (peer-to-peer), non passano
// dal nostro server — più veloce e più privato. Ma perché due browser
// riescano a trovarsi ed accordarsi su come collegarsi, hanno bisogno di
// scambiarsi alcuni messaggi tecnici (un'"offerta", una "risposta", degli
// indirizzi di rete chiamati "candidati ICE"). Questo file fa solo da
// postino per quei messaggi ("segnalazione" / signaling), tramite una
// connessione WebSocket (un canale sempre aperto, diverso dalle normali
// richieste HTTP). Applica anche la regola dei 15 minuti: quando entrambe le
// persone sono davvero collegate, parte un timer server-side che a fine
// tempo chiude la chiamata per tutti e due, così il limite non dipende da un
// timer solo nel browser che si potrebbe manomettere o disattivare.
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'CAMBIA-QUESTA-CHIAVE-PRIMA-DI-DISTRIBUIRE-DAVVERO';
const COOKIE_NAME = 'adhd_coach_token';
const CALL_DURATION_MS = 15 * 60 * 1000;

function readTokenFromCookieHeader(header) {
  if (!header) return null;
  for (const part of header.split(';').map(p => p.trim())) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx) === COOKIE_NAME) {
      try { return jwt.verify(decodeURIComponent(part.slice(idx + 1)), JWT_SECRET); } catch (e) { return null; }
    }
  }
  return null;
}

function safeSend(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}
function broadcast(room, obj) {
  for (const sock of room.sockets.values()) safeSend(sock, obj);
}
function otherSocket(room, userId) {
  for (const [id, sock] of room.sockets) if (id !== userId) return sock;
  return null;
}

// Una stanza per ogni "slot" di revisione confermato, al massimo due persone
// dentro (paziente e terapeuta di quella specifica coppia).
const rooms = new Map();

function closeRoom(slotId) {
  const room = rooms.get(slotId);
  if (!room) return;
  if (room.timer) clearTimeout(room.timer);
  for (const sock of room.sockets.values()) { try { sock.close(4000, 'call-ended'); } catch (e) {} }
  rooms.delete(slotId);
}

function attach(server) {
  const wss = new WebSocketServer({ server, path: '/ws/review' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const slotId = Number(url.searchParams.get('slotId'));
    const payload = readTokenFromCookieHeader(req.headers.cookie);
    if (!payload || !slotId) { ws.close(4001, 'Non autenticato'); return; }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
    const slot = db.prepare('SELECT * FROM review_slots WHERE id = ?').get(slotId);
    if (!user || !slot || slot.status !== 'confirmed') { ws.close(4004, 'Revisione non trovata o non confermata'); return; }
    const belongs = (user.role === 'patient' && user.id === slot.patient_id) || (user.role === 'therapist' && user.id === slot.therapist_id);
    if (!belongs) { ws.close(4003, 'Non autorizzato a entrare in questa revisione'); return; }

    let room = rooms.get(slotId);
    if (!room) { room = { sockets: new Map(), timer: null, endsAt: null }; rooms.set(slotId, room); }

    if (room.sockets.size >= 2 && !room.sockets.has(user.id)) { ws.close(4009, 'La stanza ha già due persone'); return; }

    const existing = room.sockets.get(user.id);
    if (existing && existing !== ws) { try { existing.close(4000, 'sostituita da una nuova connessione'); } catch (e) {} }
    room.sockets.set(user.id, ws);

    safeSend(ws, { type: 'joined', role: user.role });
    const other = otherSocket(room, user.id);
    if (other) { safeSend(other, { type: 'peer-joined' }); safeSend(ws, { type: 'peer-joined' }); }

    if (room.sockets.size === 2 && !room.timer) {
      room.endsAt = Date.now() + CALL_DURATION_MS;
      broadcast(room, { type: 'call-started', endsAt: room.endsAt });
      room.timer = setTimeout(() => {
        broadcast(room, { type: 'call-ended', reason: 'time-up' });
        closeRoom(slotId);
      }, CALL_DURATION_MS);
    } else if (room.endsAt) {
      safeSend(ws, { type: 'call-started', endsAt: room.endsAt });
    }

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }
      if (msg.type === 'signal') {
        safeSend(otherSocket(room, user.id), { type: 'signal', payload: msg.payload });
      } else if (msg.type === 'leave') {
        broadcast(room, { type: 'call-ended', reason: 'peer-left' });
        closeRoom(slotId);
      }
    });

    ws.on('close', () => {
      const r = rooms.get(slotId);
      if (!r || r.sockets.get(user.id) !== ws) return;
      r.sockets.delete(user.id);
      const remaining = [...r.sockets.values()][0];
      if (remaining) safeSend(remaining, { type: 'peer-left' });
      if (r.sockets.size === 0) closeRoom(slotId);
    });
  });
}

module.exports = { attach };

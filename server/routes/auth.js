const express = require('express'); // serve ancora per express.urlencoded
const crypto = require('crypto');
// I CV stanno nello storage PRIVATO (vedi server/storage.js): nessun URL pubblico,
// si aprono solo dal link con token segreto dell'email di approvazione.
const storage = require('../storage');
const MAX_CV_BYTES = 3 * 1024 * 1024;
const { sendMail } = require('../mailer');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { setAuthCookie, clearAuthCookie } = require('../auth-utils');
const { requireAuth } = require('../middleware');
const { ageGroupFromRange, publicUser, Router } = require('../helpers');

const router = Router();

const VALID_AGE_RANGES = ['teen', 'adult']; // teen = 14-17, adult = >18 (solo pazienti)

router.post('/register', async (req, res) => {
  const { email, password, role, name, ageRange, job, goal, bio, specialty, cvBase64, orderNumber } = req.body || {};

  if (!email || !password || !role || !name) {
    return res.status(400).json({ error: 'Compila email, password, nome e ruolo.' });
  }
  if (!['patient', 'therapist', 'parent'].includes(role)) {
    return res.status(400).json({ error: 'Ruolo non valido.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'La password deve avere almeno 8 caratteri.' });
  }
  if (role === 'patient' && !VALID_AGE_RANGES.includes(ageRange)) {
    return res.status(400).json({ error: 'Seleziona 14-17 oppure >18.' });
  }

  // Utenti e genitori: data di nascita e cellulare obbligatori (li vede il tutor).
  let birthDate = null, phone = null;
  if (role !== 'therapist') {
    birthDate = typeof req.body.birthDate === 'string' ? req.body.birthDate : '';
    phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || isNaN(new Date(birthDate).getTime())) {
      return res.status(400).json({ error: 'Inserisci la tua data di nascita.' });
    }
    if (!/^\+?[\d\s]{6,20}$/.test(phone)) {
      return res.status(400).json({ error: 'Inserisci un numero di cellulare valido.' });
    }
    const now = new Date();
    const b = new Date(birthDate);
    let age = now.getFullYear() - b.getFullYear();
    if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) age--;
    if (age < 0 || age > 110) return res.status(400).json({ error: 'Data di nascita non valida.' });
    if (role === 'patient' && ageRange === 'teen' && (age < 14 || age > 17)) {
      return res.status(400).json({ error: 'La data di nascita non corrisponde alla fascia 14-17.' });
    }
    if (role === 'patient' && ageRange === 'adult' && age < 18) {
      return res.status(400).json({ error: 'La data di nascita non corrisponde alla fascia >18.' });
    }
    if (role === 'parent' && age < 18) {
      return res.status(400).json({ error: 'Un genitore deve essere maggiorenne.' });
    }
  }

  // Per i tutor sono obbligatori specializzazione, breve descrizione e CV (PDF).
  let cvBuffer = null;
  if (role === 'therapist') {
    if (!specialty || !specialty.trim()) return res.status(400).json({ error: 'Inserisci la tua specializzazione.' });
    if (!bio || !bio.trim()) return res.status(400).json({ error: 'Inserisci una breve descrizione della tua formazione.' });
    if (typeof orderNumber !== 'string' || !orderNumber.trim()) return res.status(400).json({ error: 'Inserisci il numero di iscrizione all\'ordine.' });
    if (orderNumber.trim().length > 40) return res.status(400).json({ error: 'Numero di iscrizione troppo lungo.' });
    const m = typeof cvBase64 === 'string' && cvBase64.match(/^data:application\/pdf;base64,(.+)$/);
    if (!m) return res.status(400).json({ error: 'Carica il tuo CV in formato PDF.' });
    cvBuffer = Buffer.from(m[1], 'base64');
    if (cvBuffer.length > MAX_CV_BYTES) return res.status(400).json({ error: 'CV troppo grande: massimo 3MB.' });
  }

  const existing = await db.get('SELECT id FROM users WHERE email = ?', email.toLowerCase().trim());
  if (existing) {
    return res.status(409).json({ error: 'Esiste già un account con questa email.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const ageGroup = role === 'patient' ? ageGroupFromRange(ageRange) : null;

  // Tutor: nascono NON approvati, con token di approvazione, CV e numero d'albo
  // già nello stesso INSERT, così non esiste mai un tutor "attivo per errore".
  // Il CV su disco si scrive prima; se l'INSERT fallisce lo rimuoviamo.
  const isTherapist = role === 'therapist';
  const approvalToken = isTherapist ? crypto.randomBytes(24).toString('hex') : null;
  const cvFile = isTherapist ? `${crypto.randomBytes(12).toString('hex')}.pdf` : null;
  if (isTherapist) {
    await storage.save(`cv/${cvFile}`, cvBuffer, 'application/pdf');
  }

  let user;
  try {
    user = await db.get(`
      INSERT INTO users (email, password_hash, role, name, age_range, age_group, job, goal, bio, specialty, birth_date, phone,
                         approved, approval_token, cv_file, order_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `,
      email.toLowerCase().trim(),
      passwordHash,
      role,
      name.trim(),
      role === 'patient' ? ageRange : null,
      ageGroup,
      job || null,
      goal || null,
      isTherapist ? (bio || null) : null,
      isTherapist ? (specialty || null) : null,
      birthDate,
      phone,
      isTherapist ? 0 : 1,
      approvalToken,
      cvFile,
      isTherapist ? orderNumber.trim() : null,
    );
  } catch (e) {
    if (cvFile) await storage.remove(`cv/${cvFile}`);
    // Due registrazioni quasi simultanee con la stessa email: il vincolo UNIQUE
    // del database blocca la seconda (codice Postgres 23505).
    if (e.code === '23505') return res.status(409).json({ error: 'Esiste già un account con questa email.' });
    throw e;
  }

  // L'amministratrice riceve un'email con un link per approvare (o rifiutare)
  // la richiesta. Finché non approva, l'account esiste ma non può accedere.
  if (isTherapist) {
    const token = approvalToken;
    const base = process.env.APP_BASE_URL || `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`;
    const link = `${base}/api/auth/approve-tutor?token=${token}`;
    console.log('\n>>> LINK PER APPROVARE IL TUTOR:', link, '\n');
    const adminEmail = process.env.ADMIN_EMAIL || 'bellomofrancesca28@gmail.com';
    sendMail({
      to: adminEmail,
      subject: `Nuova richiesta account Tutor: ${user.name}`,
      text: `Un nuovo tutor ha chiesto di registrarsi su ADHD Coach.\n\nNome: ${user.name}\nEmail: ${user.email}\nSpecializzazione: ${user.specialty}\nN. iscrizione all'ordine: ${user.order_number}\n\nDescrizione della formazione:\n${user.bio}\n\nIl CV è allegato a questa email.\n\nPer approvare o rifiutare apri questo link:\n${link}\n`,
      html: `<p>Un nuovo tutor ha chiesto di registrarsi su ADHD Coach.</p><p><b>Nome:</b> ${escapeHtml(user.name)}<br><b>Email:</b> ${escapeHtml(user.email)}<br><b>Specializzazione:</b> ${escapeHtml(user.specialty)}<br><b>N. iscrizione all'ordine:</b> ${escapeHtml(user.order_number)}</p><p><b>Descrizione della formazione:</b><br>${escapeHtml(user.bio).replace(/\n/g, '<br>')}</p><p>Il CV è allegato a questa email.</p><p><a href="${link}">Apri per approvare o rifiutare</a></p>`,
      attachments: [{ filename: `CV-${user.name.replace(/[^\w]+/g, '_')}.pdf`, content: cvBuffer, contentType: 'application/pdf' }],
    });
    return res.json({ pendingApproval: true });
  }

  setAuthCookie(res, user);
  res.json({ user: publicUser(user) });
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function simplePage(title, body) {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:480px;margin:60px auto;padding:0 20px;line-height:1.5"><h2>${title}</h2>${body}</body></html>`;
}
async function pendingTutorByToken(token) {
  if (!token || typeof token !== 'string') return null;
  return db.get('SELECT * FROM users WHERE approval_token = ? AND role = \'therapist\' AND approved = 0', token);
}

// Pagina aperta dal link nell'email: mostra i dati e due pulsanti. Approvare
// avviene solo col click sul pulsante (POST), così un programma che "apre in
// anteprima" i link delle email non approva per errore.
router.get('/approve-tutor', async (req, res) => {
  const tutor = await pendingTutorByToken(req.query.token);
  if (!tutor) return res.status(404).send(simplePage('Link non valido', '<p>Questa richiesta non esiste più o è già stata gestita.</p>'));
  res.send(simplePage('Richiesta account Tutor', `
    <p><b>${escapeHtml(tutor.name)}</b><br>${escapeHtml(tutor.email)}<br><i>${escapeHtml(tutor.specialty || '')}</i><br>N. iscrizione all'ordine: <b>${escapeHtml(tutor.order_number || '-')}</b></p>
    <p>${escapeHtml(tutor.bio || '').replace(/\n/g, '<br>')}</p>
    ${tutor.cv_file ? `<p><a href="/api/auth/approve-tutor/cv?token=${escapeHtml(req.query.token)}" target="_blank">Apri il CV (PDF)</a></p>` : ''}
    <form method="post" action="/api/auth/approve-tutor" style="display:flex;gap:10px">
      <input type="hidden" name="token" value="${escapeHtml(req.query.token)}">
      <button name="action" value="approve" style="padding:10px 18px;font-size:16px">Approva</button>
      <button name="action" value="reject" style="padding:10px 18px;font-size:16px">Rifiuta</button>
    </form>`));
});

// Il CV si apre solo con il token segreto dell'email di approvazione.
router.get('/approve-tutor/cv', async (req, res) => {
  const tutor = await pendingTutorByToken(req.query.token);
  if (!tutor || !tutor.cv_file) return res.status(404).send('Non trovato');
  const file = await storage.read(`cv/${tutor.cv_file}`);
  if (!file) return res.status(404).send('Non trovato');
  res.type('application/pdf');
  res.set('Cache-Control', 'private, no-store');
  if (file.length != null) res.set('Content-Length', String(file.length));
  file.stream.on('error', err => { console.error('CV: errore di lettura', err.message); res.destroy(err); });
  file.stream.pipe(res);
});

router.post('/approve-tutor', express.urlencoded({ extended: false }), async (req, res) => {
  const tutor = await pendingTutorByToken(req.body && req.body.token);
  if (!tutor) return res.status(404).send(simplePage('Link non valido', '<p>Questa richiesta non esiste più o è già stata gestita.</p>'));
  if (req.body.action === 'approve') {
    await db.run('UPDATE users SET approved = 1, approval_token = NULL WHERE id = ?', tutor.id);
    sendMail({
      to: tutor.email,
      subject: 'Il tuo account Tutor è stato approvato',
      text: `Ciao ${tutor.name}, il tuo account Tutor su ADHD Coach è stato approvato: ora puoi accedere con la tua email e password.`,
    });
    return res.send(simplePage('Tutor approvato', `<p>${escapeHtml(tutor.name)} ora può accedere.</p>`));
  }
  if (tutor.cv_file) await storage.remove(`cv/${tutor.cv_file}`);
  await db.run('DELETE FROM users WHERE id = ?', tutor.id);
  res.send(simplePage('Richiesta rifiutata', '<p>L\'account è stato eliminato.</p>'));
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Inserisci email e password.' });

  const user = await db.get('SELECT * FROM users WHERE email = ?', email.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Email o password non corrette.' });
  }
  if (user.role === 'therapist' && user.approved === 0) {
    return res.status(403).json({ error: 'Il tuo account Tutor è in attesa di approvazione. Riceverai un\'email appena sarà attivo.' });
  }
  setAuthCookie(res, user);
  res.json({ user: publicUser(user) });
});

router.post('/logout', async (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  let therapistLink = null;
  let pendingTherapistRequest = null;
  if (req.user.role === 'patient') {
    const link = await db.get(`
      SELECT pt.*, u.name as therapist_name, u.avatar as therapist_avatar, u.specialty as therapist_specialty
      FROM patient_therapist pt JOIN users u ON u.id = pt.therapist_id
      WHERE pt.patient_id = ?
    `, req.user.id);
    // Il collegamento "vero" (therapistLink) esiste solo dopo che il tutor lo
    // ha accettato; finché è in attesa lo esponiamo separatamente, così il
    // frontend può mostrare la schermata di attesa invece della lista tutor.
    if (link && link.status === 'active') therapistLink = link;
    else if (link && link.status === 'pending') pendingTherapistRequest = link;
  }
  res.json({ user: publicUser(req.user), therapistLink, pendingTherapistRequest });
});

module.exports = router;

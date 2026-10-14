// mailer.js — invio email. Tre modalità, scelte in automatico:
//
// 1) BREVO (consigliata online): usa l'API web di Brevo, che funziona anche su
//    Render gratis (Render blocca invece la posta SMTP classica, Gmail incluso).
//    Variabili: BREVO_API_KEY (chiave API) e BREVO_SENDER (l'indirizzo email
//    mittente, da verificare su Brevo, es. bellomofrancesca28@gmail.com).
// 2) GMAIL via SMTP (va bene in locale sul Mac): GMAIL_USER + GMAIL_APP_PASSWORD
//    ("password per le app" di Google, NON la password normale).
// 3) Nessuna configurazione: il server NON si blocca, scrive il contenuto
//    dell'email nel Terminale/log (così si può testare copiando il link).
//
// In tutti i casi ADMIN_EMAIL decide a chi arrivano le richieste di approvazione.

async function sendViaBrevo({ to, subject, text, html, attachments }) {
  const sender = process.env.BREVO_SENDER || process.env.GMAIL_USER;
  const body = {
    sender: { name: 'ADHD Coach', email: sender },
    to: [{ email: to }],
    subject,
    textContent: text || undefined,
    htmlContent: html || `<p>${String(text || '').replace(/\n/g, '<br>')}</p>`,
  };
  if (attachments && attachments.length) {
    body.attachment = attachments.map(a => ({
      name: a.filename,
      content: Buffer.from(a.content).toString('base64'),
    }));
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
}

async function sendViaGmail({ to, subject, text, html, attachments }, user, pass) {
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  await transporter.sendMail({ from: `"ADHD Coach" <${user}>`, to, subject, text, html, attachments });
}

async function sendMail(mail) {
  const { to, subject, text } = mail;
  try {
    if (process.env.BREVO_API_KEY) {
      await sendViaBrevo(mail);
      return { sent: true };
    }
    // Google mostra il codice a gruppi di 4 lettere separati da spazi: li togliamo.
    let pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
    if (pass === 'INCOLLA_QUI_IL_CODICE') pass = '';
    const user = process.env.GMAIL_USER;
    if (user && pass) {
      await sendViaGmail(mail, user, pass);
      return { sent: true };
    }
  } catch (e) {
    console.error('Errore invio email:', e.message);
  }
  console.log('\n[EMAIL non inviata] Contenuto:');
  console.log('A:', to, '\nOggetto:', subject, '\n' + text + '\n');
  return { sent: false };
}

module.exports = { sendMail };

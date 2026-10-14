// mailer.js — invio email tramite Gmail (libreria "nodemailer").
// Servono tre variabili d'ambiente (nel file .env in locale, oppure nelle
// "Environment Variables" di Render online):
//   GMAIL_USER          indirizzo Gmail che spedisce (es. bellomofrancesca28@gmail.com)
//   GMAIL_APP_PASSWORD  "password per le app" di Google (NON la password normale)
//   ADMIN_EMAIL         a chi arrivano le richieste di approvazione dei tutor
// Se mancano (o nodemailer non è installato) il server NON si blocca: scrive
// il contenuto dell'email nel Terminale, così in locale si può testare lo
// stesso copiando il link di approvazione da lì.

async function sendMail({ to, subject, text, html, attachments }) {
  const user = process.env.GMAIL_USER;
  // Google mostra il codice a gruppi di 4 lettere separati da spazi: li togliamo.
  let pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (pass === 'INCOLLA_QUI_IL_CODICE') pass = '';
  let nodemailer = null;
  try { nodemailer = require('nodemailer'); } catch (e) { /* non installato */ }

  if (!user || !pass || !nodemailer) {
    console.log('\n[EMAIL non inviata: Gmail non configurato] Contenuto:');
    console.log('A:', to, '\nOggetto:', subject, '\n' + text + '\n');
    return { sent: false };
  }
  try {
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    await transporter.sendMail({ from: `"ADHD Coach" <${user}>`, to, subject, text, html, attachments });
    return { sent: true };
  } catch (e) {
    console.error('Errore invio email:', e.message);
    console.log('Link/contenuto che avrebbe dovuto essere inviato:\n' + text + '\n');
    return { sent: false };
  }
}

module.exports = { sendMail };

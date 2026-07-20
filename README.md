# ADHD Coach — versione con backend reale

Questa è la versione "vera" dell'app: non più un solo file HTML con dati finti,
ma un piccolo programma (server) che gira sul tuo computer, con un database
che salva davvero i dati, account con password, e la separazione reale tra
pazienti e terapeuti.

## Glossario minimo

- **Server**: un programma che resta acceso e "ascolta" richieste in rete.
  Qui è scritto in Node.js (un modo di far girare JavaScript fuori dal
  browser) e si trova nella cartella `server/`.
- **Database**: il posto dove i dati restano salvati davvero (non in memoria).
  Qui usiamo SQLite: un database che è semplicemente un file
  (`server/data/app.sqlite`), niente da installare a parte.
- **API**: l'insieme di "indirizzi" (es. `/api/agenda`) attraverso cui il
  frontend (quello che vedi nel browser) chiede o invia dati al server.
- **Frontend**: i file in `public/` — quello che vedi e con cui interagisci
  nel browser.

## Come provarla sul tuo computer

1. Installa **Node.js** (una volta sola): vai su https://nodejs.org e scarica
   la versione "LTS". È un programma gratuito, si installa come qualunque
   altra applicazione.
2. Apri il Terminale, spostati nella cartella di questo progetto
   (`adhd-coach-app`) ed esegui:
   ```
   npm install
   ```
   Questo scarica le "librerie" (pezzi di codice già pronti, tipo il
   database o la gestione delle password) di cui il progetto ha bisogno.
   Va fatto una volta sola (o di nuovo se cambiamo le dipendenze).
3. Avvia il server:
   ```
   npm start
   ```
   Se tutto va bene, vedrai scritto `ADHD Coach in ascolto su
   http://localhost:3000`.
4. Apri quell'indirizzo nel browser: `http://localhost:3000`.
5. Crea un account terapeuta e un account paziente (con due email diverse)
   per provare il flusso completo, oppure lancia prima:
   ```
   npm run seed
   ```
   per creare 3 terapeuti demo (email `demo.calvo@example.com`, ecc.,
   password `DemoPass123`) così la schermata "scegli il tuo terapeuta" non è
   vuota.

Se `npm install` desse un errore relativo a "better-sqlite3" o a
compilazione, quasi sempre basta installare gli "Xcode Command Line Tools"
(su Mac: `xcode-select --install` nel Terminale, è gratuito e richiede pochi
minuti) e riprovare.

## Cosa NON è ancora pronto per un vero rilascio pubblico

Questa è una base solida ma resta un MVP. Prima di farla usare a pazienti
reali, servono ancora, in ordine di importanza:

1. **Hosting**: oggi il server gira solo sul tuo computer. Per farlo usare
   da altre persone va "ospitato" su un servizio online (es. Render,
   Railway, Fly.io) con un dominio vero e HTTPS.
2. **Revisione clinica del Coach**: le risposte e soprattutto il
   riconoscimento di messaggi "di crisi" (`server/coach-engine.js`) sono un
   punto di partenza tecnico, non validato clinicamente. Chiediamo alla
   psichiatra del team di rivedere frase per frase, in particolare
   `CRISIS_RX` e `CRISIS_MSG`.
3. **Privacy e normativa**: dati di salute mentale sono "categoria
   particolare" secondo il GDPR. Prima della distribuzione reale serve una
   valutazione legale su conservazione dati, consenso informato, e
   eventuali obblighi ulteriori.
4. **Email reali**: oggi non c'è verifica email né recupero password.
5. **Backup del database**: il file SQLite andrebbe copiato regolarmente da
   qualche parte al sicuro.

Sono felice di continuare su uno qualsiasi di questi punti quando siete
pronti.

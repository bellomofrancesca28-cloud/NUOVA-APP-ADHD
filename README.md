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
  Qui usiamo **PostgreSQL**, un database vero che gira su un server a parte
  (non un file). L'app si collega tramite le variabili `PG*` (vedi sotto) e lo
  schema è creato automaticamente all'avvio dai file in `server/migrations/`.
- **API**: l'insieme di "indirizzi" (es. `/api/agenda`) attraverso cui il
  frontend (quello che vedi nel browser) chiede o invia dati al server.
- **Frontend**: i file in `public/` — quello che vedi e con cui interagisci
  nel browser.

## Come provarla sul tuo computer

1. Installa **Node.js 20.x** (una volta sola): https://nodejs.org, versione
   "LTS". Serve anche l'accesso a un database PostgreSQL (vedi punto 3).
2. Nel Terminale, nella cartella del progetto, esegui:
   ```
   npm install
   ```
   (una volta sola, o di nuovo se cambiano le dipendenze).
3. **Configura la connessione al database.** Copia `.env.example` in `.env`
   (non viene mai committato) e compila i valori: `PGHOST`, `PGPORT`,
   `PGDATABASE`, `PGUSER`, `DB_SSL`, ecc. La password è meglio non scriverla
   nel file: esportala nella shell prima di avviare l'app:
   ```
   read -rs PGPASSWORD; export PGPASSWORD
   ```
   Il database deve essere raggiungibile dal tuo computer (rete interna/VPN).
   Per un Postgres locale di sviluppo usa `DB_SSL=disable`.
4. Avvia il server:
   ```
   npm start
   ```
   Al primo avvio applica le migrazioni (`Migrazione applicata: 001_init.sql`)
   e poi scrive `ADHD Coach in ascolto su http://localhost:3000`. Se il
   database non è raggiungibile il server non parte e indica host, database e
   utente usati (mai la password).
5. Apri `http://localhost:3000` e crea un account tutor e uno utente (con due
   email diverse), oppure lancia prima:
   ```
   npm run seed
   ```
   per creare 3 tutor demo (`demo.calvo@example.com`, ecc., password
   `DemoPass123`). Il seed e la demo si rifiutano di partire con
   `NODE_ENV=production`.

   Per una copia di prova con un utente adolescente già pronto, su un
   database SEPARATO: `DEMO_PGDATABASE=adhd_demo npm run demo`
   (porta 3001, `teen@demo.it` / `tutor@demo.it`, password `DemoPass123`).

### Variabili d'ambiente importanti

- `JWT_SECRET`: **obbligatoria in produzione** (almeno 32 caratteri casuali);
  con `NODE_ENV=production` e il valore mancante il server non parte. In
  sviluppo, se manca, usa una chiave locale e lo segnala.
- `DB_SSL`: `require` (default, TLS senza verifica del certificato),
  `verify` (con `DB_SSL_CA`) o `disable` (solo Postgres locale).
- `AZURE_STORAGE_ACCOUNT` (o `AZURE_STORAGE_CONNECTION_STRING`) e
  `AZURE_STORAGE_CONTAINER`: dove vanno foto profilo e CV dei tutor (Azure Blob
  Storage, contenitore privato da creare in anticipo; con l'identità gestita
  serve il ruolo "Storage Blob Data Contributor"). Il disco del container non
  si usa perché si azzera a ogni riavvio. In produzione il server non parte se
  mancano; in sviluppo, senza, i file vanno in `server/data/files/`.
- `ADMIN_EMAIL`, `APP_BASE_URL`, `BREVO_API_KEY`, ecc.: vedi `.env.example`.

### Migrazioni del database

Gli aggiornamenti dello schema sono file numerati in `server/migrations/`
(`001_init.sql`, `002_...sql`). All'avvio viene applicato ogni file mancante,
una sola volta e in ordine, dentro una transazione. Per cambiare lo schema si
**aggiunge un nuovo file**, senza modificare quelli già applicati.

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
5. **Backup del database**: pianificare backup regolari di PostgreSQL
   (es. `pg_dump` o i backup gestiti del servizio che lo ospita) e provare
   ogni tanto a ripristinarli.

Sono felice di continuare su uno qualsiasi di questi punti quando siete
pronti.

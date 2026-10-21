// db.js
// Qui apriamo il "database": un file sul disco (SQLite) che contiene tutte le
// tabelle dell'app. A differenza del prototipo originale (dove i dati vivevano
// solo in variabili JavaScript e sparivano ad ogni refresh), qui i dati restano
// salvati in server/data/app.sqlite anche se il server si riavvia.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'app.sqlite');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// "Schema" = la struttura delle tabelle: quali colonne esistono e che tipo di
// dato contengono. CREATE TABLE IF NOT EXISTS significa "creala solo se non
// esiste già", quindi possiamo eseguire questo file ogni volta che il server
// parte senza cancellare i dati esistenti.
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('patient','therapist','parent')),
  name TEXT NOT NULL,
  nickname TEXT,
  avatar TEXT DEFAULT '🦊',
  age_range TEXT,           -- teen | adult (solo pazienti: 14-17 o >18)
  age_group TEXT,           -- 'teen' | 'adult' (derivato, decide quale dashboard vede)
  job TEXT,
  goal TEXT,                -- "richiesta" del paziente in fase di onboarding
  bio TEXT,                 -- bio del terapeuta
  specialty TEXT,           -- etichetta specializzazione del terapeuta
  link_code TEXT UNIQUE,    -- codice che un paziente genera per farsi collegare da un genitore
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS patient_therapist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  therapist_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Collegamento genitore -> figlio/a minorenne: un figlio/a può avere fino a
-- due genitori collegati (entrambi con lo stesso codice generato dal figlio),
-- un genitore può collegare più figli. UNIQUE(parent_id, child_id) impedisce
-- solo che lo stesso genitore si colleghi due volte allo stesso figlio.
CREATE TABLE IF NOT EXISTS parent_child (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  child_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(parent_id, child_id)
);

CREATE TABLE IF NOT EXISTS daily_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  energy INTEGER, focus INTEGER, stress INTEGER, sleep INTEGER,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS agenda_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_date TEXT NOT NULL,
  time TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agenda_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agenda_item_id INTEGER NOT NULL REFERENCES agenda_items(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done INTEGER DEFAULT 0,
  position INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  mood INTEGER, energy INTEGER, focus INTEGER, stress INTEGER, sleep INTEGER, cognitive_load INTEGER,
  note TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  therapist_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS coach_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT,
  blocked INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Orari di "Revisione" (15 minuti) proposti dal terapeuta e confermati dal
-- paziente. "cadence" è solo un'etichetta informativa per ora (settimanale /
-- bisettimanale / mensile / una tantum): non genera automaticamente le
-- proposte successive — quello arriverà con il sistema dei "piani".
CREATE TABLE IF NOT EXISTS review_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  therapist_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot_date TEXT NOT NULL,
  slot_time TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 15,
  cadence TEXT,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','confirmed','declined','cancelled')),
  proposed_by TEXT NOT NULL DEFAULT 'therapist',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agenda_user_date ON agenda_items(user_id, item_date);
CREATE INDEX IF NOT EXISTS idx_checkins_user ON checkins(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(patient_id, therapist_id);
CREATE INDEX IF NOT EXISTS idx_review_slots_pair ON review_slots(patient_id, therapist_id);
`);

// MIGRAZIONE: se il file del database esisteva già da prima dell'aggiunta del
// ruolo "genitore" (creato con una versione precedente di questo file), la
// tabella "users" resta bloccata sullo schema vecchio: "CREATE TABLE IF NOT
// EXISTS" non tocca una tabella già esistente. Qui controlliamo lo schema
// reale salvato nel database e, se serve, ricostruiamo la tabella "users"
// con le colonne/vincoli aggiornati, riportando dentro tutti i dati esistenti
// (nessun utente già registrato viene perso).
const usersTableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
if (usersTableInfo && !usersTableInfo.sql.includes("'parent'")) {
  const migrate = db.transaction(() => {
    db.exec('ALTER TABLE users RENAME TO users_pre_parent_migration');
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('patient','therapist','parent')),
        name TEXT NOT NULL,
        nickname TEXT,
        avatar TEXT DEFAULT '🦊',
        age_range TEXT,
        age_group TEXT,
        job TEXT,
        goal TEXT,
        bio TEXT,
        specialty TEXT,
        link_code TEXT UNIQUE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec(`
      INSERT INTO users (id, email, password_hash, role, name, nickname, avatar, age_range, age_group, job, goal, bio, specialty, created_at)
      SELECT id, email, password_hash, role, name, nickname, avatar, age_range, age_group, job, goal, bio, specialty, created_at FROM users_pre_parent_migration
    `);
    db.exec('DROP TABLE users_pre_parent_migration');
  });
  migrate();
}

// MIGRAZIONE: preferenze di notifica (push/email/promemoria), chieste una
// volta sola subito dopo la registrazione. A differenza del ruolo "parent"
// (che ha toccato un CHECK, quindi serviva ricreare la tabella), qui basta
// aggiungere tre colonne semplici se non esistono già.
const userColumns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
for (const col of ['notif_push', 'notif_email', 'notif_reminders']) {
  if (!userColumns.includes(col)) {
    db.exec(`ALTER TABLE users ADD COLUMN ${col} INTEGER`);
  }
}

// MIGRAZIONE: data/ora di accettazione di privacy e consenso informato,
// chiesti anch'essi una sola volta subito dopo la registrazione. Salviamo un
// timestamp (non solo un flag sì/no) perché è la prova di quando è stato dato
// il consenso, utile in caso di controlli.
const userColumns2 = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
for (const col of ['privacy_accepted_at', 'consent_accepted_at']) {
  if (!userColumns2.includes(col)) {
    db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT`);
  }
}

// MIGRAZIONE: "Come ti senti oggi?" (faccine nella Home) salva l'umore scelto
// come etichetta (benissimo, bene, cosi_cosi, triste, arrabbiato).
const checkinColumns = db.prepare("PRAGMA table_info(checkins)").all().map(c => c.name);
if (!checkinColumns.includes('mood_label')) {
  db.exec('ALTER TABLE checkins ADD COLUMN mood_label TEXT');
}

// MIGRAZIONE: obiettivi scelti dal paziente in fase di onboarding (elenco
// selezionato tra più opzioni, salvato come testo separato da virgole).
const userColumns3 = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userColumns3.includes('goals')) {
  db.exec('ALTER TABLE users ADD COLUMN goals TEXT');
}

// MIGRAZIONE: foto del profilo (percorso del file salvato su disco, non
// l'immagine stessa). Separata dall'emoji "avatar" già esistente: se è
// presente, la foto ha la precedenza sull'emoji nell'elenco tutor che vede
// il paziente in fase di scelta.
const userColumns4 = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userColumns4.includes('avatar_photo')) {
  db.exec('ALTER TABLE users ADD COLUMN avatar_photo TEXT');
}

// MIGRAZIONE: consentire fino a due genitori collegati allo stesso figlio/a
// (prima era possibile un solo genitore per figlio, per via del vincolo
// "child_id UNIQUE"). Stesso schema di ricostruzione già usato sopra per la
// tabella "users": rinominiamo la tabella vecchia, ne creiamo una nuova senza
// il vincolo UNIQUE su child_id (sostituito da UNIQUE(parent_id, child_id),
// che impedisce solo i doppioni dello stesso genitore) e ricopiamo i dati.
const parentChildTableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='parent_child'").get();
if (parentChildTableInfo && parentChildTableInfo.sql.includes('child_id INTEGER NOT NULL UNIQUE')) {
  const migrateParentChild = db.transaction(() => {
    db.exec('ALTER TABLE parent_child RENAME TO parent_child_pre_two_parents_migration');
    db.exec(`
      CREATE TABLE parent_child (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        child_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT DEFAULT 'active',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(parent_id, child_id)
      )
    `);
    db.exec(`
      INSERT INTO parent_child (id, parent_id, child_id, status, created_at)
      SELECT id, parent_id, child_id, status, created_at FROM parent_child_pre_two_parents_migration
    `);
    db.exec('DROP TABLE parent_child_pre_two_parents_migration');
  });
  migrateParentChild();
}

// MIGRAZIONE: approvazione dei nuovi account tutor. "approved" vale 1 per
// tutti gli account già esistenti (restano attivi) e per pazienti/genitori;
// i nuovi tutor nascono con approved = 0 e un "approval_token" segreto, che
// finisce solo nell'email di approvazione inviata all'amministratrice.
const userColumns5 = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userColumns5.includes('approved')) {
  db.exec('ALTER TABLE users ADD COLUMN approved INTEGER DEFAULT 1');
}
if (!userColumns5.includes('approval_token')) {
  db.exec('ALTER TABLE users ADD COLUMN approval_token TEXT');
}
// Nome del file PDF del curriculum del tutor (salvato in una cartella privata,
// non pubblica: lo vede solo chi approva le richieste).
if (!userColumns5.includes('cv_file')) {
  db.exec('ALTER TABLE users ADD COLUMN cv_file TEXT');
}
// Data di nascita (YYYY-MM-DD) e cellulare di utenti e genitori: li vede il
// tutor con cui l'utente si collega.
// Numero di iscrizione all'ordine professionale del tutor (visibile agli utenti).
if (!userColumns5.includes('order_number')) {
  db.exec('ALTER TABLE users ADD COLUMN order_number TEXT');
}
if (!userColumns5.includes('birth_date')) {
  db.exec('ALTER TABLE users ADD COLUMN birth_date TEXT');
}
if (!userColumns5.includes('phone')) {
  db.exec('ALTER TABLE users ADD COLUMN phone TEXT');
}

module.exports = db;

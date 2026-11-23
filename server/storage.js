// storage.js
// Archiviazione dei file caricati dagli utenti (foto profilo e CV dei tutor).
//
// Il disco di un container è effimero: a ogni riavvio, deploy o nuova
// revisione i file scritti lì sparirebbero, e con più repliche ognuna
// vedrebbe solo i propri. Per questo in produzione i file stanno in
// Azure Blob Storage (contenitore PRIVATO: nessun URL pubblico; i file
// escono solo attraverso l'app, che decide chi può vederli).
//
// Configurazione (variabili d'ambiente):
//   AZURE_STORAGE_ACCOUNT            nome dell'account (es. "stspmadhd"): si
//                                    autentica con l'identità gestita della
//                                    Container App (nessuna chiave da gestire).
//                                    Serve il ruolo "Storage Blob Data Contributor"
//                                    sull'account (o sul contenitore).
//   AZURE_STORAGE_CONNECTION_STRING  alternativa (es. per provare in locale
//                                    con Azurite o con una chiave): ha la precedenza.
//   AZURE_STORAGE_CONTAINER          nome del contenitore (default "adhd-coach"),
//                                    da creare in anticipo.
//
// Senza nessuna delle due prime variabili si usa il disco locale
// (server/data/files), comodo in sviluppo; in produzione invece il server
// si rifiuta di partire, per non perdere file in silenzio.
//
// Le "chiavi" dei file sono percorsi tipo "avatars/12-ab34.jpg" o "cv/ab34.pdf".
const fs = require('fs');
const path = require('path');

const CONTAINER = process.env.AZURE_STORAGE_CONTAINER || 'adhd-coach';
const LOCAL_DIR = path.join(__dirname, 'data', 'files');

const useAzure = !!(process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AZURE_STORAGE_ACCOUNT);

if (!useAzure && process.env.NODE_ENV === 'production') {
  throw new Error('Archiviazione file non configurata: imposta AZURE_STORAGE_ACCOUNT (o AZURE_STORAGE_CONNECTION_STRING).');
}

// Accettiamo solo chiavi del tipo "cartella/nomefile.ext" fatte di caratteri
// semplici: impedisce percorsi come "../" qualunque sia l'origine del nome.
const KEY_RX = /^(avatars|cv)\/[A-Za-z0-9_-]+\.[a-z]{3,4}$/;
function checkKey(key) {
  if (!KEY_RX.test(key)) throw new Error(`Chiave file non valida: ${key}`);
}

let _container = null;
function container() {
  if (_container) return _container;
  const { BlobServiceClient } = require('@azure/storage-blob');
  let service;
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    service = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  } else {
    const { DefaultAzureCredential } = require('@azure/identity');
    service = new BlobServiceClient(
      `https://${process.env.AZURE_STORAGE_ACCOUNT}.blob.core.windows.net`,
      new DefaultAzureCredential(),
    );
  }
  _container = service.getContainerClient(CONTAINER);
  return _container;
}

// Controllo all'avvio: il contenitore deve esistere ed essere raggiungibile.
async function check() {
  if (!useAzure) {
    fs.mkdirSync(path.join(LOCAL_DIR, 'avatars'), { recursive: true });
    fs.mkdirSync(path.join(LOCAL_DIR, 'cv'), { recursive: true });
    return;
  }
  if (!(await container().exists())) {
    throw new Error(`Il contenitore Blob "${CONTAINER}" non esiste (o non è accessibile): crealo e assegna il ruolo "Storage Blob Data Contributor".`);
  }
}

async function save(key, buffer, contentType) {
  checkKey(key);
  if (!useAzure) {
    const file = path.join(LOCAL_DIR, key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buffer);
    return;
  }
  await container().getBlockBlobClient(key).uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType || 'application/octet-stream' },
  });
}

// Restituisce { stream, contentType, length } oppure null se il file non esiste.
async function read(key) {
  checkKey(key);
  if (!useAzure) {
    const file = path.join(LOCAL_DIR, key);
    if (!fs.existsSync(file)) return null;
    return { stream: fs.createReadStream(file), contentType: null, length: fs.statSync(file).size };
  }
  try {
    const r = await container().getBlockBlobClient(key).download();
    return { stream: r.readableStreamBody, contentType: r.contentType || null, length: r.contentLength };
  } catch (e) {
    if (e.statusCode === 404) return null;
    throw e;
  }
}

// Cancella un file; se non c'è, non è un errore. Non lancia mai: serve per
// ripulire "al meglio", senza far fallire la richiesta dell'utente.
async function remove(key) {
  try {
    checkKey(key);
    if (!useAzure) { fs.rmSync(path.join(LOCAL_DIR, key), { force: true }); return; }
    await container().getBlockBlobClient(key).deleteIfExists();
  } catch (e) {
    console.error(`Storage: impossibile cancellare ${key}:`, e.message);
  }
}

module.exports = { check, save, read, remove, useAzure };

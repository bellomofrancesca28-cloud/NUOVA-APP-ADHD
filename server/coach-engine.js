// coach-engine.js
// Il "coach" NON è un'intelligenza artificiale generativa: è un motore a
// regole (if/else + espressioni regolari) che sceglie una risposta tra quelle
// scritte qui sotto, in base a parole chiave nel messaggio dell'utente.
// Vantaggi per un MVP clinico: risposte sempre prevedibili e rivedibili da
// voi (psicologhe/psichiatra) una per una, nessun dato inviato a terzi, nessun
// costo per richiesta. Limite: non "capisce" davvero il messaggio, riconosce
// solo pattern testuali — va trattato come un aiuto pratico, non come
// comprensione reale del contenuto.

// ---- 1) Rilevamento di contenuti da NON gestire qui ----
// "Clinico": l'utente chiede diagnosi, farmaci, terapia -> rimandiamo al
// professionista, non tentiamo di rispondere nel merito.
const CLINICAL_RX = /diagnos|sintom|disturbo|ho l.?adhd|sono adhd|farmac|medicin|dosaggi|dose\b|prescri|ritalin|concerta|strattera|atomoxetina|metilfenidato|terapia|terapie|trattamento|curare|psicoterapia|cbt\b/i;

// "Crisi": segnali di rischio immediato. Qui la priorità non è dare consigli
// di organizzazione ma invitare con chiarezza e senza allarmismo a contattare
// una persona reale o un servizio di emergenza. Questa lista va rivista e
// integrata dalla psichiatra del team: è un punto di partenza, non un elenco
// clinicamente validato.
const CRISIS_RX = /suicid|ammazzarmi|farla finita|non voglio pi[uù] vivere|autolesion|farmi del male|tagliarmi|voglio sparire per sempre/i;

const CLINICAL_MSG = "Per questo argomento è importante parlarne con il tuo tutor o con un professionista sanitario qualificato. Io posso aiutarti solo a organizzare meglio la giornata e le attività.";
const CRISIS_MSG = "Quello che mi hai scritto mi fa pensare che tu stia attraversando un momento molto difficile. Non sono lo strumento adatto a gestire questo, e voglio essere onesto invece di provarci comunque: per favore parlane subito con il tuo tutor, con un adulto di cui ti fidi, o contatta un servizio di emergenza. Se sei in pericolo immediato chiama il 112.";

const CATEGORY_LABELS = {
  ORGANIZATION: 'Organizzazione', ROUTINE: 'Routine', STUDY: 'Studio', WORK: 'Lavoro',
  HOME: 'Casa', MICRO_GOALS: 'Micro-obiettivi', DISTRACTIONS: 'Distrazioni',
  MOTIVATION: 'Motivazione', GENERAL: 'Generale',
};

const ENERGY_LINES = {
  LOW: "Visto che l'energia è bassa, scegli la versione più piccola possibile del compito.",
  MEDIUM: "Mantieni il piano breve e visibile.",
  HIGH: "Hai abbastanza spinta: usala per fare un passo in più, senza esaurire tutte le riserve.",
};

// Più varianti per categoria: ne scegliamo una diversa ogni volta (vedi
// pickVariant) così le risposte non sembrano sempre identiche, restando però
// scritte per intero da voi e non generate da un modello esterno.
const TEMPLATES = {
  ORGANIZATION: [
    e => `${e} Dividi tutto in tre colonne: adesso, dopo, non oggi. Metti in "adesso" una sola azione da meno di 10 minuti.`,
    e => `${e} Scrivi le prime tre cose che ti vengono in mente, poi scegline una sola per adesso: le altre due possono aspettare senza sparire.`,
    e => `${e} Prova la regola dei due minuti: se una cosa richiede meno di due minuti, falla subito invece di metterla in lista.`,
  ],
  ROUTINE: [
    e => `${e} Trasforma la routine in una sequenza da tre passi: prepara, fai, chiudi. Scegli un orario e un segnale visibile.`,
    e => `${e} Lega la nuova abitudine a una che già fai automaticamente (es. "dopo colazione" invece di "alle 8:00 precise").`,
    e => `${e} Rendi il primo passo quasi banale: se la routine è "studiare", il primo passo è solo "aprire il quaderno".`,
  ],
  STUDY: [
    e => `${e} Usa un blocco da 20 minuti: apri il materiale, scegli un esercizio, metti via le notifiche e fermati al timer.`,
    e => `${e} Comincia dall'argomento più semplice, non da quello più urgente: partire aiuta più che scegliere "bene".`,
    e => `${e} Prova a spiegare ad alta voce quello che hai appena letto: se ti blocchi, hai trovato il punto su cui rileggere.`,
  ],
  WORK: [
    e => `${e} Identifica il task più importante e stima il tempo realistico. Apri solo gli strumenti necessari, chiudi le notifiche e lavora in blocchi da 25 minuti con pausa obbligatoria.`,
    e => `${e} Scrivi il risultato concreto che vuoi ottenere in questo blocco di lavoro, non solo il nome del progetto: aiuta a sapere quando fermarsi.`,
    e => `${e} Se il task è troppo grande, individua solo il primo output intermedio (es. una bozza, non il documento finito).`,
  ],
  HOME: [
    e => `${e} Scegli una sola cosa da fare in casa adesso: deve richiedere meno di 10 minuti. Prepara l'occorrente e metti un timer.`,
    e => `${e} Lavora per stanza, non per categoria: finisci prima una superficie visibile, l'effetto immediato aiuta a continuare.`,
    e => `${e} Metti un timer di 10 minuti e fai il più possibile: quando suona puoi fermarti senza sensi di colpa.`,
  ],
  MICRO_GOALS: [
    e => `${e} Riscrivi l'obiettivo come primo movimento fisico concreto. Se parte il primo passo, il resto diventa meno pesante.`,
    e => `${e} Chiediti: "qual è la versione più piccola e imbarazzante di questo obiettivo che posso fare adesso?" Parti da lì.`,
    e => `${e} Dai all'obiettivo un verbo d'azione preciso (aprire, scrivere, chiamare) invece di uno vago come "fare" o "gestire".`,
  ],
  DISTRACTIONS: [
    e => `${e} Riduci una distrazione alla volta: telefono fuori portata, una scheda aperta, timer breve. Non serve forza di volontà infinita, serve meno attrito attorno al compito.`,
    e => `${e} Prova a nominare la distrazione prima di cederle: a volte basta accorgersene per riprendere il compito.`,
    e => `${e} Metti il telefono in un'altra stanza per la durata di un solo blocco timer, non per tutto il giorno: è più sostenibile.`,
  ],
  MOTIVATION: [
    e => `${e} Non aspettare di sentirti motivato. Scegli una partenza ridicola ma reale: due minuti, una riga, un oggetto spostato. Dopo decidi se continuare.`,
    e => `${e} La motivazione spesso arriva dopo aver iniziato, non prima: il compito è solo iniziare, non "avere voglia".`,
    e => `${e} Pensa a come ti sentirai tra un'ora se avrai fatto anche solo il primo passo: usa quella immagine come spinta minima.`,
  ],
  GENERAL: [
    e => `${e} Scegli una sola attività utile per i prossimi 10 minuti. Scrivila con un verbo concreto e togli una distrazione dall'ambiente.`,
    e => `${e} Riduci quello che hai scritto a una sola azione immediata: il resto può aspettare il prossimo passo.`,
  ],
};

const CLOSING = "\n\nPosso aiutarti a trasformarlo in una mini-lista da 3 passi.";

const CATEGORY_MATCHERS = [
  ['ORGANIZATION', /organizz|ordine|zaino|agenda|pianific|scaden/i],
  ['ROUTINE', /routine|abitudin|mattina|sera|dormire|svegl/i],
  ['STUDY', /studio|studiare|compit|verifica|interrogazione|scuola/i],
  ['WORK', /lavoro|lavorare|riunione|email|progetto|cliente|ufficio|deadline/i],
  ['HOME', /casa|cucina|pulizie|spesa|commissioni|faccende/i],
  ['MICRO_GOALS', /obiettivo|passo|iniziare|piccolo|micro/i],
  ['DISTRACTIONS', /distraz|telefono|notific|social|concentr/i],
  ['MOTIVATION', /motiv|non ho voglia|blocc|fatica|rimand/i],
];

// Rimuove gli accenti (dopo aver "scomposto" le lettere accentate in
// lettera + segno diacritico con NFD) cosi' il riconoscimento delle parole
// chiave funziona sia che l'utente scriva "perche'" sia "perché".
const COMBINING_MARKS_RX = new RegExp('[̀-ͯ]', 'g');
function normalize(t) {
  return t.normalize('NFD').replace(COMBINING_MARKS_RX, '').toLowerCase();
}

function inferCategory(msg, area) {
  if (area && TEMPLATES[area]) return area;
  for (const [cat, rx] of CATEGORY_MATCHERS) if (rx.test(msg)) return cat;
  return 'GENERAL';
}

function pickVariant(category, seed) {
  const variants = TEMPLATES[category];
  return variants[seed % variants.length];
}

// `usageCount` (quante volte questo utente ha già chiesto qualcosa in questa
// categoria) è usato solo per far ruotare le varianti, non viene mai mostrato
// all'utente né al terapeuta.
function respond({ message, area, energy, usageCount }) {
  const normalized = normalize(message || '');
  if (CRISIS_RX.test(normalized)) {
    return { blocked: true, category: 'CRISIS', label: 'Messaggio non gestito qui', text: CRISIS_MSG };
  }
  if (CLINICAL_RX.test(normalized)) {
    return { blocked: true, category: 'CLINICAL', label: 'Contenuto bloccato', text: CLINICAL_MSG };
  }
  const category = inferCategory(normalized, area);
  const energyLine = ENERGY_LINES[energy] || ENERGY_LINES.MEDIUM;
  const template = pickVariant(category, usageCount || 0);
  return { blocked: false, category, label: `Categoria: ${CATEGORY_LABELS[category]}`, text: template(energyLine) + CLOSING };
}

module.exports = { respond, CATEGORY_LABELS, normalize, inferCategory, CLINICAL_RX, CRISIS_RX };

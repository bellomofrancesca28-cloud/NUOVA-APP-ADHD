// app.js — logica dell'interfaccia: stato in memoria della pagina corrente,
// navigazione tra le "pagine" (sezioni della stessa pagina HTML che si
// mostrano/nascondono), e tutte le chiamate all'API per leggere/scrivere dati
// reali (vedi api.js). Questo sostituisce gli array finti del prototipo.

const EMOJI_OPTIONS = ['🦊','🐢','🦉','🐝','🌟','🚀','🎨','🎧','🌊','🔥','🍃','🐨'];
const CAT_CLASS = { Routine:'agenda-cat-routine', Scuola:'agenda-cat-scuola', Focus:'agenda-cat-focus', Energia:'agenda-cat-energia', Lavoro:'agenda-cat-lavoro', Casa:'agenda-cat-casa', Benessere:'agenda-cat-benessere' };
const STATUS_LABEL = { done:'Fatta', active:'In corso', todo:'Da fare' };
const ROUTINE_CATEGORY = { teen:'Routine', adult:'Lavoro' };
const CAPACITY_HINTS = {
  bassa:'Energia e focus bassi oggi: partiamo dalle attività più leggere.',
  media:'Energia nella media: un mix equilibrato va bene.',
  alta:'Hai buona energia e focus: puoi affrontare anche qualcosa di più impegnativo.',
};

const state = {
  user: null,
  therapistLink: null,
  categories: [],
  agendaDate: null,
  agendaItems: [],
  todayState: { energy: 50, focus: 50, stress: 50, sleep: 50 },
  summary: null,
  therapistPatients: [],
  currentTherapistChatPatientId: null,
  currentTherapistChatPatientName: null,
};

/* ========================= BOOT / AUTH ========================= */
async function boot() {
  try {
    const me = await api.get('/api/auth/me');
    state.user = me.user;
    state.therapistLink = me.therapistLink;
    if (state.user.role === 'patient' && !state.therapistLink) {
      if (me.pendingTherapistRequest) showPairingWaiting(me.pendingTherapistRequest);
      else showPairing();
    } else if (state.user.role === 'parent') {
      await showParentLinkIfNeeded();
    } else {
      await enterApp();
    }
  } catch (e) {
    showAuth();
  }
}

function showAuth() {
  document.getElementById('view-auth').style.display = 'flex';
  document.getElementById('view-pairing').style.display = 'none';
  document.getElementById('view-pairing-waiting').style.display = 'none';
  document.getElementById('view-parent-link').style.display = 'none';
  document.getElementById('view-notifications').style.display = 'none';
  document.getElementById('view-consent').style.display = 'none';
  document.getElementById('view-goals').style.display = 'none';
  document.getElementById('app-root').style.display = 'none';
}

function showAuthTab(tab) {
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
  document.getElementById('form-login').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('form-register').style.display = tab === 'register' ? 'block' : 'none';
}

// Il selettore in registrazione ha 4 opzioni ("14-17", ">18", "Genitore",
// "Terapeuta"): le prime due sono entrambe pazienti, cambia solo la fascia
// d'età; le altre due sono ruoli a sé. registerChoice tiene la scelta grezza
// del pulsante, registerRole/registerAgeRange quella effettiva da mandare al server.
let registerChoice = 'teen';
let registerRole = 'patient';
let registerAgeRange = 'teen';
function setRegisterRole(choice) {
  registerChoice = choice;
  registerRole = (choice === 'teen' || choice === 'adult') ? 'patient' : choice;
  registerAgeRange = (choice === 'teen' || choice === 'adult') ? choice : null;
  ['teen', 'adult', 'parent', 'therapist'].forEach(c => {
    document.getElementById('role-btn-' + c).classList.toggle('active', c === choice);
  });
  ['specialty', 'bio', 'cv'].forEach(f => {
    document.getElementById('reg-' + f + '-group').style.display = choice === 'therapist' ? 'block' : 'none';
  });
  ['birth', 'phone'].forEach(f => {
    document.getElementById('reg-' + f + '-group').style.display = choice === 'therapist' ? 'none' : 'block';
  });
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  try {
    const data = await api.post('/api/auth/login', { email, password });
    state.user = data.user;
    const me = await api.get('/api/auth/me');
    state.therapistLink = me.therapistLink;
    if (state.user.role === 'patient' && !state.therapistLink) {
      if (me.pendingTherapistRequest) showPairingWaiting(me.pendingTherapistRequest);
      else showPairing();
    }
    else if (state.user.role === 'parent') await showParentLinkIfNeeded();
    else await enterApp();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

async function doRegister() {
  const errEl = document.getElementById('register-error');
  errEl.textContent = '';
  const payload = {
    role: registerRole,
    name: document.getElementById('reg-name').value.trim(),
    email: document.getElementById('reg-email').value.trim(),
    password: document.getElementById('reg-password').value,
  };
  if (registerRole !== 'therapist') {
    payload.birthDate = document.getElementById('reg-birth').value;
    payload.phone = document.getElementById('reg-phone').value.trim();
    if (!payload.birthDate || !payload.phone) { errEl.textContent = 'Inserisci data di nascita e numero di cellulare.'; return; }
  }
  if (registerRole === 'patient') payload.ageRange = registerAgeRange;
  else if (registerRole === 'therapist') {
    payload.specialty = document.getElementById('reg-specialty').value.trim();
    payload.bio = document.getElementById('reg-bio').value.trim();
    if (!payload.specialty || !payload.bio) { errEl.textContent = 'Compila specializzazione e breve descrizione.'; return; }
    const cvFile = document.getElementById('reg-cv').files[0];
    if (!cvFile) { errEl.textContent = 'Carica il tuo CV in formato PDF.'; return; }
    if (cvFile.type !== 'application/pdf') { errEl.textContent = 'Il CV deve essere un file PDF.'; return; }
    if (cvFile.size > 3 * 1024 * 1024) { errEl.textContent = 'CV troppo grande: massimo 3MB.'; return; }
    payload.cvBase64 = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Non riesco a leggere il file.'));
      r.readAsDataURL(cvFile);
    });
  }

  try {
    const data = await api.post('/api/auth/register', payload);
    if (data.pendingApproval) {
      // Nuovo tutor: l'account viene attivato solo dopo l'approvazione via email.
      document.getElementById('form-register').style.display = 'none';
      document.getElementById('register-pending').style.display = 'block';
      return;
    }
    state.user = data.user;
    state.therapistLink = null;
    showNotificationsPrefs();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

/* ========================= NOTIFICHE (subito dopo la registrazione) ========================= */
function showNotificationsPrefs() {
  document.getElementById('view-auth').style.display = 'none';
  document.getElementById('view-pairing').style.display = 'none';
  document.getElementById('view-pairing-waiting').style.display = 'none';
  document.getElementById('view-parent-link').style.display = 'none';
  document.getElementById('app-root').style.display = 'none';
  document.getElementById('view-notifications').style.display = 'flex';
}

async function saveNotificationsPrefs() {
  const payload = {
    push: document.getElementById('notif-push').checked,
    email: document.getElementById('notif-email').checked,
    reminders: document.getElementById('notif-reminders').checked,
  };
  try { await api.put('/api/profile/notifications', payload); } catch (e) { /* non blocchiamo l'accesso per un errore qui */ }
  document.getElementById('view-notifications').style.display = 'none';
  showConsentScreen();
}

/* ========================= PRIVACY E CONSENSO INFORMATO (subito dopo, una sola volta) ========================= */
function showConsentScreen() {
  document.getElementById('view-notifications').style.display = 'none';
  document.getElementById('consent-privacy').checked = false;
  document.getElementById('consent-informed').checked = false;
  document.getElementById('consent-error').textContent = '';
  updateConsentButton();
  document.getElementById('view-consent').style.display = 'flex';
}

function updateConsentButton() {
  const ok = document.getElementById('consent-privacy').checked && document.getElementById('consent-informed').checked;
  document.getElementById('consent-continue-btn').disabled = !ok;
}

async function submitConsent() {
  const errEl = document.getElementById('consent-error');
  errEl.textContent = '';
  const payload = {
    privacy: document.getElementById('consent-privacy').checked,
    consent: document.getElementById('consent-informed').checked,
  };
  try {
    await api.put('/api/profile/consent', payload);
  } catch (e) {
    errEl.textContent = e.message;
    return;
  }
  document.getElementById('view-consent').style.display = 'none';
  document.getElementById('view-goals').style.display = 'none';
  if (state.user.role === 'patient') showGoalsScreen();
  else if (state.user.role === 'parent') await showParentLinkIfNeeded();
  else await enterApp();
}

/* ========================= OBIETTIVI (subito dopo, solo pazienti) ========================= */
function showGoalsScreen() {
  document.getElementById('view-consent').style.display = 'none';
  document.getElementById('view-goals').style.display = 'none';
  document.querySelectorAll('#view-goals .goal-option').forEach(cb => cb.checked = false);
  document.getElementById('view-goals').style.display = 'flex';
}

async function submitGoals() {
  const goals = [...document.querySelectorAll('#view-goals .goal-option:checked')].map(cb => cb.value);
  try { await api.put('/api/profile/goals', { goals }); } catch (e) { /* non blocchiamo l'accesso per un errore qui */ }
  document.getElementById('view-goals').style.display = 'none';
  showPairing();
}

async function doLogout() {
  try { await api.post('/api/auth/logout'); } catch (e) {}
  window.location.reload();
}

/* ========================= PAIRING (solo pazienti) ========================= */
async function showPairing() {
  document.getElementById('view-auth').style.display = 'none';
  document.getElementById('view-pairing-waiting').style.display = 'none';
  document.getElementById('view-notifications').style.display = 'none';
  document.getElementById('view-consent').style.display = 'none';
  document.getElementById('view-goals').style.display = 'none';
  document.getElementById('app-root').style.display = 'none';
  document.getElementById('view-pairing').style.display = 'flex';
  const errEl = document.getElementById('pairing-error');
  errEl.textContent = '';
  try {
    const { therapists } = await api.get('/api/therapists');
    const list = document.getElementById('pairing-list');
    list.innerHTML = '';
    if (!therapists.length) {
      list.innerHTML = '<p class="empty-hint">Nessun tutor disponibile al momento. Puoi comunque provare l\'assegnazione casuale più tardi, oppure chiedere a chi gestisce l\'app di aggiungerne uno.</p>';
      return;
    }
    therapists.forEach(t => {
      const card = document.createElement('div');
      card.className = 'therapist-pick-card';
      // La foto vera (se caricata dal tutor) ha sempre la precedenza
      // sull'emoji: è quello che rende il profilo riconoscibile a colpo
      // d'occhio quando il paziente sta scegliendo.
      const avatarHtml = t.avatar_photo
        ? `<img src="${escapeHtml(t.avatar_photo)}" alt="">`
        : escapeHtml(t.avatar || '🧑‍⚕️');
      card.innerHTML = `
        <div class="therapist-pick-head">
          <div class="therapist-pick-avatar">${avatarHtml}</div>
          <div>
            <div class="therapist-pick-name">${escapeHtml(t.name)}</div>
            ${t.specialty ? `<div class="therapist-pick-specialty">${escapeHtml(t.specialty)}</div>` : ''}
          </div>
        </div>
        ${t.bio ? `<div class="therapist-pick-bio">${escapeHtml(t.bio)}</div>` : ''}`;
      card.onclick = () => choosePairing(t.id);
      list.appendChild(card);
    });
  } catch (e) {
    errEl.textContent = e.message;
  }
}

// La richiesta NON collega subito: resta "in attesa" finché il tutor non la
// accetta dalla sua pagina. Mostriamo quindi la schermata di attesa invece di
// entrare direttamente nell'app.
async function choosePairing(therapistId) {
  const errEl = document.getElementById('pairing-error');
  try {
    const data = await api.post('/api/therapists/pair', { therapistId });
    showPairingWaiting(data.request);
  } catch (e) {
    errEl.textContent = e.message;
  }
}

async function pairRandom() {
  const errEl = document.getElementById('pairing-error');
  try {
    const data = await api.post('/api/therapists/pair', { random: true });
    showPairingWaiting(data.request);
  } catch (e) {
    errEl.textContent = e.message;
  }
}

async function pairByCode() {
  const errEl = document.getElementById('pairing-error');
  errEl.textContent = '';
  const code = document.getElementById('pairing-code').value.trim();
  if (!code) { errEl.textContent = 'Inserisci il codice.'; return; }
  try {
    const data = await api.post('/api/therapists/pair', { code });
    showPairingWaiting(data.request);
  } catch (e) {
    errEl.textContent = e.message;
  }
}

function showPairingWaiting(request) {
  document.getElementById('view-auth').style.display = 'none';
  document.getElementById('view-pairing').style.display = 'none';
  document.getElementById('view-parent-link').style.display = 'none';
  document.getElementById('view-notifications').style.display = 'none';
  document.getElementById('view-consent').style.display = 'none';
  document.getElementById('view-goals').style.display = 'none';
  document.getElementById('app-root').style.display = 'none';
  document.getElementById('view-pairing-waiting').style.display = 'flex';
  document.getElementById('pairing-waiting-name').textContent = (request && request.therapist_name) || 'il tutor scelto';
  document.getElementById('pairing-waiting-error').textContent = '';
  // Segnamo che l'utente ha visto la schermata di attesa: al prossimo avvio
  // dell'app, se nel frattempo il tutor ha accettato, mostreremo un avviso di
  // conferma nella dashboard invece di entrare in silenzio.
  localStorage.setItem('pendingTutorNotify', '1');
}

async function cancelPairingRequest() {
  const errEl = document.getElementById('pairing-waiting-error');
  errEl.textContent = '';
  try {
    await api.del('/api/therapists/pair');
    localStorage.removeItem('pendingTutorNotify');
    showPairing();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

/* ========================= COLLEGAMENTO GENITORE-FIGLIO/A ========================= */
// Se il genitore non ha ancora nessun figlio/a collegato, mostriamo la
// schermata per inserire il codice invece di entrare subito nell'app.
async function showParentLinkIfNeeded() {
  const { children } = await api.get('/api/family/children');
  state.children = children;
  if (!children.length) {
    showParentLink();
  } else {
    await enterApp();
  }
}

function showParentLink() {
  document.getElementById('view-auth').style.display = 'none';
  document.getElementById('view-pairing').style.display = 'none';
  document.getElementById('view-pairing-waiting').style.display = 'none';
  document.getElementById('view-notifications').style.display = 'none';
  document.getElementById('view-consent').style.display = 'none';
  document.getElementById('view-goals').style.display = 'none';
  document.getElementById('app-root').style.display = 'none';
  document.getElementById('view-parent-link').style.display = 'flex';
  document.getElementById('parent-link-error').textContent = '';
  document.getElementById('parent-link-code').value = '';
}

async function submitParentLinkCode() {
  const errEl = document.getElementById('parent-link-error');
  errEl.textContent = '';
  const code = document.getElementById('parent-link-code').value.trim();
  if (!code) { errEl.textContent = 'Inserisci il codice.'; return; }
  try {
    await api.post('/api/family/link', { code });
    const { children } = await api.get('/api/family/children');
    state.children = children;
    await enterApp();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

/* ========================= INGRESSO NELL'APP ========================= */
async function enterApp() {
  document.getElementById('view-auth').style.display = 'none';
  document.getElementById('view-pairing').style.display = 'none';
  document.getElementById('view-pairing-waiting').style.display = 'none';
  document.getElementById('view-parent-link').style.display = 'none';
  document.getElementById('view-notifications').style.display = 'none';
  document.getElementById('view-consent').style.display = 'none';
  document.getElementById('view-goals').style.display = 'none';
  document.getElementById('app-root').style.display = 'flex';

  applyRoleVisibility();
  renderAllAvatars();
  buildMobileBar();
  updateTimerDisplay();

  const displayName = state.user.nickname || state.user.name;
  document.getElementById('acct-name-el').textContent = displayName;
  document.getElementById('dd-name').textContent = displayName;
  document.getElementById('dd-role').textContent = state.user.role === 'therapist' ? (state.user.specialty || 'Tutor') : (state.user.role === 'parent' ? 'Genitore' : (state.user.job || 'Utente'));

  if (state.user.role === 'therapist') startRequestsPolling();
  else clearInterval(requestsPollTimer);

  if (state.user.role === 'patient') {
    document.getElementById('home-greeting').textContent = `Ciao ${displayName}.`;
    document.getElementById('home-sub').textContent = "Bentornato/a: qui trovi il Coach IA, l'agenda e la tua dashboard.";
    // Se avevamo lasciato l'utente sulla schermata "in attesa" e nel frattempo
    // il tutor ha accettato, mostriamo un avviso una tantum invece di entrare
    // in silenzio: è il nostro "notifica dentro l'app".
    const tutorBanner = document.getElementById('tutor-accepted-banner');
    if (localStorage.getItem('pendingTutorNotify') && state.therapistLink) {
      tutorBanner.style.display = 'block';
      localStorage.removeItem('pendingTutorNotify');
    } else {
      tutorBanner.style.display = 'none';
    }
    showWelcomeBackIfNeeded();
  } else if (state.user.role === 'parent') {
    document.getElementById('home-greeting').textContent = `Bentornato/a, ${displayName}.`;
    document.getElementById('home-sub').textContent = 'Qui trovi i tuoi figli/e collegati e quello che condividono.';
  } else {
    document.getElementById('home-greeting').textContent = `Bentornato/a, ${displayName}.`;
    document.getElementById('home-sub').textContent = 'Qui trovi i tuoi utenti in carico e il loro andamento reale.';
  }

  navigateTo('home');
}

function dismissTutorAcceptedBanner() {
  document.getElementById('tutor-accepted-banner').style.display = 'none';
}

function applyRoleVisibility() {
  const role = state.user.role;
  document.querySelectorAll('.role-patient').forEach(el => { el.style.display = role === 'patient' ? '' : 'none'; });
  document.querySelectorAll('.role-therapist').forEach(el => { el.style.display = role === 'therapist' ? '' : 'none'; });
  document.querySelectorAll('.role-parent').forEach(el => { el.style.display = role === 'parent' ? '' : 'none'; });

  if (role === 'patient') {
    const teen = state.user.age_group === 'teen';
    document.getElementById('sidebar-tag').textContent = teen ? 'Area adolescente' : 'Area adulto';
    document.getElementById('nav-section-dashboard').textContent = teen ? 'Adolescente' : 'Adulto';
    document.getElementById('dash-badge').textContent = teen ? 'Adolescente' : 'Adulto';
    document.getElementById('dash-badge').className = 'page-badge' + (teen ? '' : ' page-badge-adult');
    document.getElementById('calendario-badge').className = 'page-badge' + (teen ? '' : ' page-badge-adult');
    document.getElementById('attivita-badge').className = 'page-badge' + (teen ? '' : ' page-badge-adult');
    document.getElementById('checkin-badge').className = 'page-badge' + (teen ? '' : ' page-badge-adult');
    document.getElementById('statistiche-badge').className = 'page-badge' + (teen ? '' : ' page-badge-adult');
    document.getElementById('revisione-badge').className = 'page-badge' + (teen ? '' : ' page-badge-adult');
    document.getElementById('dash-checkin-btn').className = 'btn ' + (teen ? 'btn-primary' : 'btn-adult');
    document.getElementById('attivita-add-btn').className = 'btn ' + (teen ? 'btn-primary' : 'btn-adult');
    document.getElementById('dash-subtab-bar').className = 'subtab-bar' + (teen ? '' : ' adult');
    document.querySelectorAll('.progress-fill').forEach(el => el.classList.toggle('progress-fill-adult', !teen));
    document.querySelectorAll('.progress-range').forEach(el => el.classList.toggle('progress-range-adult', !teen));
    state.categories = teen ? ['Routine','Scuola','Focus','Energia'] : ['Lavoro','Casa','Benessere'];
    document.getElementById('messaggi-title').textContent = state.therapistLink ? `Note per ${state.therapistLink.therapist_name}` : 'Note';
    // Per gli account minorenni il codice per i genitori non si gestisce più
    // dal profilo del ragazzo/a: lo genera e lo condivide il tutor dalla sua
    // pagina (vedi loadTherapistPatientDetail). Per gli adulti resta invariato.
    document.getElementById('prof-link-code-group').style.display = teen ? 'none' : '';
    document.getElementById('prof-link-code-teen-hint').style.display = teen ? '' : 'none';
  }
}

/* ========================= NAVIGAZIONE ========================= */
const PAGE_LOADERS = {
  profilo: loadProfilePage,
  dashboard: loadDashboardPage,
  calendario: loadCalendarioPage,
  attivita: loadAttivitaPage,
  checkin: loadCheckinPage,
  statistiche: loadStatistichePage,
  revisione: loadRevisionePage,
  messaggi: loadMessagesPage,
  therapist: loadTherapistPage,
  'therapist-review': loadTherapistReviewPage,
  parent: loadParentPage,
  'parent-child': loadParentChildPage,
};

// Un solo pulsante "Dashboard" nel menu, per entrambi i ruoli: per il
// paziente mostra la sua dashboard personale, per il terapeuta mostra
// l'elenco dei pazienti collegati (la sua vera "vista principale").
function resolveHomeTarget() {
  if (!state.user) return 'home';
  if (state.user.role === 'patient') return 'dashboard';
  if (state.user.role === 'parent') return 'parent';
  return 'therapist';
}

function navigate(id) {
  const highlightId = id; // il pulsante di menu da evidenziare resta sempre "Dashboard"
  const actualId = id === 'home' ? resolveHomeTarget() : id;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById('page-' + actualId);
  if (target) target.classList.add('active');
  document.querySelectorAll('.nav-item,.mobile-bar-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll(`[data-page="${highlightId}"]`).forEach(b => b.classList.add('active'));
  // Ogni pagina ha il suo colore pastello di sfondo (definito in CSS via
  // body[data-page="..."]): basta cambiare questo attributo, il resto lo fa
  // il CSS con una piccola dissolvenza.
  document.body.setAttribute('data-page', actualId);
  window.scrollTo(0, 0);
  closeDropdown();
}

function navigateTo(id) {
  navigate(id);
  const actualId = id === 'home' ? resolveHomeTarget() : id;
  if (PAGE_LOADERS[actualId]) PAGE_LOADERS[actualId]();
}

function goToAgenda() {
  switchSubtab('dash', 'agenda', document.querySelector('#dash-subtab-bar .subtab-btn:nth-child(2)'));
}

function toggleAttivitaAddForm() {
  const card = document.getElementById('attivita-add-card');
  const willShow = card.style.display === 'none';
  card.style.display = willShow ? 'block' : 'none';
  if (willShow) {
    const routineCat = ROUTINE_CATEGORY[state.user.age_group];
    const catSelect = document.getElementById('attivita-new-cat');
    catSelect.innerHTML = state.categories.filter(c => c !== routineCat).map(c => `<option value="${c}">${c}</option>`).join('');
    document.getElementById('attivita-new-title').focus();
  }
}
async function submitAttivitaAdd() {
  const time = document.getElementById('attivita-new-time').value || '12:00';
  const titleEl = document.getElementById('attivita-new-title');
  const title = titleEl.value.trim();
  const category = document.getElementById('attivita-new-cat').value;
  if (!title) { titleEl.focus(); return; }
  await api.post('/api/agenda', { date: state.agendaDate, time, title, category });
  titleEl.value = '';
  document.getElementById('attivita-add-card').style.display = 'none';
  await reloadCurrentAgendaView();
}

// Alcune pagine con sotto-schede (es. "dash" -> #page-dashboard, "stats" ->
// #page-statistiche) hanno un nome scheda diverso dal nome della pagina:
// questa mappa tiene il collegamento in un unico posto.
const SCOPE_PAGE_ID = { dash: 'dashboard', stats: 'statistiche' };
function switchSubtab(scope, tab, btn) {
  const pageId = SCOPE_PAGE_ID[scope] || scope;
  document.querySelectorAll('#page-' + pageId + ' .subtab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(scope + '-tab-' + tab).classList.add('active');
  document.querySelectorAll('#page-' + pageId + ' .subtab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function buildMobileBar() {
  const wrap = document.getElementById('mobile-bar-nav');
  wrap.innerHTML = '';
  document.querySelectorAll('.sidebar .nav-item').forEach(navBtn => {
    if (navBtn.style.display === 'none') return;
    const btn = document.createElement('button');
    btn.className = 'mobile-bar-btn' + (navBtn.classList.contains('active') ? ' active' : '');
    btn.setAttribute('data-page', navBtn.getAttribute('data-page'));
    if (navBtn.classList.contains('role-patient')) btn.classList.add('role-patient');
    if (navBtn.classList.contains('role-therapist')) btn.classList.add('role-therapist');
    btn.innerHTML = navBtn.innerHTML;
    btn.onclick = () => navigateTo(navBtn.getAttribute('data-page'));
    wrap.appendChild(btn);
  });
}

/* ========================= DROPDOWN ACCOUNT ========================= */
function toggleDropdown() { document.getElementById('account-dropdown').classList.toggle('open'); }
function closeDropdown() { document.getElementById('account-dropdown').classList.remove('open'); }
document.addEventListener('click', e => { if (!e.target.closest('#account-bar')) closeDropdown(); });

/* ========================= AVATAR / PROFILO ========================= */
function renderAllAvatars() {
  const av = state.user.avatar || '🦊';
  const a = document.getElementById('acct-avatar-wrap'); if (a) a.textContent = av;
  const b = document.getElementById('dropdown-avatar-wrap'); if (b) b.textContent = av;
  const c = document.getElementById('preview-avatar-icon'); if (c) c.textContent = av;
}

function buildEmojiGrid() {
  const grid = document.getElementById('emoji-picker-grid'); if (!grid) return;
  grid.innerHTML = '';
  EMOJI_OPTIONS.forEach(e => {
    const d = document.createElement('div');
    d.className = 'emoji-option' + (state.user.avatar === e ? ' selected' : '');
    d.textContent = e;
    d.onclick = () => { state.user.avatar = e; buildEmojiGrid(); renderAllAvatars(); };
    grid.appendChild(d);
  });
}

function loadProfilePage() {
  buildEmojiGrid();
  renderAllAvatars();
  document.getElementById('prof-name').value = state.user.name || '';
  document.getElementById('prof-nickname').value = state.user.nickname || '';
  if (state.user.role === 'patient') {
    document.getElementById('prof-goal').value = state.user.goal || '';
    document.getElementById('prof-job').value = state.user.job || '';
    loadLinkCodeBox();
  } else if (state.user.role === 'therapist') {
    document.getElementById('prof-specialty').value = state.user.specialty || '';
    document.getElementById('prof-bio').value = state.user.bio || '';
    loadTherapistLinkCodeBox();
    renderProfilePhotoPreview();
  }
}

// Mostra la foto già salvata (se c'è) nel riquadro rotondo del profilo.
function renderProfilePhotoPreview() {
  const img = document.getElementById('prof-photo-preview');
  const hint = document.getElementById('prof-photo-empty-hint');
  if (!img) return;
  if (state.user.avatar_photo) {
    img.src = state.user.avatar_photo;
    img.style.display = 'block';
    hint.style.display = 'none';
  } else {
    img.style.display = 'none';
    hint.style.display = 'block';
  }
}

async function uploadProfilePhoto() {
  const input = document.getElementById('prof-photo-input');
  const errEl = document.getElementById('profile-photo-error');
  errEl.textContent = '';
  const file = input.files && input.files[0];
  if (!file) { errEl.textContent = 'Scegli prima un file immagine.'; return; }
  if (file.size > 3 * 1024 * 1024) { errEl.textContent = 'Immagine troppo grande: massimo 3MB.'; return; }
  try {
    const imageBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Non sono riuscito a leggere il file.'));
      reader.readAsDataURL(file);
    });
    const data = await api.put('/api/profile/photo', { imageBase64 });
    state.user = data.user;
    renderProfilePhotoPreview();
    input.value = '';
    const el = document.getElementById('profile-photo-saved');
    el.style.display = 'block'; setTimeout(() => el.style.display = 'none', 2500);
  } catch (e) {
    errEl.textContent = e.message;
  }
}

async function removeProfilePhoto() {
  const errEl = document.getElementById('profile-photo-error');
  errEl.textContent = '';
  try {
    const data = await api.del('/api/profile/photo');
    state.user = data.user;
    renderProfilePhotoPreview();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

// Il paziente vede qui il proprio codice per farsi collegare da un genitore
// (se non l'ha ancora generato, mostriamo solo il pulsante per crearlo).
function loadLinkCodeBox() {
  const box = document.getElementById('prof-link-code-box');
  if (!box) return;
  if (state.user.link_code) {
    box.textContent = state.user.link_code;
  } else {
    box.textContent = 'Nessun codice generato';
  }
}
async function generateLinkCode() {
  const data = await api.post('/api/family/code', {});
  state.user.link_code = data.code;
  loadLinkCodeBox();
}

// Stesso principio, lato terapeuta: un codice da condividere con un
// paziente che vuole collegarsi direttamente, senza passare dall'elenco.
function loadTherapistLinkCodeBox() {
  const box = document.getElementById('prof-therapist-link-code-box');
  if (!box) return;
  box.textContent = state.user.link_code || 'Nessun codice generato';
}
async function generateTherapistLinkCode() {
  const data = await api.post('/api/therapists/code', {});
  state.user.link_code = data.code;
  loadTherapistLinkCodeBox();
}

async function saveProfile() {
  const payload = {
    name: document.getElementById('prof-name').value.trim(),
    nickname: document.getElementById('prof-nickname').value.trim(),
    avatar: state.user.avatar,
  };
  if (state.user.role === 'patient') {
    payload.goal = document.getElementById('prof-goal').value;
    payload.job = document.getElementById('prof-job').value.trim();
  } else if (state.user.role === 'therapist') {
    payload.specialty = document.getElementById('prof-specialty').value.trim();
    payload.bio = document.getElementById('prof-bio').value.trim();
  }
  const data = await api.put('/api/profile', payload);
  state.user = data.user;
  const displayName = state.user.nickname || state.user.name;
  document.getElementById('acct-name-el').textContent = displayName;
  document.getElementById('dd-name').textContent = displayName;
  renderAllAvatars();
  const el = document.getElementById('profile-saved');
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 2500);
}

/* ========================= TIMER FOCUS ========================= */
const TIMER_RING_CIRCUMFERENCE = 2 * Math.PI * 100;
let timerTotalSeconds = 15*60, timerRemaining = 15*60, timerInterval = null, timerRunning = false;
function updateTimerDisplay() {
  const m = Math.floor(timerRemaining/60), s = timerRemaining%60;
  const displayEl = document.getElementById('timer-display');
  if (displayEl) displayEl.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  const pct = timerTotalSeconds ? timerRemaining/timerTotalSeconds : 0;
  const ring = document.getElementById('timer-ring-fill');
  if (ring) {
    ring.style.strokeDasharray = TIMER_RING_CIRCUMFERENCE;
    ring.style.strokeDashoffset = TIMER_RING_CIRCUMFERENCE * (1 - pct);
  }
}
function setTimerDuration(minutes, btn) {
  if (timerRunning) return;
  timerTotalSeconds = minutes*60;
  timerRemaining = timerTotalSeconds;
  document.querySelectorAll('.timer-preset-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('timer-done-msg').style.display = 'none';
  const ctx = document.getElementById('timer-context');
  if (ctx) ctx.style.display = 'none';
  updateTimerDisplay();
}
function playTimerTone() {
  try {
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine'; o.frequency.value = 550;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime+0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+0.9);
    o.start(); o.stop(ctx.currentTime+0.9);
  } catch (e) {}
}
function toggleTimer() {
  const btn = document.getElementById('timer-start-btn');
  const presets = document.querySelectorAll('.timer-preset-btn');
  if (timerRunning) {
    clearInterval(timerInterval);
    timerRunning = false;
    btn.innerHTML = '<i class="ti ti-player-play"></i>Riprendi';
    presets.forEach(p => p.disabled = false);
    return;
  }
  timerRunning = true;
  btn.innerHTML = '<i class="ti ti-player-pause"></i>Pausa';
  document.getElementById('timer-done-msg').style.display = 'none';
  presets.forEach(p => p.disabled = true);
  timerInterval = setInterval(() => {
    timerRemaining--;
    updateTimerDisplay();
    if (timerRemaining <= 0) {
      clearInterval(timerInterval);
      timerRunning = false;
      btn.innerHTML = '<i class="ti ti-player-play"></i>Avvia';
      presets.forEach(p => p.disabled = false);
      document.getElementById('timer-done-msg').style.display = 'block';
      playTimerTone();
    }
  }, 1000);
}
function resetTimer() {
  clearInterval(timerInterval);
  timerRunning = false;
  timerRemaining = timerTotalSeconds;
  const btn = document.getElementById('timer-start-btn');
  if (btn) btn.innerHTML = '<i class="ti ti-player-play"></i>Avvia';
  document.querySelectorAll('.timer-preset-btn').forEach(p => p.disabled = false);
  const msg = document.getElementById('timer-done-msg'); if (msg) msg.style.display = 'none';
  updateTimerDisplay();
}
function parseStepMinutes(text) {
  const m = text.match(/(\d+)\s*min/i);
  return m ? parseInt(m[1], 10) : 15;
}
function startTimerForStep(minutes, label) {
  navigateTo('timer');
  if (timerRunning) { clearInterval(timerInterval); timerRunning = false; }
  timerTotalSeconds = minutes*60;
  timerRemaining = timerTotalSeconds;
  document.querySelectorAll('.timer-preset-btn').forEach(b => b.classList.toggle('active', parseInt(b.textContent,10) === minutes));
  const ctx = document.getElementById('timer-context');
  const ctxText = document.getElementById('timer-context-text');
  if (ctx && ctxText) { ctx.style.display = 'block'; ctxText.textContent = label; }
  updateTimerDisplay();
  toggleTimer();
}

/* ========================= DASHBOARD (agenda + stato + stats) ========================= */
function todayIso() { return new Date().toISOString().slice(0,10); }

async function loadAgendaAndState() {
  state.agendaDate = todayIso();
  const [agendaRes, stateRes, summaryRes] = await Promise.all([
    api.get('/api/agenda?date=' + state.agendaDate),
    api.get('/api/agenda/state/today?date=' + state.agendaDate),
    api.get('/api/stats/summary'),
  ]);
  state.agendaItems = agendaRes.items;
  state.categories = agendaRes.categories;
  state.todayState = stateRes.state;
  state.summary = summaryRes;
}

async function loadDashboardPage() {
  await loadAgendaAndState();
  const teen = state.user.age_group === 'teen';
  document.getElementById('dash-greeting').textContent = `Ciao, ${state.user.nickname || state.user.name}`;
  document.getElementById('dash-suggested-title').textContent = teen ? 'Attività consigliate' : 'Task prioritari';

  ['energy:energia','focus:focus','stress:stress','sleep:sonno'].forEach(pair => {
    const [key, domId] = pair.split(':');
    const v = state.todayState[key] === null || state.todayState[key] === undefined ? 50 : state.todayState[key];
    document.getElementById('dash-' + domId + '-range').value = v;
    document.getElementById('dash-' + domId + '-val').textContent = v + '%';
    document.getElementById('dash-' + domId + '-fill').style.width = v + '%';
  });

  const catSelect = document.getElementById('dash-new-cat');
  catSelect.innerHTML = state.categories.map(c => `<option value="${c}">${c}</option>`).join('');

  renderGoalCards();
  renderAgendaList();
  renderAgendaPreview();
  renderSuggested();
  renderTodaySummary();
  loadStars();
}

// Stelle giornaliere: totale + ultimi 7 giorni (calcolate dal server).
async function loadStars() {
  try {
    const s = await api.get('/api/agenda/stars');
    document.getElementById('dash-stars-total').textContent = s.total;
    document.getElementById('dash-superstars-total').textContent = s.superStars;
    document.getElementById('dash-superstar-hint').textContent = s.superThisWeek
      ? 'Settimana completa: hai ottenuto la super stella! 🌟'
      : `Completa tutte le attività da lunedì a domenica per ottenere la super stella 🌟 — questa settimana: ${s.weekStars}/7.`;
    const week = document.getElementById('dash-stars-week');
    week.innerHTML = s.week.map(d => {
      const label = new Date(d.date + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'short' });
      return `<div style="text-align:center;font-size:11px;color:var(--muted-fg)"><div style="font-size:22px;${d.star ? '' : 'filter:grayscale(1);opacity:.3'}">⭐</div>${label}</div>`;
    }).join('');
    return s;
  } catch (e) { /* le stelle sono un extra: se falliscono non blocchiamo la pagina */ }
}

// Aggiorniamo subito la UI (senza aspettare la rete) ad ogni movimento dello
// slider, e mandiamo la richiesta al server solo dopo che l'utente ha smesso
// di trascinare per 350ms (debounce): così muovere lo slider resta fluido
// anche se la connessione è lenta.
const sendStateToServer = debounce(async function(vals) {
  try { await api.put('/api/agenda/state/today', { date: state.agendaDate, ...vals }); } catch (e) {}
}, 350);
function onStateSlide() {
  const vals = {
    energy: Number(document.getElementById('dash-energia-range').value),
    focus: Number(document.getElementById('dash-focus-range').value),
    stress: Number(document.getElementById('dash-stress-range').value),
    sleep: Number(document.getElementById('dash-sonno-range').value),
  };
  ['energia','focus','stress','sonno'].forEach((domId, i) => {
    const key = ['energy','focus','stress','sleep'][i];
    document.getElementById('dash-'+domId+'-val').textContent = vals[key] + '%';
    document.getElementById('dash-'+domId+'-fill').style.width = vals[key] + '%';
  });
  state.todayState = vals;
  renderSuggested();
  sendStateToServer(vals);
}

function getCapacityTier(energia, focus) {
  const capacity = (energia + focus) / 2;
  return capacity < 40 ? 'bassa' : (capacity < 70 ? 'media' : 'alta');
}

function estimateEffort(item) {
  const n = (item.steps || []).length;
  if (n >= 3) return 'Alto';
  if (n >= 1) return 'Medio';
  return 'Basso';
}
const EFFORT_RANK = { Basso:1, Medio:2, Alto:3 };

function renderSuggested() {
  const energia = Number(document.getElementById('dash-energia-range').value);
  const focus = Number(document.getElementById('dash-focus-range').value);
  const tier = getCapacityTier(energia, focus);
  document.getElementById('dash-suggested-hint').textContent = CAPACITY_HINTS[tier];

  const todo = state.agendaItems.filter(i => i.status !== 'done').map(i => ({ ...i, effort: estimateEffort(i) }));
  let sorted = [...todo];
  if (tier === 'bassa') sorted.sort((a,b) => EFFORT_RANK[a.effort]-EFFORT_RANK[b.effort]);
  else if (tier === 'alta') sorted.sort((a,b) => EFFORT_RANK[b.effort]-EFFORT_RANK[a.effort]);
  sorted = sorted.slice(0, 6);

  const list = document.getElementById('dash-suggested-list'); list.innerHTML = '';
  if (!sorted.length) { list.innerHTML = '<p class="empty-hint">Nessuna attività ancora in agenda per oggi. Aggiungine una dalla scheda Agenda.</p>'; return; }
  sorted.forEach(item => {
    const fits = tier === 'bassa' ? item.effort === 'Basso' : tier === 'media' ? item.effort !== 'Alto' : true;
    const div = document.createElement('div');
    div.style.cssText = 'border:1px solid var(--border);border-radius:8px;padding:14px' + (fits ? '' : ';opacity:0.55');
    div.innerHTML = `<p style="font-size:13px;font-weight:500">${escapeHtml(item.title)}</p><p style="font-size:11px;color:var(--muted-fg);margin-top:8px">${escapeHtml(item.category)} · Sforzo ${item.effort}</p>`;
    list.appendChild(div);
  });
}

function renderGoalCards() {
  const teen = state.user.age_group === 'teen';
  const container = document.getElementById('dash-goal-cards');
  const color = teen ? 'var(--primary)' : 'hsl(39,81%,45%)';
  const s = state.summary;
  const streak = s.streak;
  const milestone = Math.ceil((streak+1)/5)*5;
  const streakPct = milestone ? Math.round(streak/milestone*100) : 0;
  const rings = s.goalRings;
  container.innerHTML = `
    <div class="goal-ring-card">
      <div class="goal-ring-svg-wrap">${ringSvg(streakPct,color)}<div class="ring-value">${streak}gg</div></div>
      <div class="goal-ring-text"><div class="goal-ring-label">Streak</div><div class="goal-ring-title">${streak} giorni</div><div class="goal-ring-hint">${streak ? `Mancano ${milestone-streak} giorni al traguardo di ${milestone}` : 'Completa un\'attività oggi per iniziare una streak'}</div></div>
    </div>
    <div class="goal-ring-card">
      <div class="goal-ring-svg-wrap">${ringSvg(rings.routine.pct,color)}<div class="ring-value">${rings.routine.done}/${rings.routine.total}</div></div>
      <div class="goal-ring-text"><div class="goal-ring-label">${teen?'Routine oggi':'Task lavoro'}</div><div class="goal-ring-title">${rings.routine.pct}%</div><div class="goal-ring-hint">${rings.routine.total ? (rings.routine.done ? 'In buona strada' : 'Ancora da iniziare') : 'Nessuna voce pianificata oggi'}</div></div>
    </div>
    <div class="goal-ring-card">
      <div class="goal-ring-svg-wrap">${ringSvg(rings.other.pct,color)}<div class="ring-value">${rings.other.done}/${rings.other.total}</div></div>
      <div class="goal-ring-text"><div class="goal-ring-label">${teen?'Attività':'Casa e benessere'}</div><div class="goal-ring-title">${rings.other.pct}%</div><div class="goal-ring-hint">Completate oggi</div></div>
    </div>
    <div class="goal-ring-card">
      <div class="goal-ring-svg-wrap">${ringSvg(100,color)}<div class="ring-value"><i class="ti ti-sparkles" style="font-size:20px;color:${color}"></i></div></div>
      <div class="goal-ring-text"><div class="goal-ring-label">Coach IA</div><div class="goal-ring-title">Sempre disponibile</div><div class="goal-ring-hint">Un aiuto pratico quando serve</div></div>
    </div>`;
}

function renderAgendaPreview() {
  const list = document.getElementById('dash-agenda-preview'); list.innerHTML = '';
  const items = state.agendaItems.slice(0, 3);
  if (!items.length) { list.innerHTML = '<p class="empty-hint">Ancora nessuna voce in agenda per oggi.</p>'; return; }
  items.forEach(item => list.appendChild(agendaRowEl(item, true)));
}

function renderAgendaList() {
  const list = document.getElementById('dash-agenda-list'); list.innerHTML = '';
  if (!state.agendaItems.length) { list.innerHTML = '<p class="empty-hint">Ancora nessuna voce in agenda per oggi. Aggiungine una qui sotto.</p>'; return; }
  state.agendaItems.forEach(item => list.appendChild(agendaRowEl(item, false)));
}

// "opts" permette di riusare questa stessa riga (con l'espansione in piccoli
// passi) anche fuori dalla dashboard di oggi — es. nella pagina Calendario,
// che lavora su una data qualsiasi: basta passare le proprie funzioni di
// ricaricamento/ridisegno invece di quelle di default (pensate per "oggi").
function agendaRowEl(item, compact, opts) {
  const onChange = (opts && opts.onChange) || (() => reloadCurrentAgendaView());
  const onToggleExpand = (opts && opts.onToggleExpand) || renderAgendaList;
  const onStepChange = (opts && opts.onStepChange) || ((itemId) => reloadCurrentAgendaView(true, itemId));

  const wrap = document.createElement('div'); wrap.className = 'agenda-item';
  const done = item.status === 'done';
  const active = item.status === 'active';
  const row = document.createElement('div');
  row.className = 'agenda-row' + (done ? ' agenda-done' : '') + (item._expanded && !compact ? ' expanded' : '');
  const icon = done ? 'ti-circle-check' : (active ? 'ti-player-play-filled' : 'ti-circle');
  const iconColor = done ? 'var(--primary)' : (active ? 'hsl(39,81%,45%)' : 'hsl(214,19%,72%)');
  const doneSteps = (item.steps||[]).filter(s=>s.done).length;
  const stepsBadge = (!compact && item.steps && item.steps.length) ? `<span class="agenda-steps-badge">${doneSteps}/${item.steps.length} passi</span>` : '';
  const expandBtnHtml = compact ? '' : `<button class="agenda-expand-btn" title="Dividi in piccoli passi"><i class="ti ${item._expanded?'ti-chevron-up':'ti-chevron-down'}"></i></button>`;
  row.innerHTML = `
    <span class="agenda-time">${escapeHtml(item.time)}</span>
    <i class="ti ${icon} agenda-icon" style="color:${iconColor}"></i>
    <div class="agenda-info">
      <p style="${done?'text-decoration:line-through;color:var(--muted-fg)':''}">${escapeHtml(item.title)}</p>
      <span>${STATUS_LABEL[item.status]}</span>
    </div>
    ${stepsBadge}
    <span class="agenda-cat ${CAT_CLASS[item.category]||''}">${escapeHtml(item.category)}</span>
    ${expandBtnHtml}`;
  row.addEventListener('click', async (e) => {
    if (e.target.closest('.agenda-expand-btn')) return;
    await api.patch('/api/agenda/' + item.id, { status: done ? 'todo' : 'done' });
    await onChange();
    const stars = await loadStars();
    if (!done) {
      const allDone = state.agendaItems && state.agendaItems.length && state.agendaItems.every(i => i.status === 'done');
      if (allDone && stars && stars.todayStar && stars.superThisWeek) showEncouragement(SUPER_STAR_MESSAGES);
      else showEncouragement(allDone ? ALL_DONE_MESSAGES : TASK_DONE_MESSAGES);
    }
  });
  if (!compact) {
    const expandBtn = row.querySelector('.agenda-expand-btn');
    expandBtn.onclick = (e) => { e.stopPropagation(); item._expanded = !item._expanded; onToggleExpand(); };
  }
  wrap.appendChild(row);

  if (!compact && item._expanded) {
    const panel = document.createElement('div'); panel.className = 'agenda-steps-panel';
    (item.steps||[]).forEach(step => {
      const stepRow = document.createElement('div'); stepRow.className = 'step-row';
      stepRow.innerHTML = `<i class="ti ${step.done?'ti-square-rounded-check step-done':'ti-square-rounded'}"></i><p class="${step.done?'done':''}">${escapeHtml(step.text)}</p><button class="step-timer-btn" title="Avvia timer per questo passo"><i class="ti ti-clock-play"></i></button><i class="ti ti-x step-remove" title="Rimuovi passo"></i>`;
      stepRow.querySelector('i').onclick = async () => { await api.patch(`/api/agenda/${item.id}/steps/${step.id}`, { done: !step.done }); await onStepChange(item.id); };
      stepRow.querySelector('.step-timer-btn').onclick = (e) => { e.stopPropagation(); startTimerForStep(parseStepMinutes(step.text), step.text); };
      stepRow.querySelector('.step-remove').onclick = async () => { await api.del(`/api/agenda/${item.id}/steps/${step.id}`); await onStepChange(item.id); };
      panel.appendChild(stepRow);
    });
    const addRow = document.createElement('div'); addRow.className = 'step-add-row';
    addRow.innerHTML = `<input type="text" placeholder="Aggiungi un piccolo passo..."><button class="btn" style="padding:6px 10px;font-size:12px"><i class="ti ti-plus"></i></button>`;
    const stepInput = addRow.querySelector('input');
    const commitStep = async () => {
      const v = stepInput.value.trim(); if (!v) return;
      await api.post(`/api/agenda/${item.id}/steps`, { text: v });
      await onStepChange(item.id);
    };
    addRow.querySelector('button').onclick = commitStep;
    stepInput.onkeydown = (e) => { if (e.key === 'Enter') commitStep(); };
    panel.appendChild(addRow);
    wrap.appendChild(panel);
  }
  return wrap;
}

// Dopo ogni modifica ricarichiamo i dati dal server (fonte di verità) invece
// di fidarci solo dello stato locale, e ridisegniamo la vista corrente.
async function reloadCurrentAgendaView(keepExpandedId, expandedItemId) {
  const expandedIds = new Set(state.agendaItems.filter(i => i._expanded).map(i => i.id));
  if (keepExpandedId && expandedItemId) expandedIds.add(expandedItemId);
  await loadAgendaAndState();
  state.agendaItems.forEach(i => { if (expandedIds.has(i.id)) i._expanded = true; });
  renderGoalCards();
  renderAgendaList();
  renderAgendaPreview();
  renderSuggested();
  renderTodaySummary();
  // Se siamo sulla pagina Attività, aggiorniamola anche lei.
  if (document.getElementById('page-attivita').classList.contains('active')) renderAttivitaGroups();
}

async function addAgendaItem() {
  const time = document.getElementById('dash-new-time').value || '12:00';
  const titleEl = document.getElementById('dash-new-title');
  const title = titleEl.value.trim();
  const category = document.getElementById('dash-new-cat').value;
  if (!title) { titleEl.focus(); return; }
  await api.post('/api/agenda', { date: state.agendaDate, time, title, category });
  titleEl.value = '';
  titleEl.focus();
  await reloadCurrentAgendaView();
}

// Riepilogo di oggi: cosa è già stato completato, per nome (non solo in
// percentuale) — pensato per dare soddisfazione immediata guardando la
// dashboard, non solo per alimentare i grafici della pagina Statistiche.
function renderTodaySummary() {
  const teen = state.user.age_group === 'teen';
  const routineCat = ROUTINE_CATEGORY[state.user.age_group];
  const routineItems = state.agendaItems.filter(i => i.category === routineCat);
  const activityItems = state.agendaItems.filter(i => i.category !== routineCat);
  const doneRoutine = routineItems.filter(i => i.status === 'done');
  const doneActivity = activityItems.filter(i => i.status === 'done');

  const block = (title, doneList, total) => `
    <div>
      <div class="progress-label"><span>${escapeHtml(title)}</span><span>${doneList.length}/${total} completate</span></div>
      ${doneList.length
        ? `<ul style="list-style:none;margin-top:6px">${doneList.map(i => `<li style="font-size:12px;color:var(--muted-fg);padding:3px 0"><i class="ti ti-circle-check" style="color:${teen ? 'var(--primary)' : 'hsl(39,81%,45%)'};margin-right:6px"></i>${escapeHtml(i.title)}</li>`).join('')}</ul>`
        : '<p class="empty-hint">Ancora nessuna oggi.</p>'}
    </div>`;

  document.getElementById('dash-today-summary').innerHTML =
    block(teen ? 'Routine' : 'Lavoro', doneRoutine, routineItems.length) +
    block(teen ? 'Attività' : 'Casa e benessere', doneActivity, activityItems.length);
}

/* ========================= STATISTICHE (giorno / settimana / mese) ========================= */
// Helper generico per disegnare le barre verticali (riusato per settimana e
// mese: cambiano solo i dati e le etichette, non lo stile).
function renderBarChart(containerId, items, color) {
  const chart = document.getElementById(containerId); chart.innerHTML = '';
  items.forEach((it, i) => {
    const hasValue = it.pct !== null && it.pct !== undefined;
    const pct = hasValue ? it.pct : 0;
    const label = hasValue ? it.pct + '%' : '—';
    const col = document.createElement('div');
    col.className = 'week-bar-col' + (i === items.length - 1 ? ' today' : '');
    col.innerHTML = `<span class="week-bar-pct">${label}</span><div class="week-bar-track"><div class="week-bar-fill" style="height:${pct}%;background:${color}"></div></div><span class="week-bar-label">${escapeHtml(it.label)}</span>`;
    chart.appendChild(col);
  });
}

function renderBreakdownList(containerId, breakdown, color) {
  const el = document.getElementById(containerId); el.innerHTML = '';
  if (!breakdown.length) { el.innerHTML = '<p class="empty-hint">Nessun dato disponibile.</p>'; return; }
  breakdown.forEach(c => {
    const row = document.createElement('div'); row.className = 'cat-breakdown-row';
    row.innerHTML = `<div class="progress-label"><span>${escapeHtml(c.category)}</span><span>${c.done}/${c.total} · ${c.pct}%</span></div><div class="progress-bar"><div class="progress-fill" style="width:${c.pct}%;background:${color}"></div></div>`;
    el.appendChild(row);
  });
}

async function loadStatistichePage() {
  const teen = state.user.age_group === 'teen';
  const color = teen ? 'var(--primary)' : 'hsl(39,81%,45%)';
  document.getElementById('statistiche-badge').className = 'page-badge' + (teen ? '' : ' page-badge-adult');

  const data = await api.get('/api/stats/detailed');
  const weekLabels = ['6gg fa','5gg fa','4gg fa','3gg fa','2gg fa','Ieri','Oggi'];

  document.getElementById('stats-day-pct').textContent = data.day.pct === null ? '—' : data.day.pct + '%';
  renderBreakdownList('stats-day-breakdown', data.day.categoryBreakdown, color);

  document.getElementById('stats-week-avg').textContent = data.week.avgPct === null ? '—' : data.week.avgPct + '%';
  renderBarChart('stats-week-chart', data.week.days.map((d, i) => ({ pct: d.pct, label: weekLabels[i] })), color);
  renderBreakdownList('stats-week-breakdown', data.week.categoryBreakdown, color);

  document.getElementById('stats-month-avg').textContent = data.month.avgPct === null ? '—' : data.month.avgPct + '%';
  renderBarChart('stats-month-chart', data.month.buckets, color);
  renderBreakdownList('stats-month-breakdown', data.month.categoryBreakdown, color);
}

/* ========================= CALENDARIO (impegni su qualsiasi data) ========================= */
function fmtDateHuman(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const isToday = dateStr === todayIso();
  const weekday = d.toLocaleDateString('it-IT', { weekday: 'long' });
  const rest = d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
  return isToday ? `Oggi, ${rest}` : `${weekday.charAt(0).toUpperCase()+weekday.slice(1)}, ${rest}`;
}
function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const offset = (d.getDay() + 6) % 7; // lunedì = 0
  d.setDate(d.getDate() - offset);
  return d;
}
function addDays(date, n) {
  const d = new Date(date); d.setDate(d.getDate() + n); return d;
}
function toDateStr(d) { return d.toISOString().slice(0, 10); }

async function loadCalendarioPage() {
  if (!state.calendarioDate) state.calendarioDate = todayIso();
  const d = new Date(state.calendarioDate + 'T00:00:00');
  state.calendarioMonthYear = d.getFullYear();
  state.calendarioMonthMonth = d.getMonth() + 1;
  await loadCalendarioGiorno();
}

function switchCalendarioTab(tab, btn) {
  switchSubtab('calendario', tab, btn);
  if (tab === 'settimana') loadCalendarioSettimana();
  else if (tab === 'mese') loadCalendarioMese();
}

function calendarioCollegaInfo() {
  const el = document.getElementById('calendario-collega-msg');
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 4000);
}

// ----- Vista Giorno -----
async function loadCalendarioGiorno() {
  document.getElementById('calendario-day-label').textContent = fmtDateHuman(state.calendarioDate);
  document.getElementById('calendario-day-form-desc').textContent = 'Per ' + fmtDateHuman(state.calendarioDate).toLowerCase();
  const catSelect = document.getElementById('calendario-new-cat');
  catSelect.innerHTML = state.categories.map(c => `<option value="${c}">${c}</option>`).join('');
  const res = await api.get('/api/agenda?date=' + state.calendarioDate);
  state.calendarioItems = res.items;
  renderCalendarioGiornoList();
}

function renderCalendarioGiornoList() {
  const list = document.getElementById('calendario-day-list'); list.innerHTML = '';
  if (!state.calendarioItems.length) { list.innerHTML = '<p class="empty-hint">Nessun impegno per questo giorno. Aggiungine uno qui sotto.</p>'; return; }
  const opts = {
    onChange: () => reloadCalendarioGiorno(),
    onToggleExpand: () => renderCalendarioGiornoList(),
    onStepChange: (itemId) => reloadCalendarioGiorno(true, itemId),
  };
  state.calendarioItems.forEach(item => list.appendChild(agendaRowEl(item, false, opts)));
}

async function reloadCalendarioGiorno(keepExpandedId, expandedItemId) {
  const expandedIds = new Set((state.calendarioItems || []).filter(i => i._expanded).map(i => i.id));
  if (keepExpandedId && expandedItemId) expandedIds.add(expandedItemId);
  const res = await api.get('/api/agenda?date=' + state.calendarioDate);
  state.calendarioItems = res.items;
  state.calendarioItems.forEach(i => { if (expandedIds.has(i.id)) i._expanded = true; });
  renderCalendarioGiornoList();
}

// Modulo "Nuovo impegno" condiviso tra la scheda Giorno e la scheda Mese
// (ognuna ha i propri campi nel DOM, identificati da un prefisso diverso, ma
// creano entrambe una voce per lo stesso giorno selezionato).
async function submitCalendarioNewEvent(prefix, afterFn) {
  const time = document.getElementById(prefix + '-time').value || '12:00';
  const titleEl = document.getElementById(prefix + '-title');
  const title = titleEl.value.trim();
  const category = document.getElementById(prefix + '-cat').value;
  const errEl = document.getElementById(prefix + '-error');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  if (!title) { titleEl.focus(); return; }
  if (!category) {
    if (errEl) { errEl.textContent = 'Scegli una categoria prima di aggiungere.'; errEl.style.display = 'block'; }
    return;
  }
  try {
    await api.post('/api/agenda', { date: state.calendarioDate, time, title, category });
    titleEl.value = '';
    titleEl.focus();
    await afterFn();
  } catch (e) {
    console.error('Errore aggiunta impegno calendario:', e);
    if (errEl) { errEl.textContent = e.message || 'Non sono riuscito a salvare l\'impegno. Riprova.'; errEl.style.display = 'block'; }
    else alert(e.message || 'Non sono riuscito a salvare l\'impegno. Riprova.');
  }
}
function addCalendarioEvent() {
  return submitCalendarioNewEvent('calendario-new', reloadCalendarioGiorno);
}
function addCalendarioEventFromMonth() {
  return submitCalendarioNewEvent('calendario-month-new', loadCalendarioMese);
}

function goToCalendarioDay(dateStr) {
  state.calendarioDate = dateStr;
  switchCalendarioTab('giorno', document.querySelector('#calendario-subtab-bar .subtab-btn:nth-child(1)'));
  loadCalendarioGiorno();
}

// ----- Vista Settimana -----
function shiftCalendarioWeek(delta) {
  const monday = mondayOf(state.calendarioDate);
  state.calendarioDate = toDateStr(addDays(monday, delta * 7));
  loadCalendarioSettimana();
}

async function loadCalendarioSettimana() {
  const monday = mondayOf(state.calendarioDate);
  const days = [];
  for (let i = 0; i < 7; i++) days.push(toDateStr(addDays(monday, i)));

  // I conteggi per giorno arrivano dall'endpoint mensile: se la settimana
  // attraversa due mesi, ne servono due. Se la chiamata fallisse, mostriamo
  // comunque i 7 giorni (solo senza il numero di eventi) invece di niente.
  const monthsNeeded = new Set(days.map(d => d.slice(0, 7)));
  const counts = {};
  try {
    for (const ym of monthsNeeded) {
      const [y, m] = ym.split('-').map(Number);
      const res = await api.get(`/api/agenda/month?year=${y}&month=${m}`);
      res.days.forEach(row => { counts[row.item_date] = row; });
    }
  } catch (e) {
    console.error('Impossibile caricare il riepilogo della settimana:', e);
  }

  const list = document.getElementById('calendario-week-list'); list.innerHTML = '';
  days.forEach(dateStr => {
    const info = counts[dateStr];
    const count = info ? info.count : 0;
    const row = document.createElement('div'); row.className = 'activity-row';
    row.style.cursor = 'pointer';
    const isToday = dateStr === todayIso();
    row.innerHTML = `<i class="ti ti-calendar-event" style="color:${isToday ? 'var(--primary)' : 'var(--muted-fg)'}"></i>
      <div class="activity-info"><p>${fmtDateHuman(dateStr)}</p></div>
      <span class="status-badge">${count} ${count === 1 ? 'evento' : 'eventi'}</span>`;
    row.onclick = () => goToCalendarioDay(dateStr);
    list.appendChild(row);
  });
}

// ----- Vista Mese -----
function shiftCalendarioMonth(delta) {
  let m = state.calendarioMonthMonth + delta;
  let y = state.calendarioMonthYear;
  if (m < 1) { m = 12; y -= 1; }
  if (m > 12) { m = 1; y += 1; }
  state.calendarioMonthMonth = m;
  state.calendarioMonthYear = y;
  loadCalendarioMese();
}

// Scegliere un giorno dalla griglia mensile lo evidenzia e aggiorna il
// modulo "Nuovo impegno" qui sotto, restando sulla scheda Mese (per passare
// alla vista dettagliata di quel giorno c'è comunque la scheda Giorno).
function selectCalendarioMonthDay(dateStr) {
  state.calendarioDate = dateStr;
  loadCalendarioMese();
}

async function loadCalendarioMese() {
  const y = state.calendarioMonthYear, m = state.calendarioMonthMonth;
  const monthNames = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  document.getElementById('calendario-month-label').textContent = `${monthNames[m-1]} ${y}`;

  const firstOfMonth = new Date(y, m-1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7; // lunedì = 0

  // Disegniamo subito la griglia con i numeri dei giorni: i puntini che
  // indicano "quel giorno ha impegni" arrivano da una chiamata separata e,
  // se anche quella fallisse, il calendario resta comunque visibile e usabile.
  const grid = document.getElementById('calendario-month-grid'); grid.innerHTML = '';
  ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'].forEach(lbl => {
    const head = document.createElement('div'); head.className = 'calendario-month-head'; head.textContent = lbl;
    grid.appendChild(head);
  });
  for (let i = 0; i < leadingBlanks; i++) grid.appendChild(document.createElement('div'));
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const cell = document.createElement('div');
    cell.className = 'calendario-month-day' + (dateStr === todayIso() ? ' today' : '') + (dateStr === state.calendarioDate ? ' selected' : '');
    cell.dataset.date = dateStr;
    cell.innerHTML = `<span>${day}</span>`;
    cell.onclick = () => selectCalendarioMonthDay(dateStr);
    grid.appendChild(cell);
  }

  // Modulo "Nuovo impegno" agganciato al giorno selezionato nella griglia.
  document.getElementById('calendario-month-form-desc').textContent = 'Per ' + fmtDateHuman(state.calendarioDate).toLowerCase();
  const monthCatSelect = document.getElementById('calendario-month-new-cat');
  monthCatSelect.innerHTML = state.categories.map(c => `<option value="${c}">${c}</option>`).join('');

  try {
    const res = await api.get(`/api/agenda/month?year=${y}&month=${m}`);
    res.days.forEach(row => {
      if (!row.count) return;
      const cell = grid.querySelector(`[data-date="${row.item_date}"]`);
      if (cell && !cell.querySelector('.calendario-month-dot')) {
        cell.insertAdjacentHTML('beforeend', '<i class="calendario-month-dot"></i>');
      }
    });
  } catch (e) {
    console.error('Impossibile caricare il riepilogo del mese:', e);
  }

  // Elenco vero e proprio degli impegni del giorno selezionato (non solo il
  // puntino sulla griglia), con la stessa possibilità di dividerli in passi.
  await loadCalendarioMonthDayList();
}

async function loadCalendarioMonthDayList() {
  document.getElementById('calendario-month-day-label').textContent = fmtDateHuman(state.calendarioDate).toLowerCase();
  const res = await api.get('/api/agenda?date=' + state.calendarioDate);
  state.calendarioMonthDayItems = res.items;
  renderCalendarioMonthDayList();
}

function renderCalendarioMonthDayList() {
  const list = document.getElementById('calendario-month-day-list'); list.innerHTML = '';
  if (!state.calendarioMonthDayItems.length) { list.innerHTML = '<p class="empty-hint">Nessun impegno per questo giorno.</p>'; return; }
  const opts = {
    onChange: () => reloadCalendarioMonthDayList(),
    onToggleExpand: () => renderCalendarioMonthDayList(),
    onStepChange: (itemId) => reloadCalendarioMonthDayList(true, itemId),
  };
  state.calendarioMonthDayItems.forEach(item => list.appendChild(agendaRowEl(item, false, opts)));
}

// Versione "leggera": aggiorna solo l'elenco (fatto/da fare, passi), senza
// dover ridisegnare tutta la griglia del mese ogni volta.
async function reloadCalendarioMonthDayList(keepExpandedId, expandedItemId) {
  const expandedIds = new Set((state.calendarioMonthDayItems || []).filter(i => i._expanded).map(i => i.id));
  if (keepExpandedId && expandedItemId) expandedIds.add(expandedItemId);
  const res = await api.get('/api/agenda?date=' + state.calendarioDate);
  state.calendarioMonthDayItems = res.items;
  state.calendarioMonthDayItems.forEach(i => { if (expandedIds.has(i.id)) i._expanded = true; });
  renderCalendarioMonthDayList();
}

async function loadAttivitaPage() {
  await loadAgendaAndState();
  renderAttivitaGroups();
}
function renderAttivitaGroups() {
  const routineCat = ROUTINE_CATEGORY[state.user.age_group];
  const otherCats = state.categories.filter(c => c !== routineCat);
  const container = document.getElementById('attivita-groups'); container.innerHTML = '';
  const doneClass = state.user.age_group === 'teen' ? 'done-icon' : 'done-icon-adult';
  otherCats.forEach(cat => {
    const items = state.agendaItems.filter(i => i.category === cat);
    const card = document.createElement('div'); card.className = 'card';
    const listId = 'attivita-list-' + cat.replace(/\s/g,'-');
    card.innerHTML = `<div class="card-title">${escapeHtml(cat)}</div><div class="card-desc"></div><div id="${listId}"></div>`;
    container.appendChild(card);
    const listEl = card.querySelector('#'+listId);
    if (!items.length) { listEl.innerHTML = '<p class="empty-hint">Niente qui per oggi.</p>'; return; }
    items.forEach(item => {
      const done = item.status === 'done';
      const row = document.createElement('div'); row.className = 'activity-row';
      row.innerHTML = `<i class="ti ${done?'ti-circle-check '+doneClass:'ti-circle todo-icon'}"></i><div class="activity-info"><p style="${done?'text-decoration:line-through;color:var(--muted-fg)':''}">${escapeHtml(item.title)}</p><span>${escapeHtml(item.time)}</span></div>`;
      row.onclick = async () => { await api.patch('/api/agenda/'+item.id, { status: done?'todo':'done' }); await reloadCurrentAgendaView(); };
      listEl.appendChild(row);
    });
  });
}

/* ========================= CHECK-IN ========================= */
const CHECKIN_FIELDS = {
  teen: [['mood','Umore'],['energy','Energia'],['focus','Focus'],['stress','Stress']],
  adult: [['mood','Umore'],['energy','Energia mentale'],['focus','Focus lavorativo'],['stress','Stress'],['sleep','Qualità del sonno'],['cognitiveLoad','Carico cognitivo']],
};
// Etichette dei campi così come tornano dal database (snake_case), usate dal
// diario condiviso tra vista paziente, terapeuta e genitore.
const DIARY_FIELD_LABELS = { mood: 'Umore', energy: 'Energia', focus: 'Focus', stress: 'Stress', sleep: 'Sonno', cognitive_load: 'Carico cognitivo' };
function moodEmoji(mood) {
  if (mood === null || mood === undefined) return '😐';
  if (mood <= 2) return '😞';
  if (mood <= 4) return '😕';
  if (mood <= 6) return '😐';
  if (mood <= 8) return '🙂';
  return '😄';
}
// Diario dello stato d'animo: un'unica funzione di rendering riusata dalla
// pagina Check-in del paziente, dalla pagina Note del terapeuta e dalla
// pagina del genitore collegato, così l'aspetto resta identico ovunque.
function renderCheckinDiary(container, checkins) {
  container.innerHTML = '';
  if (!checkins.length) { container.innerHTML = '<p class="empty-hint">Ancora nessuna voce nel diario.</p>'; return; }
  checkins.forEach(c => {
    const row = document.createElement('div'); row.className = 'diary-row';
    const metrics = Object.keys(DIARY_FIELD_LABELS)
      .filter(k => c[k] !== null && c[k] !== undefined)
      .map(k => `<span>${DIARY_FIELD_LABELS[k]} <b>${c[k]}/10</b></span>`).join('');
    row.innerHTML = `
      <div class="diary-row-head"><span class="diary-date">${new Date(c.created_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}</span><span class="diary-mood-emoji">${moodEmoji(c.mood)}</span></div>
      <div class="diary-metrics">${metrics}</div>
      ${c.note ? `<p class="diary-note">${escapeHtml(c.note)}</p>` : ''}`;
    container.appendChild(row);
  });
}
async function loadCheckinDiary() {
  const container = document.getElementById('checkin-diary-list');
  try {
    const { checkins } = await api.get('/api/checkins?limit=30');
    renderCheckinDiary(container, checkins);
  } catch (e) {
    console.error('Errore caricamento diario:', e);
    container.innerHTML = `<p class="empty-hint">Non sono riuscito a caricare il diario: ${escapeHtml(e.message || 'errore sconosciuto')}.</p>`;
  }
}
function loadCheckinPage() {
  const teen = state.user.age_group === 'teen';
  document.getElementById('checkin-badge').textContent = teen ? 'Check-in · Adolescente' : 'Check-in · Adulto';
  const fields = CHECKIN_FIELDS[teen ? 'teen' : 'adult'];
  const div = document.getElementById('checkin-fields'); div.innerHTML = '';
  fields.forEach(([key, label]) => {
    const id = 'ci-' + key;
    const d = document.createElement('div');
    d.innerHTML = `<label>${label}</label><div class="range-row"><input type="range" min="1" max="10" value="5" step="1" id="${id}-range" oninput="document.getElementById('${id}-val').textContent=this.value"><span class="range-val" id="${id}-val">5</span></div>`;
    div.appendChild(d);
  });
  document.getElementById('checkin-note').value = '';
  loadCheckinDiary();
}
async function saveCheckin() {
  const teen = state.user.age_group === 'teen';
  const fields = CHECKIN_FIELDS[teen ? 'teen' : 'adult'];
  const payload = { note: document.getElementById('checkin-note').value.trim() };
  fields.forEach(([key]) => { payload[key] = Number(document.getElementById('ci-'+key+'-range').value); });
  await api.post('/api/checkins', payload);
  const el = document.getElementById('checkin-saved');
  el.style.display = 'block'; setTimeout(() => el.style.display = 'none', 2500);
  await loadCheckinDiary();
  showEncouragement(CHECKIN_DONE_MESSAGES);
}

/* ========================= RINFORZI POSITIVI ========================= */
// Piccoli messaggi di incoraggiamento dentro l'app (non notifiche del
// telefono): compaiono per qualche secondo dopo un'azione positiva, e un
// banner gentile accoglie chi manca da qualche giorno.
const TASK_DONE_MESSAGES = [
  'Ottimo, una cosa in meno! 🎉',
  'Bravo/a, ce l\'hai fatta! 💪',
  'Un passo alla volta: stai andando bene. ✨',
  'Fatto! Goditi un attimo di soddisfazione. 🌟',
];
const ALL_DONE_MESSAGES = [
  'Hai completato tutto per oggi: ti sei guadagnato/a una stella! ⭐',
  'Giornata completata, ottimo lavoro: ecco la tua stella! ⭐',
];
const SUPER_STAR_MESSAGES = [
  'Settimana perfetta, da lunedì a domenica! Hai conquistato la SUPER STELLA! 🌟🎉',
];
const CHECKIN_DONE_MESSAGES = [
  'Grazie per esserti fermato/a a osservare come stai. 💚',
  'Check-in salvato: prenderti cura di te conta davvero. 🌱',
  'Bravo/a, ascoltarsi è già un bel passo. ✨',
];
function showEncouragement(messages) {
  if (state.user && state.user.role !== 'patient') return;
  showToast(messages[Math.floor(Math.random() * messages.length)]);
}
function showToast(text) {
  let toast = document.getElementById('encourage-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'encourage-toast';
    toast.className = 'encourage-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 5000);
}

// Il tutor non deve ricaricare la pagina per vedere una nuova richiesta di
// collegamento: ogni 20 secondi controlliamo e, se ce n'è una in più,
// mostriamo un avviso e aggiorniamo l'elenco "Richieste in attesa".
let knownRequestCount = null;
let requestsPollTimer = null;
async function pollTherapistRequests() {
  try {
    const { requests } = await api.get('/api/therapists/requests');
    if (knownRequestCount === null) {
      if (requests.length) showToast(`Hai ${requests.length} richiest${requests.length === 1 ? 'a' : 'e'} di collegamento in attesa. 🔔`);
    } else if (requests.length > knownRequestCount) {
      showToast('Nuova richiesta di collegamento da un utente! 🔔');
    }
    if (knownRequestCount !== requests.length) await loadTherapistRequests();
    knownRequestCount = requests.length;
  } catch (e) { /* silenzioso: riproviamo al prossimo giro */ }
}
function startRequestsPolling() {
  knownRequestCount = null;
  clearInterval(requestsPollTimer);
  pollTherapistRequests();
  requestsPollTimer = setInterval(pollTherapistRequests, 20000);
}
// Se l'utente non apre l'app da 2 o più giorni, al ritorno vede un messaggio
// gentile (senza colpevolizzare). Ricordiamo l'ultimo accesso per utente.
function showWelcomeBackIfNeeded() {
  const banner = document.getElementById('welcome-back-banner');
  if (!banner) return;
  const key = 'lastVisit_' + state.user.id;
  const last = localStorage.getItem(key);
  const today = new Date().toISOString().slice(0, 10);
  banner.style.display = 'none';
  if (last) {
    const days = Math.round((new Date(today) - new Date(last)) / 86400000);
    if (days >= 2) banner.style.display = 'block';
  }
  localStorage.setItem(key, today);
}
function dismissWelcomeBack() {
  document.getElementById('welcome-back-banner').style.display = 'none';
}

/* ========================= COACH ========================= */
// Nota: oggi il Coach IA sceglie tra risposte scritte in anticipo (nessuna vera
// IA generativa collegata). La UI è però una chat vera e propria: quando in
// futuro verrà collegato un modello reale, basterà far rispondere diversamente
// il backend /api/coach/ask — appendCoachMessage('ai', ...) resta identico.
function coachAppendUser(text) {
  const list = document.getElementById('coach-chat-messages');
  const row = document.createElement('div');
  row.className = 'coach-msg-row user';
  row.innerHTML = `<div class="coach-bubble user">${escapeHtml(text)}</div>`;
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
  return row;
}

function coachAppendAi(text, opts) {
  opts = opts || {};
  const list = document.getElementById('coach-chat-messages');
  const row = document.createElement('div');
  row.className = 'coach-msg-row ai';
  const labelHtml = opts.label ? `<div class="coach-bubble-label">${escapeHtml(opts.label)}</div>` : '';
  row.innerHTML = `<div class="coach-avatar${opts.blocked ? ' blocked' : ''}">${opts.blocked ? '⚠️' : '🧠'}</div><div class="coach-bubble ai${opts.blocked ? ' blocked' : ''}">${labelHtml}${escapeHtml(text)}</div>`;
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
  return row;
}

function coachAppendTyping() {
  const list = document.getElementById('coach-chat-messages');
  const row = document.createElement('div');
  row.className = 'coach-msg-row ai';
  row.innerHTML = `<div class="coach-avatar">🧠</div><div class="coach-bubble ai coach-typing"><span class="loading-dot"></span><span class="loading-dot"></span><span class="loading-dot"></span></div>`;
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
  return row;
}

async function askCoach() {
  const input = document.getElementById('coach-msg');
  const msg = input.value.trim(); if (!msg) return;
  const area = document.getElementById('coach-area').value;
  const energy = document.getElementById('coach-energy').value;
  const btn = document.getElementById('coach-btn');

  coachAppendUser(msg);
  input.value = '';
  btn.disabled = true;
  const typingRow = coachAppendTyping();

  try {
    const result = await api.post('/api/coach/ask', { message: msg, area: area || undefined, energy });
    typingRow.remove();
    coachAppendAi(result.text, { label: result.label, blocked: result.blocked });
  } catch (e) {
    typingRow.remove();
    coachAppendAi(e.message, { blocked: true });
  } finally {
    btn.disabled = false;
  }
}

/* ========================= MESSAGGI (paziente) ========================= */
function renderMessageRow(container, m, myRole) {
  const mine = m.sender_role === myRole;
  const row = document.createElement('div'); row.className = 'msg-row' + (mine ? ' msg-mine' : '');
  let senderLabel;
  if (mine) senderLabel = 'Tu';
  else if (m.sender_role === 'therapist') senderLabel = state.therapistLink ? state.therapistLink.therapist_name : 'Tutor';
  else senderLabel = state.currentTherapistChatPatientName || 'Utente';
  row.innerHTML = `<div class="msg-header"><span>${escapeHtml(senderLabel)}</span><span>${new Date(m.created_at).toLocaleString('it-IT')}</span></div><div class="msg-body">${escapeHtml(m.body)}</div>`;
  container.appendChild(row);
}

async function loadMessagesPage() {
  document.getElementById('messaggi-title').textContent = state.therapistLink ? `Note per ${state.therapistLink.therapist_name}` : 'Note';
  const { messages } = await api.get('/api/messages');
  const list = document.getElementById('messages-list'); list.innerHTML = '';
  if (!messages.length) { list.innerHTML = '<p class="empty-hint">Ancora nessuna nota.</p>'; }
  messages.forEach(m => renderMessageRow(list, m, 'patient'));
  document.getElementById('new-msg').value = '';
}
async function sendMsg() {
  const ta = document.getElementById('new-msg'); const txt = ta.value.trim(); if (!txt) return;
  await api.post('/api/messages', { body: txt });
  ta.value = '';
  const el = document.getElementById('msg-sent'); el.style.display = 'block'; setTimeout(() => el.style.display = 'none', 2000);
  await loadMessagesPage();
}

/* ========================= AREA TERAPEUTA ========================= */
async function loadTherapistPage() {
  document.getElementById('therapist-greeting').textContent = `Bentornato/a, ${state.user.nickname || state.user.name}`;
  await loadTherapistRequests();
  const { patients } = await api.get('/api/therapists/patients');
  state.therapistPatients = patients;
  document.getElementById('therapist-count-patients').textContent = patients.length;

  const list = document.getElementById('therapist-patients-list'); list.innerHTML = '';
  if (!patients.length) {
    list.innerHTML = '<p class="empty-hint">Nessun utente ancora collegato al tuo account.</p>';
    document.getElementById('therapist-watch-count').textContent = '0';
    return;
  }

  let watchCount = 0;
  const cards = await Promise.all(patients.map(async p => {
    const data = await api.get('/api/stats/patient/' + p.id);
    if (data.moodTrendInfo.watch) watchCount++;
    return { p, data };
  }));
  document.getElementById('therapist-watch-count').textContent = watchCount;

  cards.forEach(({ p, data }) => {
    const trendVals = data.checkinTrend.length >= 2 ? data.checkinTrend.map(c => c.mood) : data.summary.week.map(w => w.pct);
    const t = data.moodTrendInfo;
    const card = document.createElement('div'); card.className = 'patient-card';
    card.onclick = () => openTherapistChat(p.id, p.nickname || p.name, p.age_group);
    card.innerHTML = `
      <div class="patient-card-head">
        <div><span class="patient-name">${escapeHtml(p.nickname || p.name)}</span> <span class="status-badge" style="font-size:10px">${p.age_group === 'teen' ? 'Teen' : 'Adulto'}</span></div>
        <span class="patient-last-checkin">Collegato dal ${new Date(p.linked_since).toLocaleDateString('it-IT')}</span>
      </div>
      <div class="patient-card-body">
        <div class="patient-sparkline">${sparklineSvg(trendVals, t.trend === 'down' ? 'hsl(39,81%,45%)' : (t.trend === 'up' ? 'var(--primary)' : 'var(--muted-fg)'))}</div>
        <div class="patient-trend-label" style="color:${t.trend==='down'?'hsl(39,81%,45%)':(t.trend==='up'?'var(--primary)':'var(--muted-fg)')}">${t.text}</div>
        <div class="patient-metrics">
          <span>Streak <b>${data.summary.streak}gg</b></span>
          <span>Oggi <b>${data.summary.goalRings.routine.pct}%</b> routine</span>
        </div>
      </div>`;
    list.appendChild(card);
  });
}

// Richieste di collegamento in attesa: il tutor le vede qui e sceglie se
// accettarle (crea davvero il collegamento) o rifiutarle.
async function loadTherapistRequests() {
  const { requests } = await api.get('/api/therapists/requests');
  document.getElementById('therapist-count-requests').textContent = requests.length;
  const card = document.getElementById('therapist-requests-card');
  const list = document.getElementById('therapist-requests-list');
  list.innerHTML = '';
  if (!requests.length) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  requests.forEach(r => {
    const row = document.createElement('div');
    row.className = 'review-slot-row';
    const goalsHtml = (r.goals && r.goals.length)
      ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">${r.goals.map(g => `<span class="badge-effort">${escapeHtml(g)}</span>`).join('')}</div>`
      : '';
    row.innerHTML = `
      <div class="review-slot-info">
        <p>${escapeHtml(r.avatar || '🙂')} ${escapeHtml(r.nickname || r.name)}</p>
        <span>${r.age_group === 'teen' ? 'Teen' : 'Adulto'} · Richiesta del ${new Date(r.created_at).toLocaleDateString('it-IT')}</span>
        ${contactInfoHtml(r)}
        ${goalsHtml}
      </div>
      <div class="review-slot-actions"></div>`;
    const actions = row.querySelector('.review-slot-actions');
    const okBtn = document.createElement('button');
    okBtn.className = 'btn btn-primary btn-sm';
    okBtn.innerHTML = '<i class="ti ti-check"></i>Accetta';
    okBtn.onclick = () => respondTherapistRequest(r.id, 'accept');
    const noBtn = document.createElement('button');
    noBtn.className = 'btn btn-sm';
    noBtn.innerHTML = '<i class="ti ti-x"></i>Rifiuta';
    noBtn.onclick = () => respondTherapistRequest(r.id, 'decline');
    actions.appendChild(okBtn);
    actions.appendChild(noBtn);
    list.appendChild(row);
  });
}

async function respondTherapistRequest(id, action) {
  try {
    await api.post(`/api/therapists/requests/${id}/${action}`);
    await loadTherapistPage();
  } catch (e) {
    alert(/ruolo/.test(e.message)
      ? 'Nel frattempo hai effettuato l\'accesso con un altro account (in un\'altra scheda dello stesso browser). Esci, rientra come tutor e riprova.'
      : e.message);
  }
}

// Dati di contatto dell'utente (data di nascita, email, cellulare) mostrati al
// tutor con cui si collega.
function contactInfoHtml(u) {
  const birth = u.birth_date ? new Date(u.birth_date + 'T12:00:00').toLocaleDateString('it-IT') : '—';
  return `<div style="font-size:12px;color:var(--muted-fg);margin-top:6px;line-height:1.6">
    Nato/a il ${escapeHtml(birth)}<br>Email: ${escapeHtml(u.email || '—')}<br>Cellulare: ${escapeHtml(u.phone || '—')}</div>`;
}

async function openTherapistChat(patientId, displayName, ageGroup) {
  state.currentTherapistChatPatientId = patientId;
  state.currentTherapistChatPatientName = displayName;
  navigateTo('therapist-chat');
  const pInfo = (state.therapistPatients || []).find(p => p.id === patientId);
  document.getElementById('therapist-patient-info').innerHTML = pInfo ? contactInfoHtml(pInfo) : '';
  document.getElementById('therapist-chat-title').textContent = 'Note di ' + displayName;
  const familyCard = document.getElementById('therapist-family-code-card');
  document.getElementById('therapist-family-code-error').textContent = '';
  if (ageGroup === 'teen') {
    familyCard.style.display = 'block';
    await Promise.all([loadTherapistMessages(), loadTherapistPatientDiary(), loadTherapistFamilyCode()]);
  } else {
    familyCard.style.display = 'none';
    await Promise.all([loadTherapistMessages(), loadTherapistPatientDiary()]);
  }
}
// Il tutor vede/genera qui il codice famiglia dei propri utenti minorenni,
// da dare direttamente ai genitori (non compare più nel profilo del minore).
async function loadTherapistFamilyCode() {
  const box = document.getElementById('therapist-family-code-box');
  try {
    const { code } = await api.get('/api/therapists/patients/' + state.currentTherapistChatPatientId + '/family-code');
    box.textContent = code || 'Nessun codice generato';
  } catch (e) {
    document.getElementById('therapist-family-code-error').textContent = e.message;
  }
}
async function generateTherapistFamilyCode() {
  const errEl = document.getElementById('therapist-family-code-error');
  errEl.textContent = '';
  try {
    const { code } = await api.post('/api/therapists/patients/' + state.currentTherapistChatPatientId + '/family-code', {});
    document.getElementById('therapist-family-code-box').textContent = code;
  } catch (e) {
    errEl.textContent = e.message;
  }
}
async function loadTherapistPatientDiary() {
  const container = document.getElementById('therapist-checkin-diary-list');
  try {
    const { checkins } = await api.get('/api/checkins/patient/' + state.currentTherapistChatPatientId);
    renderCheckinDiary(container, checkins);
  } catch (e) {
    console.error('Errore caricamento diario paziente:', e);
    container.innerHTML = `<p class="empty-hint">Non sono riuscito a caricare il diario: ${escapeHtml(e.message || 'errore sconosciuto')}.</p>`;
  }
}
async function loadTherapistMessages() {
  const { messages } = await api.get('/api/messages?patientId=' + state.currentTherapistChatPatientId);
  const list = document.getElementById('therapist-messages-list'); list.innerHTML = '';
  if (!messages.length) { list.innerHTML = '<p class="empty-hint">Ancora nessuna nota.</p>'; }
  messages.forEach(m => renderMessageRow(list, m, 'therapist'));
  document.getElementById('therapist-new-msg').value = '';
}
async function sendTherapistMsg() {
  const ta = document.getElementById('therapist-new-msg'); const txt = ta.value.trim(); if (!txt) return;
  await api.post('/api/messages', { body: txt, patientId: state.currentTherapistChatPatientId });
  ta.value = '';
  const el = document.getElementById('therapist-msg-sent'); el.style.display = 'block'; setTimeout(() => el.style.display = 'none', 2000);
  await loadTherapistMessages();
}

/* ========================= REVISIONE (calendario + videochiamata) ========================= */
const CADENCE_LABEL = { once: 'Una tantum', weekly: 'Settimanale', biweekly: 'Bisettimanale', monthly: 'Mensile' };
const REVIEW_STATUS_LABEL = { proposed: 'In attesa di risposta', confirmed: 'Confermata', declined: 'Rifiutata', cancelled: 'Annullata' };
const REVIEW_STATUS_CLASS = { proposed: 'status-proposed', confirmed: 'status-confirmed', declined: 'status-declined', cancelled: 'status-cancelled' };
const JOIN_WINDOW_BEFORE_MIN = 5;   // si può entrare fino a 5 minuti prima dell'orario previsto
const JOIN_WINDOW_AFTER_MIN = 20;   // ...e fino a 20 minuti dopo, per chi arriva un po' in ritardo

function slotDateTime(slot) {
  return new Date(`${slot.slot_date}T${slot.slot_time}:00`);
}
function formatSlotWhen(slot) {
  const d = slotDateTime(slot);
  const dateStr = d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'long' });
  return `${dateStr}, ${slot.slot_time}`;
}
function isSlotJoinable(slot) {
  if (slot.status !== 'confirmed') return false;
  const start = slotDateTime(slot).getTime();
  const now = Date.now();
  return now >= start - JOIN_WINDOW_BEFORE_MIN * 60000 && now <= start + JOIN_WINDOW_AFTER_MIN * 60000;
}
function isSlotPast(slot) {
  const start = slotDateTime(slot).getTime();
  return Date.now() > start + JOIN_WINDOW_AFTER_MIN * 60000;
}

function reviewSlotRow(slot, { showJoin, showRespond, showCancel, onCancel } = {}) {
  const row = document.createElement('div'); row.className = 'review-slot-row';
  const cadenceText = slot.cadence ? CADENCE_LABEL[slot.cadence] : '';
  row.innerHTML = `
    <div class="review-slot-info">
      <p>${escapeHtml(formatSlotWhen(slot))}</p>
      <span>${cadenceText} · <span class="status-badge ${REVIEW_STATUS_CLASS[slot.status] || ''}">${REVIEW_STATUS_LABEL[slot.status] || slot.status}</span></span>
    </div>
    <div class="review-slot-actions"></div>`;
  const actions = row.querySelector('.review-slot-actions');

  if (showRespond) {
    const okBtn = document.createElement('button'); okBtn.className = 'btn btn-primary btn-sm'; okBtn.innerHTML = '<i class="ti ti-check"></i>Conferma';
    okBtn.onclick = () => respondReviewSlot(slot.id, 'confirmed');
    const noBtn = document.createElement('button'); noBtn.className = 'btn btn-sm'; noBtn.innerHTML = '<i class="ti ti-x"></i>Rifiuta';
    noBtn.onclick = () => respondReviewSlot(slot.id, 'declined');
    actions.appendChild(okBtn); actions.appendChild(noBtn);
  }
  if (showJoin) {
    const joinBtn = document.createElement('button'); joinBtn.className = 'btn btn-primary btn-sm';
    const joinable = isSlotJoinable(slot);
    joinBtn.disabled = !joinable;
    joinBtn.innerHTML = joinable ? '<i class="ti ti-video"></i>Entra in videochiamata' : '<i class="ti ti-clock"></i>Non ancora disponibile';
    joinBtn.onclick = () => openReviewCall(slot.id, state.user.role);
    actions.appendChild(joinBtn);
  }
  if (showCancel) {
    const cancelBtn = document.createElement('button'); cancelBtn.className = 'btn btn-sm'; cancelBtn.innerHTML = '<i class="ti ti-calendar-x"></i>Annulla';
    cancelBtn.onclick = onCancel;
    actions.appendChild(cancelBtn);
  }
  return row;
}

// ----- Vista paziente -----
async function loadRevisionePage() {
  const { slots } = await api.get('/api/reviews');
  const confirmedUpcoming = slots.filter(s => s.status === 'confirmed' && !isSlotPast(s)).sort((a, b) => slotDateTime(a) - slotDateTime(b))[0];
  const pending = slots.filter(s => s.status === 'proposed');
  const rest = slots.filter(s => s !== confirmedUpcoming && s.status !== 'proposed');

  const nextCard = document.getElementById('revisione-next-card');
  const nextEl = document.getElementById('revisione-next');
  if (confirmedUpcoming) {
    nextCard.style.display = 'block';
    nextEl.innerHTML = '';
    nextEl.appendChild(reviewSlotRow(confirmedUpcoming, {
      showJoin: true, showCancel: true,
      onCancel: () => cancelReviewSlot(confirmedUpcoming.id),
    }));
  } else {
    nextCard.style.display = 'none';
  }

  const pendingCard = document.getElementById('revisione-pending-card');
  const pendingEl = document.getElementById('revisione-pending');
  if (pending.length) {
    pendingCard.style.display = 'block';
    pendingEl.innerHTML = '';
    pending.forEach(s => pendingEl.appendChild(reviewSlotRow(s, { showRespond: true })));
  } else {
    pendingCard.style.display = 'none';
  }

  const historyEl = document.getElementById('revisione-history');
  historyEl.innerHTML = '';
  if (!rest.length) { historyEl.innerHTML = '<p class="empty-hint">Ancora nessuna revisione passata.</p>'; }
  rest.slice().reverse().forEach(s => historyEl.appendChild(reviewSlotRow(s, {})));
}

async function respondReviewSlot(id, status) {
  await api.patch('/api/reviews/' + id, { status });
  await loadRevisionePage();
}
async function cancelReviewSlot(id) {
  const patientId = state.user.role === 'therapist' ? state.currentTherapistChatPatientId : undefined;
  await api.patch('/api/reviews/' + id, { status: 'cancelled', patientId });
  await refreshCurrentReviewPage();
}

// ----- Vista terapeuta (per un paziente specifico) -----
async function loadTherapistReviewPage() {
  const name = state.currentTherapistChatPatientName || 'utente';
  document.getElementById('therapist-review-title').textContent = 'Revisione con ' + name;
  const dateInput = document.getElementById('review-new-date');
  if (!dateInput.value) dateInput.value = todayIso();

  const { slots } = await api.get('/api/reviews?patientId=' + state.currentTherapistChatPatientId);
  const confirmedUpcoming = slots.filter(s => s.status === 'confirmed' && !isSlotPast(s)).sort((a, b) => slotDateTime(a) - slotDateTime(b))[0];

  const nextCard = document.getElementById('therapist-next-review-card');
  const nextEl = document.getElementById('therapist-next-review');
  if (confirmedUpcoming) {
    nextCard.style.display = 'block';
    nextEl.innerHTML = '';
    nextEl.appendChild(reviewSlotRow(confirmedUpcoming, {
      showJoin: true, showCancel: true,
      onCancel: () => cancelReviewSlot(confirmedUpcoming.id),
    }));
  } else {
    nextCard.style.display = 'none';
  }

  const listEl = document.getElementById('therapist-review-list');
  listEl.innerHTML = '';
  if (!slots.length) { listEl.innerHTML = '<p class="empty-hint">Non hai ancora proposto nessun orario a questo utente.</p>'; return; }
  slots.slice().reverse().forEach(s => {
    const canCancel = s.status === 'proposed' || s.status === 'confirmed';
    listEl.appendChild(reviewSlotRow(s, canCancel ? { showCancel: true, onCancel: () => cancelReviewSlot(s.id) } : {}));
  });
}

async function proposeReviewSlot() {
  const date = document.getElementById('review-new-date').value;
  const time = document.getElementById('review-new-time').value;
  const cadence = document.getElementById('review-new-cadence').value;
  if (!date || !time) return;
  await api.post('/api/reviews', { patientId: state.currentTherapistChatPatientId, date, time, cadence });
  await loadTherapistReviewPage();
}

// Chiamata da call.js quando una videochiamata finisce, per aggiornare la
// pagina Revisione se è quella che si sta guardando in quel momento.
async function refreshCurrentReviewPage() {
  if (document.getElementById('page-revisione').classList.contains('active')) await loadRevisionePage();
  if (document.getElementById('page-therapist-review').classList.contains('active')) await loadTherapistReviewPage();
}

/* ========================= AREA GENITORE ========================= */
// Elenco dei figli/e collegati. Nella maggior parte dei casi ce n'è uno solo,
// ma la struttura regge anche più di un account collegato allo stesso genitore.
async function loadParentPage() {
  document.getElementById('parent-greeting').textContent = `Bentornato/a, ${state.user.nickname || state.user.name}`;
  const { children } = await api.get('/api/family/children');
  state.children = children;
  const list = document.getElementById('parent-children-list'); list.innerHTML = '';
  if (!children.length) {
    list.innerHTML = '<p class="empty-hint">Nessun account collegato. Chiedi il codice al tutor che segue tuo figlio/a.</p>';
    return;
  }
  children.forEach(c => {
    const card = document.createElement('div'); card.className = 'patient-card';
    card.onclick = () => openParentChild(c.id, c.nickname || c.name);
    card.innerHTML = `
      <div class="patient-card-head">
        <div><span class="patient-name">${escapeHtml(c.avatar || '🦊')} ${escapeHtml(c.nickname || c.name)}</span> <span class="status-badge" style="font-size:10px">${c.age_group === 'teen' ? '14-17' : '>18'}</span></div>
      </div>`;
    list.appendChild(card);
  });
}

async function openParentChild(childId, displayName) {
  state.currentParentChildId = childId;
  state.currentParentChildName = displayName;
  navigateTo('parent-child');
}

async function loadParentChildPage() {
  const data = await api.get('/api/family/children/' + state.currentParentChildId + '/overview');
  document.getElementById('parent-child-title').textContent = data.child.nickname || data.child.name;

  // Agenda di oggi
  const agendaList = document.getElementById('parent-child-agenda'); agendaList.innerHTML = '';
  if (!data.agenda.length) {
    agendaList.innerHTML = '<p class="empty-hint">Nessuna voce in agenda oggi.</p>';
  } else {
    data.agenda.forEach(item => {
      const done = item.status === 'done';
      const row = document.createElement('div'); row.className = 'activity-row';
      row.innerHTML = `<i class="ti ${done ? 'ti-circle-check done-icon' : 'ti-circle todo-icon'}"></i><div class="activity-info"><p style="${done?'text-decoration:line-through;color:var(--muted-fg)':''}">${escapeHtml(item.title)}</p><span>${escapeHtml(item.time)} · ${escapeHtml(item.category)}</span></div>`;
      agendaList.appendChild(row);
    });
  }

  // Statistiche sintetiche (stessa fonte usata nella dashboard del figlio/a)
  const s = data.summary;
  const st = data.stars;
  document.getElementById('parent-child-stars-total').textContent = st.total;
  document.getElementById('parent-child-superstars-total').textContent = st.superStars;
  document.getElementById('parent-child-stars-hint').textContent = st.superThisWeek
    ? 'Settimana completa: super stella ottenuta! 🌟'
    : `Questa settimana: ${st.weekStars}/7 stelle.`;
  document.getElementById('parent-child-stars-week').innerHTML = st.week.map(d => {
    const label = new Date(d.date + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'short' });
    return `<div style="text-align:center;font-size:11px;color:var(--muted-fg)"><div style="font-size:22px;${d.star ? '' : 'filter:grayscale(1);opacity:.3'}">⭐</div>${label}</div>`;
  }).join('');
  document.getElementById('parent-child-streak').textContent = s.streak + ' giorni';
  document.getElementById('parent-child-routine-pct').textContent = s.goalRings.routine.pct + '%';
  document.getElementById('parent-child-other-pct').textContent = s.goalRings.other.pct + '%';

  // Diario dello stato d'animo (stesso rendering condiviso con paziente e terapeuta)
  renderCheckinDiary(document.getElementById('parent-child-checkins'), data.checkins);

  // Note scambiate col terapeuta (visibili al genitore su richiesta esplicita
  // della famiglia — diversamente dal resto dell'app, che le tiene private)
  const msgSection = document.getElementById('parent-child-messages-section');
  const msgList = document.getElementById('parent-child-messages');
  if (!data.therapistLink) {
    msgSection.style.display = 'none';
  } else {
    msgSection.style.display = 'block';
    document.getElementById('parent-child-therapist-name').textContent = data.therapistLink.therapist_name;
    msgList.innerHTML = '';
    if (!data.messages.length) { msgList.innerHTML = '<p class="empty-hint">Ancora nessuna nota.</p>'; }
    data.messages.forEach(m => {
      const row = document.createElement('div'); row.className = 'msg-row';
      const senderLabel = m.sender_role === 'therapist' ? data.therapistLink.therapist_name : (data.child.nickname || data.child.name);
      row.innerHTML = `<div class="msg-header"><span>${escapeHtml(senderLabel)}</span><span>${new Date(m.created_at).toLocaleString('it-IT')}</span></div><div class="msg-body">${escapeHtml(m.body)}</div>`;
      msgList.appendChild(row);
    });
  }
}

/* ========================= AVVIO ========================= */
document.addEventListener('DOMContentLoaded', boot);

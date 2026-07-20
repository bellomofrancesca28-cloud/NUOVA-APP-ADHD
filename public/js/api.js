// api.js — un unico posto che sa come parlare col server (fetch = la funzione
// del browser per fare richieste HTTP). Ogni pagina chiama semplicemente
// api.get(...)/api.post(...) invece di ripetere ovunque i dettagli tecnici.
// "credentials: same-origin" fa sì che il cookie di sessione (vedi
// server/auth-utils.js) venga inviato automaticamente ad ogni richiesta.
const api = (() => {
  async function request(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      credentials: 'same-origin',
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* risposta senza corpo JSON */ }
    if (!res.ok) {
      const message = (data && data.error) || `Errore ${res.status}`;
      throw new Error(message);
    }
    return data;
  }
  return {
    get: (url) => request('GET', url),
    post: (url, body) => request('POST', url, body || {}),
    put: (url, body) => request('PUT', url, body || {}),
    patch: (url, body) => request('PATCH', url, body || {}),
    del: (url) => request('DELETE', url),
  };
})();

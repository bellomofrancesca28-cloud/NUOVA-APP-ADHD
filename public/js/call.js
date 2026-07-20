// call.js — client della videochiamata di Revisione (15 minuti).
//
// Come funziona, in breve: il video/audio viaggiano direttamente tra i due
// browser (tecnologia "WebRTC", non passano dal nostro server). Per riuscire
// a collegarsi, i due browser devono però scambiarsi alcuni messaggi tecnici
// preliminari — questo passa dal "canale di segnalazione" (WebSocket) verso
// server/realtime.js, che fa solo da postino per quei messaggi.
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

let callState = {
  ws: null, pc: null, localStream: null,
  slotId: null, myRole: null, countdownInterval: null,
  micOn: true, camOn: true,
};

function callWsUrl(slotId) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws/review?slotId=${slotId}`;
}

async function openReviewCall(slotId, myRole) {
  const overlay = document.getElementById('call-overlay');
  overlay.style.display = 'flex';
  setCallStatus('Connessione in corso...');
  document.getElementById('call-countdown').textContent = '15:00';
  document.getElementById('call-toggle-mic').classList.remove('call-btn-off');
  document.getElementById('call-toggle-cam').classList.remove('call-btn-off');
  callState.slotId = slotId;
  callState.myRole = myRole;

  try {
    callState.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (e) {
    setCallStatus('Non riesco ad accedere a webcam/microfono: controlla i permessi del browser per questo sito.');
    return;
  }
  document.getElementById('call-local-video').srcObject = callState.localStream;

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  callState.pc = pc;
  callState.localStream.getTracks().forEach(track => pc.addTrack(track, callState.localStream));

  pc.ontrack = (e) => {
    const remoteVideo = document.getElementById('call-remote-video');
    if (remoteVideo.srcObject !== e.streams[0]) remoteVideo.srcObject = e.streams[0];
  };
  pc.onicecandidate = (e) => { if (e.candidate) sendSignal({ kind: 'ice', candidate: e.candidate }); };

  const ws = new WebSocket(callWsUrl(slotId));
  callState.ws = ws;

  ws.onerror = () => setCallStatus('Problema di connessione alla stanza della revisione.');
  ws.onclose = (ev) => { if (ev.code >= 4000) setCallStatus('Connessione chiusa dal server.'); };

  ws.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'peer-joined') {
      setCallStatus("L'altra persona è entrata, mi sto collegando...");
      if (callState.myRole === 'patient' && pc.signalingState === 'stable') {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal({ kind: 'sdp', sdp: pc.localDescription });
      }
    } else if (msg.type === 'signal') {
      const payload = msg.payload;
      if (payload.kind === 'sdp') {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        if (payload.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal({ kind: 'sdp', sdp: pc.localDescription });
        }
      } else if (payload.kind === 'ice') {
        try { await pc.addIceCandidate(payload.candidate); } catch (e) {}
      }
    } else if (msg.type === 'call-started') {
      setCallStatus('');
      startCountdown(msg.endsAt);
    } else if (msg.type === 'call-ended') {
      closeReviewCall(msg.reason === 'time-up' ? 'Tempo scaduto: revisione conclusa.' : "L'altra persona ha lasciato la chiamata.");
    } else if (msg.type === 'peer-left') {
      setCallStatus("L'altra persona si è disconnessa.");
    }
  };
}

function sendSignal(payload) {
  if (callState.ws && callState.ws.readyState === WebSocket.OPEN) {
    callState.ws.send(JSON.stringify({ type: 'signal', payload }));
  }
}

function setCallStatus(text) {
  const el = document.getElementById('call-status');
  if (el) el.textContent = text;
}

function startCountdown(endsAt) {
  clearInterval(callState.countdownInterval);
  function tick() {
    const remaining = Math.max(0, endsAt - Date.now());
    const m = Math.floor(remaining / 60000), s = Math.floor((remaining % 60000) / 1000);
    const el = document.getElementById('call-countdown');
    if (el) el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    if (remaining <= 0) clearInterval(callState.countdownInterval);
  }
  tick();
  callState.countdownInterval = setInterval(tick, 1000);
}

function toggleMic() {
  if (!callState.localStream) return;
  callState.micOn = !callState.micOn;
  callState.localStream.getAudioTracks().forEach(t => t.enabled = callState.micOn);
  document.getElementById('call-toggle-mic').classList.toggle('call-btn-off', !callState.micOn);
}
function toggleCam() {
  if (!callState.localStream) return;
  callState.camOn = !callState.camOn;
  callState.localStream.getVideoTracks().forEach(t => t.enabled = callState.camOn);
  document.getElementById('call-toggle-cam').classList.toggle('call-btn-off', !callState.camOn);
}

function closeReviewCall(message) {
  if (callState.ws) {
    try { callState.ws.send(JSON.stringify({ type: 'leave' })); } catch (e) {}
    try { callState.ws.close(); } catch (e) {}
  }
  if (callState.pc) { try { callState.pc.close(); } catch (e) {} }
  if (callState.localStream) callState.localStream.getTracks().forEach(t => t.stop());
  clearInterval(callState.countdownInterval);
  callState = { ws: null, pc: null, localStream: null, slotId: null, myRole: null, countdownInterval: null, micOn: true, camOn: true };

  const overlay = document.getElementById('call-overlay');
  if (message) {
    setCallStatus(message);
    setTimeout(() => { overlay.style.display = 'none'; }, 2000);
  } else {
    overlay.style.display = 'none';
  }
  // La lista delle revisioni potrebbe essere cambiata poco; se siamo ancora
  // sulla pagina Revisione la ricarichiamo per riflettere lo stato aggiornato.
  if (typeof refreshCurrentReviewPage === 'function') refreshCurrentReviewPage();
}

// ============================== audio: acquisizione ==============================
//
// Il microfono è un secondo flusso, indipendente dal link: si accende e si spegne
// da solo. L'AnalyserNode fa la FFT, noi la campioniamo a passo fisso e timbriamo
// ogni colonna nella base dei tempi del grafico — è l'allineamento fra EMG e audio.
//
// Il byte 0..255 di getByteFrequencyData copre [DB_MIN, DB_MAX]: teniamo la
// finestra larga in acquisizione e stringiamo solo in fase di disegno, così
// cambiare contrasto non richiede di ricampionare nulla.

import { spec, pitch, T } from "../core/state.js";
import { P, PITCH_FFT, PITCH_HOP, setupYin, yin } from "./pitch.js";
import { micAttach, micDetach } from "./bus.js";
import { TP, tapeClose, tapeOpen } from "./tape.js";
import { logFail, micPermission, MIC_HINT } from "../core/diagnostics.js";
import { resize } from "../draw/canvas.js";
import { $, log, setLabel } from "../ui/dom.js";

export const DB_MIN = -110, DB_MAX = 0;

export const A = {
  ctx: null, stream: null, src: null, analyser: null,
  freq: null, time: null,
  timer: null,
  pAn: null, pTime: null, pTimer: null,   // catena del pitch, vedi sotto
  sampleRate: 0, hopMs: 0,
  cols: [],                       // timestamp host, per colonne/s
  rms: -Infinity, clips: 0,
  get on() { return !!this.analyser; },
};

export async function toggleAudio() {
  if (A.on) return closeAudio("manuale");
  if (!navigator.mediaDevices?.getUserMedia) {
    return log("getUserMedia non disponibile: serve https oppure http://localhost.");
  }
  // Se il permesso è già negato il prompt non comparirà: meglio dirlo subito che
  // far premere un pulsante che non fa niente.
  if (await micPermission() === "denied") {
    log("microfono: permesso negato, il browser non mostrerà nessun prompt.");
    return log("   → " + MIC_HINT.NotAllowedError);
  }
  try {
    // I filtri pensati per le chiamate vocali sono l'opposto di ciò che serve
    // qui: la soppressione del rumore buca lo spettro, il guadagno automatico
    // rende il livello non confrontabile nel tempo.
    A.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    A.ctx = new AudioContext();
    await A.ctx.resume();
    A.sampleRate = A.ctx.sampleRate;

    A.analyser = A.ctx.createAnalyser();
    A.analyser.smoothingTimeConstant = 0;   // la media temporale del browser sporcherebbe l'asse dei tempi
    A.analyser.minDecibels = DB_MIN;
    A.analyser.maxDecibels = DB_MAX;
    // NON colleghiamo l'analyser a destination: sarebbe un feedback acustico.
    A.src = A.ctx.createMediaStreamSource(A.stream);
    A.src.connect(A.analyser);

    // Il pitch ha il suo analyser con finestra FISSA, indipendente dalla FFT dello
    // spettrogramma: con FFT 512 la finestra sarebbe 10 ms, meno di un periodo
    // sotto i 100 Hz, e non ci sarebbe niente da correlare.
    A.pAn = A.ctx.createAnalyser();
    A.pAn.fftSize = PITCH_FFT;
    A.pAn.smoothingTimeConstant = 0;
    A.src.connect(A.pAn);
    A.pTime = new Float32Array(PITCH_FFT);
    $("pitchInfo").textContent = setupYin(A.sampleRate);
    A.pTimer = setInterval(capturePitch, PITCH_HOP);

    // Il nastro: da qui in avanti l'audio si può riascoltare senza aver premuto
    // Registra. Il timbro è quello del grafico e con lo stesso `offset audio` con
    // cui si disegnano le colonne, così l'orecchio e l'occhio guardano lo stesso
    // istante.
    tapeOpen(A.ctx, A.src, (h) => T.fromHost(h - (+$("aoff").value || 0)));

    A.stream.getAudioTracks()[0].addEventListener("ended", () => { if (A.on) closeAudio("sorgente chiusa"); });
    // Il flusso lo vede anche il bus della registrazione, che è chi lo mette nel
    // file: se una registrazione è già in corso, da qui in avanti si sente.
    micAttach(A.stream);
    A.cols = []; A.clips = 0;
    applyFft();
    $("pSpec").hidden = $("pPitch").hidden = false;
    resize();
    setLabel($("btnAudio"), "Chiudi microfono", "Chiudi mic");
    $("btnAudio").classList.add("danger");
    log("microfono aperto: " + (A.sampleRate / 1000).toFixed(1) + " kHz");
  } catch (e) {
    // può fallire a metà (permesso negato, nessun ingresso): quello che è stato
    // aperto va richiuso comunque
    releaseAudio();
    logFail("microfono", e, MIC_HINT);
  }
}

function releaseAudio() {
  // Solo la cattura: il nastro già acquisito resta riascoltabile, come il
  // pannello che resta visibile.
  tapeClose();
  if (A.timer) { clearInterval(A.timer); A.timer = null; }
  if (A.pTimer) { clearInterval(A.pTimer); A.pTimer = null; }
  // Prima di fermare le tracce: la registrazione in corso torna a registrare
  // silenzio, invece di trascinarsi dietro un nodo su una traccia morta.
  micDetach();
  try { A.stream?.getTracks().forEach((t) => t.stop()); } catch {}
  try { A.ctx?.close(); } catch {}
  A.ctx = A.stream = A.src = A.analyser = A.pAn = null;
  A.rms = -Infinity;
  P.m = NaN; P.c = 0;
}

export function closeAudio(reason) {
  releaseAudio();
  // Il pannello resta visibile: quello che è stato acquisito si può ancora guardare.
  setLabel($("btnAudio"), "Microfono", "Mic");
  $("btnAudio").classList.remove("danger");
  log("microfono chiuso" + (reason && reason !== "manuale" ? " (" + reason + ")" : ""));
}

// fftSize decide il compromesso classico: Δf = fs/N contro finestra N/fs.
// Cambiarlo cambia la geometria delle colonne, quindi la storia si azzera.
//
// L'hop NON segue la finestra: con FFT grandi il 50% di sovrapposizione darebbe
// pochissime colonne al secondo e ognuna coprirebbe molti pixel. Lo teniamo fra 4
// e 20 ms — 50 colonne/s nel caso peggiore — perché quello che conta per l'occhio
// è il passo fra le colonne, non quanto si sovrappongono le finestre.
export function applyFft() {
  if (!A.on) return;
  const n = +$("fft").value;
  A.analyser.fftSize = n;
  A.freq = new Uint8Array(n / 2);
  A.time = new Float32Array(n);
  spec.setBins(n / 2);
  A.hopMs = Math.max(4, Math.min(20, Math.round(250 * n / A.sampleRate)));
  if (A.timer) clearInterval(A.timer);
  A.timer = setInterval(captureColumn, A.hopMs);
  $("specInfo").textContent =
    `Δf ${(A.sampleRate / n).toFixed(1)} Hz · finestra ${(1000 * n / A.sampleRate).toFixed(1)} ms` +
    ` · hop ${A.hopMs} ms · storia ${spec.spanS(A.hopMs).toFixed(0)} s`;
}

function captureColumn() {
  const a = A.analyser;
  if (!a) return;
  // Durante il riascolto la cattura non deve scrivere negli store: quello che
  // entra dal microfono è la registrazione stessa che suona dalle casse, e
  // finirebbe nello spettrogramma come se fosse adesso.
  if (TP.playing) return;
  const hostMs = performance.now();
  a.getByteFrequencyData(A.freq);
  a.getFloatTimeDomainData(A.time);

  let sum = 0, peak = 0;
  for (let i = 0; i < A.time.length; i++) {
    const x = A.time[i]; sum += x * x;
    const m = Math.abs(x); if (m > peak) peak = m;
  }
  A.rms = 10 * Math.log10(Math.max(1e-12, sum / A.time.length));
  if (peak >= 0.999) A.clips++;

  // L'analyser descrive gli ULTIMI fftSize campioni: la colonna va timbrata al
  // centro di quella finestra, non "adesso". `offset` compensa in più la latenza
  // di acquisizione (driver + buffer), che il browser non espone.
  const tCenter = hostMs - 500 * a.fftSize / A.sampleRate - (+$("aoff").value || 0);
  spec.push(T.fromHost(tCenter), A.freq);
  // A scheda nascosta il rendering si ferma ma il timer no: chi consuma questa
  // lista è updateStats, quindi la teniamo limitata qui.
  A.cols.push(hostMs);
  if (A.cols.length > 1024) A.cols.splice(0, A.cols.length - 1024);
}

function capturePitch() {
  const a = A.pAn;
  if (!a || TP.playing) return;
  const hostMs = performance.now();
  a.getFloatTimeDomainData(A.pTime);
  const r = yin(A.pTime);
  P.m = r.m; P.c = r.c;
  if (!isFinite(r.m)) return;         // niente da timbrare: la linea si spezza
  // Stessa regola delle colonne dello spettrogramma: la stima descrive gli ULTIMI
  // fftSize campioni, quindi va timbrata al centro di quella finestra, e `offset`
  // compensa la latenza di acquisizione. Condividendo entrambi con lo
  // spettrogramma, i due pannelli non possono scollarsi fra loro.
  const tCenter = hostMs - 500 * PITCH_FFT / A.sampleRate - (+$("aoff").value || 0);
  pitch.push(T.fromHost(tCenter), r.m, r.c);
}

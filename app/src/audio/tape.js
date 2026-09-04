// ============================== il nastro dell'audio ==============================
//
// Un anello di PCM che gira per tutto il tempo in cui il microfono è aperto, così
// **riascoltare un momento non richiede di aver premuto Registra**. È la risposta
// a "posso risentire l'audio dal cursore in avanti?", ed era un no: l'audio del
// microfono passava dall'analisi (FFT e pitch) e veniva buttato, quindi l'unica
// copia esisteva dentro l'mp4 — cioè bisognava decidere PRIMA di cantare che si
// voleva poter riascoltare.
//
// **Perché PCM grezzo e non un MediaRecorder.** Un secondo registratore darebbe un
// file da 2 MB invece di 23 MB di RAM, ma un blob di MediaRecorder si può leggere
// solo quando è chiuso: per riascoltare a metà sessione bisognerebbe fermare e
// riavviare la registrazione, cioè bucare il nastro proprio mentre serve. E il
// WebM che produce è un flusso *live* senza `Duration` né `Cues` (misurato alla
// fase 4, sta nel README), quindi cercare un punto dentro è esattamente la cosa
// che non sa fare. Un anello di campioni invece si legge da qualunque punto
// mentre lo si scrive, che è tutto quello che serve qui.
//
// **I tempi sono quelli del grafico, non del clock audio.** Ogni blocco porta il
// suo timbro, come ogni campione EMG porta il suo: così `1:47` sulla lista e
// `1:47` nel nastro sono lo stesso istante senza assumere che il clock della
// scheda audio e `performance.now()` corrano insieme (non lo fanno: qualche
// decimo di secondo su cinque minuti). E un salto indietro nel timbro vuol dire
// che la base dei tempi è cambiata — link che si connette — e allora il nastro si
// azzera, che è la stessa regola di `Ring.monotonic`.

// 24 kHz basta: 12 kHz di banda, la voce è tutta lì dentro e le sibilanti si
// riconoscono. Int16 e non Float32 perché per l'orecchio sono la stessa cosa e in
// RAM sono la metà.
const TARGET_HZ = 24000;
// Otto minuti: una canzone di cinque con le prove intorno. A 24 kHz Int16 sono
// 23 MB, che è meno del budget dello spettrogramma.
const SECS = 8 * 60;
const BACK_JUMP = 0.5;             // salto indietro che vuol dire "base cambiata"

export class Tape {
  // `srcRate` è il rate della scheda audio; il nastro decima a un intero.
  constructor(srcRate, secs = SECS) {
    this.f = Math.max(1, Math.round(srcRate / TARGET_HZ));
    this.rate = srcRate / this.f;
    this.cap = Math.max(1, Math.round(this.rate * secs));
    this.d = new Int16Array(this.cap);
    this.w = 0;                    // prossima posizione di scrittura nell'anello
    this.k = 0;                    // campioni scritti in tutto: l'indice LOGICO
    this.res = [];                 // campioni avanzati dalla decimazione fra due blocchi
    // Un'ancora per blocco: tempo del grafico del primo campione e il suo indice
    // logico. Non si interpola e non si assume niente sui clock.
    this.aT = []; this.aK = [];
  }

  clear() { this.w = this.k = 0; this.res = []; this.aT = []; this.aK = []; }

  // `t` è il tempo del grafico del PRIMO campione del blocco.
  push(block, t) {
    if (this.aT.length && t < this.aT[this.aT.length - 1] - BACK_JUMP) this.clear();
    this.aT.push(t); this.aK.push(this.k);

    // Media a scatola sui `f` campioni: senza, decimare ripiegherebbe le
    // frequenze alte dentro la banda invece di toglierle.
    const f = this.f;
    for (let i = 0; i < block.length; i++) {
      this.res.push(block[i]);
      if (this.res.length < f) continue;
      let s = 0;
      for (let j = 0; j < f; j++) s += this.res[j];
      this.res.length = 0;
      const v = Math.max(-1, Math.min(1, s / f));
      this.d[this.w] = Math.round(v * 32767);
      this.w = (this.w + 1) % this.cap;
      this.k++;
    }
    // Le ancore più vecchie dei campioni che l'anello contiene ancora non servono.
    while (this.aK.length > 1 && this.aK[1] <= this.k - this.cap) {
      this.aT.shift(); this.aK.shift();
    }
  }

  get n() { return Math.min(this.k, this.cap); }
  get first() { return this.k - this.n; }        // indice logico più vecchio ancora vivo

  // L'intervallo di tempo del grafico che il nastro può far risentire. Null se
  // non c'è niente: è quello che spegne il pulsante invece di far premere un
  // pulsante che non fa nulla.
  span() {
    if (!this.k || !this.aT.length) return null;
    return { t0: this.tAt(this.first), t1: this.tAt(this.k) };
  }

  // Tempo del grafico di un indice logico, interpolando DENTRO il blocco che lo
  // contiene — non fra il primo e l'ultimo del nastro.
  tAt(k) {
    if (!this.aT.length) return NaN;
    let lo = 0, hi = this.aK.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.aK[m] <= k) lo = m; else hi = m - 1; }
    return this.aT[lo] + (k - this.aK[lo]) / this.rate;
  }

  // Indice logico di un tempo del grafico, o null se fuori dal nastro.
  //
  // Se il tempo cade in un BUCO — la cattura si ferma mentre si riascolta — si
  // torna l'ultimo campione che c'è *prima*, non il primo dopo: chi clicca a 1:30
  // vuole sentire cosa c'era lì, e saltare avanti gli farebbe sentire un altro
  // pezzo di canzone credendo che sia quello. Da cui il limite al blocco trovato,
  // e non alla fine del nastro.
  indexAt(t) {
    const s = this.span();
    if (!s || t < s.t0 - 0.05 || t > s.t1) return null;
    let lo = 0, hi = this.aT.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.aT[m] <= t) lo = m; else hi = m - 1; }
    const end = lo + 1 < this.aK.length ? this.aK[lo + 1] : this.k;
    const k = Math.round(this.aK[lo] + (t - this.aT[lo]) * this.rate);
    return Math.max(this.first, Math.min(end, k));
  }

  // Copia in `out` a partire dall'indice logico `k0`; torna quanti campioni ha
  // davvero copiato, che è meno di `out.length` alla fine del nastro.
  read(k0, out) {
    let k = Math.max(this.first, k0), i = 0;
    while (i < out.length && k < this.k) {
      out[i++] = this.d[(this.w - (this.k - k) + this.cap * 2) % this.cap] / 32768;
      k++;
    }
    return i;
  }
}

// ---- cattura ----

export const TP = {
  tape: null,
  node: null,                      // il nodo che copia i campioni nell'anello
  play: null,                      // stato della riproduzione, vedi playFrom
  get on() { return !!this.tape; },
  get playing() { return !!this.play; },
};

const BLOCK = 4096;                // ~85 ms a 48 kHz: blocchi grossi, callback rari

// `tOf(hostMs)` la passa chi chiama: questo modulo non sa niente né del DOM né
// della base dei tempi, e così resta testabile in node.
//
// ScriptProcessorNode è deprecato e va bene comunque: l'alternativa (AudioWorklet)
// è un secondo file caricato a runtime, mentre qui il callback non fa altro che
// copiare campioni in un array. Se un giorno smettesse di esistere, la sostituzione
// è locale a questa funzione.
export function tapeOpen(ctx, src, tOf) {
  tapeClose();
  TP.tape = new Tape(ctx.sampleRate);
  const node = ctx.createScriptProcessor(BLOCK, 1, 1);
  const dur = BLOCK / ctx.sampleRate;
  node.onaudioprocess = (e) => {
    // Mentre si riascolta NON si registra: il microfono sentirebbe le casse e il
    // nastro si sovrainciderebbe da solo. Resta un buco al presente, che è il
    // momento in cui si sta guardando il passato.
    if (TP.play) return;
    // Il blocco consegnato ADESSO copre i `dur` secondi appena passati: si timbra
    // il suo primo campione, non l'istante della callback.
    TP.tape?.push(e.inputBuffer.getChannelData(0), tOf(performance.now()) - dur);
  };
  src.connect(node);
  // Un ScriptProcessor senza uscita collegata non viene eseguito da Chrome. Ci va
  // un guadagno a zero: la destinazione serve a far girare il nodo, non a farsi
  // sentire — collegare il microfono alle casse sarebbe un fischio.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(mute);
  mute.connect(ctx.destination);
  TP.node = { node, mute };
  return TP.tape;
}

export function tapeClose() {
  stopPlay();
  if (TP.node) {
    try { TP.node.node.disconnect(); TP.node.node.onaudioprocess = null; } catch {}
    try { TP.node.mute.disconnect(); } catch {}
  }
  TP.node = null;
  // Il nastro NON si butta chiudendo il microfono: quello che è stato acquisito si
  // può ancora riascoltare, come il pannello che resta visibile.
}

export function tapeDrop() { tapeClose(); TP.tape = null; }

// ---- riproduzione ----
//
// A pezzi da quattro secondi, schedulati due avanti: allocare tutta la coda del
// nastro sarebbe un AudioBuffer da decine di MB, e il punto è poter partire
// subito da un istante qualunque.

const CHUNK = 4;
const AHEAD = 2;

export function playFrom(t, onEnd) {
  const tape = TP.tape;
  if (!tape) return null;
  const k0 = tape.indexAt(t);
  if (k0 === null) return null;
  stopPlay();

  const ctx = new AudioContext();
  const p = { ctx, k: k0, when: ctx.currentTime + 0.08, t0: tape.tAt(k0), c0: 0, srcs: new Set(), onEnd };
  p.c0 = p.when;
  TP.play = p;
  fill(p);
  return p.t0;
}

function fill(p) {
  const tape = TP.tape;
  while (TP.play === p && p.srcs.size < AHEAD) {
    const n = Math.round(CHUNK * tape.rate);
    const buf = p.ctx.createBuffer(1, n, tape.rate);
    const got = tape.read(p.k, buf.getChannelData(0));
    if (!got) { if (!p.srcs.size) finish(p); return; }
    p.k += got;
    const src = p.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(p.ctx.destination);
    src.onended = () => {
      p.srcs.delete(src);
      if (TP.play === p) fill(p);
    };
    src.start(p.when);
    p.when += got / tape.rate;
    p.srcs.add(src);
    // Coda del nastro raggiunta: quello che è schedulato suona, poi finisce.
    if (got < n) return;
  }
}

function finish(p) {
  if (TP.play !== p) return;
  TP.play = null;
  try { p.ctx.close(); } catch {}
  p.onEnd?.(p.t0 + (p.ctx.currentTime - p.c0));
}

export function stopPlay() {
  const p = TP.play;
  if (!p) return;
  TP.play = null;
  for (const s of p.srcs) { try { s.onended = null; s.stop(); } catch {} }
  const pos = p.t0 + (p.ctx.currentTime - p.c0);
  try { p.ctx.close(); } catch {}
  return pos;
}

// Dov'è arrivata la riproduzione, in tempo del grafico. È questa che muove il
// cursore, quindi i tre pannelli scorrono con l'audio senza un timer in più.
export function playPos() {
  const p = TP.play;
  if (!p) return null;
  const t = p.t0 + Math.max(0, p.ctx.currentTime - p.c0);
  const s = TP.tape?.span();
  return s ? Math.min(t, s.t1) : t;
}

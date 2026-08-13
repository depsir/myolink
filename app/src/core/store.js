// ============================== store dei campioni ==============================
//
// Ring buffer indicizzato per tempo: la base è comune ai campioni EMG e alle
// colonne dello spettrogramma, che vanno cercate nello stesso modo (dammi tutto
// da tMin in poi) perché condividono l'asse X.

export class Ring {
  constructor(cap) {
    this.cap = cap;
    this.t = new Float64Array(cap);   // secondi, tempo del grafico (vedi T)
    this.n = 0; this.w = 0;
  }
  clear() { this.n = 0; this.w = 0; }
  idx(k) { return (this.w - this.n + k + this.cap) % this.cap; }   // k: 0 = più vecchio
  last() { return this.n ? this.idx(this.n - 1) : -1; }
  tLast() { return this.n ? this.t[this.last()] : 0; }
  advance(t) {
    this.t[this.w] = t;
    this.w = (this.w + 1) % this.cap;
    if (this.n < this.cap) this.n++;
  }
  // Indici logici [from, n) degli elementi con t >= tMin.
  firstAtOrAfter(tMin) {
    let lo = 0, hi = this.n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.t[this.idx(mid)] < tMin) lo = mid + 1; else hi = mid;
    }
    return lo;
  }
  // La regressione del clock si raffina a ogni pacchetto e nei primi istanti può
  // correggersi di qualche ms: senza questo un elemento tornerebbe indietro nel
  // tempo e la ricerca binaria non sarebbe più valida. Un salto grosso
  // all'indietro invece non è rumore della stima ma un cambio di base dei tempi:
  // si riparte pulito, come fa l'ingestione dei campioni.
  monotonic(t) {
    if (!this.n) return t;
    const tp = this.t[this.last()];
    if (tp - t > 0.5) { this.clear(); return t; }
    return t <= tp ? tp + 1e-6 : t;
  }
}

export class Store extends Ring {
  constructor(cap = 400000) { super(cap); this.v = new Float32Array(cap); }
  push(t, v) { this.v[this.w] = v; this.advance(t); }
}

// Una colonna = uno spettro, `bins` byte, tutte in un solo Uint8Array. Con FFT
// 32768 una colonna è 16 kB: la capacità non può essere fissa, la ricaviamo da un
// budget di memoria costante. Più risoluzione in frequenza si paga in storia.
const SPEC_BUDGET = 24 << 20;      // 24 MB

export class SpecStore extends Ring {
  constructor() { super(1); this.bins = 0; this.d = null; }
  setBins(bins) {
    if (bins === this.bins) return;
    this.bins = bins;
    const cap = Math.max(512, Math.min(16384, Math.floor(SPEC_BUDGET / bins)));
    if (cap !== this.cap) { this.cap = cap; this.t = new Float64Array(cap); }
    this.d = new Uint8Array(cap * bins);
    this.clear();
  }
  // Storia disponibile: dipende dall'hop, che lo decide l'audio — passato come
  // parametro invece che letto da lì, così questo modulo resta senza dipendenze.
  spanS(hopMs) { return this.cap * hopMs / 1000; }
  push(t, col) {
    t = this.monotonic(t);
    this.d.set(col, this.w * this.bins);
    this.advance(t);
  }
}

// Una stima di pitch per hop: nota in semitoni (numero MIDI, non Hz — vedi
// drawPitch) e clarity 0..1. Con l'hop del pitch la capacità vale ~11 minuti.
export class PitchStore extends Ring {
  constructor(cap = 32768) { super(cap); this.m = new Float32Array(cap); this.c = new Float32Array(cap); }
  push(t, m, c) {
    t = this.monotonic(t);
    this.m[this.w] = m; this.c[this.w] = c;
    this.advance(t);
    // Niente filtro sul valore: sui cambi di nota la finestra da 85 ms resta
    // contaminata per ~4 hop di fila, cioè più di quanto una mediana corta possa
    // togliere, e il rischio è che ne PROPAGHI uno sbagliato invece di levarlo.
    // Gli spuri isolati restano quindi visibili: è l'auto-range a essere robusto
    // (vedi pitchRange), non il dato a essere addolcito.
  }
}

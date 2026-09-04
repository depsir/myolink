// ============================== stato ==============================
//
// Gli store e la base dei tempi stanno qui perché li leggono tutti: ingestione,
// audio, disegno e statistiche. È l'unico modulo con stato condiviso, e non
// importa nulla oltre alle strutture dati — così non può creare cicli.

import { Store, SpecStore, PitchStore } from "./store.js";
import { ClockFit } from "./clock.js";

export const store = new Store();
export const spec = new SpecStore();
// 262144 stime = ~87 minuti a hop 20 ms, 4 MB. La capacità di serie (32768) era
// ~11 minuti: al limite per una canzone con le prove intorno, e su un limite così
// il sintomo non è un errore ma il silenzioso troncamento della prima metà.
export const pitch = new PitchStore(262144);
export const clock = new ClockFit();

// L'asse X è il tempo del DEVICE quando c'è un link — i campioni stanno dove li
// ha timbrati il firmware, che è tutto il punto del protocollo — e il tempo
// dell'host quando non c'è, così lo spettrogramma funziona anche da solo.
// La conversione host → grafico passa dalla regressione del clock: è esattamente
// la primitiva per cui era stata scritta.
export const T = {
  epochMs: performance.now(),                    // usata solo senza link
  get linked() { return clock.x0 !== null; },
  fromHost(hostMs) {
    return this.linked ? clock.hostToDevice(hostMs / 1000) : (hostMs - this.epochMs) / 1000;
  },
  now() { return this.fromHost(performance.now()); },
};

export const S = {
  transport: null,       // "serial" | "ble" | "demo"
  running: false,
  tUnwrap: null,         // ultimo t0_us grezzo, per lo srotolamento a 32 bit
  tAbsUs: 0,             // tempo device srotolato, in µs
  lastSeq: null,
  dtUs: 10000,                 // 100 Hz, come il firmware di serie
  packets: 0, samples: 0,
  lostPackets: 0, lostSamples: 0, gapFlags: 0, crcErrors: 0,
  bytes: 0,
  winPkts: [], winSamples: [],   // timestamp host per il calcolo di pkt/s
  maxLagMs: 0,
  mtuHint: 0,
  tStartHost: 0,
};

export function resetStats() {
  store.clear(); clock.reset();
  // La base dei tempi cambia (torna al clock dell'host, e poi a quello del nuovo
  // device): quello che è già stato acquisito dall'audio è timbrato sulla
  // vecchia base e va buttato.
  spec.clear(); pitch.clear();
  T.epochMs = performance.now();
  Object.assign(S, {
    tUnwrap: null, tAbsUs: 0, lastSeq: null,
    packets: 0, samples: 0, lostPackets: 0, lostSamples: 0,
    gapFlags: 0, crcErrors: 0, bytes: 0,
    winPkts: [], winSamples: [], maxLagMs: 0, mtuHint: 0,
    tStartHost: performance.now(),
  });
}

// ============================== audio: pitch (YIN) ==============================
//
// Il picco dello spettro NON è la nota: sulla voce la fondamentale è spesso più
// debole della seconda o terza armonica, e si sbaglia l'ottava di continuo. Si
// lavora nel dominio del tempo con YIN — funzione differenza, normalizzazione
// cumulativa, prima discesa sotto soglia — che è robusto proprio sull'ottava
// perché prende il PRIMO minimo buono, non il più profondo.
//
// YIN è monofonico per costruzione: con una base musicale in cassa il microfono
// sente due sorgenti armoniche e la stima si aggancia alla più forte. Non è
// aggirabile qui; è per questo che c'è la clarity, che in quel caso crolla.
//
// Questo modulo non tocca il DOM: è il pezzo di DSP che i test possono chiamare
// direttamente.

export const PITCH_FFT = 4096;    // ~85 ms a 48 kHz: 5 periodi anche a 65 Hz (C2)
export const PITCH_HOP = 20;      // 50 stime/s, molto più di quanto serva all'occhio
const F_LO = 60, F_HI = 1300;
const YIN_THR = 0.12;             // soglia assoluta sulla CMND, come nel paper

export const P = {
  D: 1, fsd: 0,            // fattore di decimazione e frequenza risultante
  x: null, diff: null, cmnd: null,
  lagMin: 0, lagMax: 0, W: 0,
  m: NaN, c: 0,            // ultima stima: semitoni MIDI e clarity
};

// Un semitono è un rapporto di frequenza costante, quindi la scala giusta per la
// nota è logaritmica: in numero MIDI il vibrato di mezzo tono è alto uguale su C3
// e su C5, in Hz no. Tutto a valle lavora in semitoni, gli Hz solo per leggerli.
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const STEPS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
export const BLACK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];

export const midiOf = (f) => 69 + 12 * Math.log2(f / 440);
export const hzOf = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const noteName = (m) => { const r = Math.round(m); return NOTE_NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1); };
export const centsStr = (m) => { const c = Math.round((m - Math.round(m)) * 100); return (c < 0 ? "−" : "+") + Math.abs(c) + " ¢"; };

export function parseNote(s, dflt) {
  const g = /^\s*([a-gA-G])([#b]?)\s*(-?\d+)\s*$/.exec(s || "");
  if (!g) return dflt;
  return 12 * (+g[3] + 1) + STEPS[g[1].toLowerCase()] + (g[2] === "#" ? 1 : g[2] === "b" ? -1 : 0);
}

// Ritorna la riga di informazioni da mostrare; scriverla nel DOM è del chiamante,
// così questo modulo resta chiamabile dai test senza browser.
export function setupYin(sr) {
  // Sotto i 1300 Hz non serve la banda piena: decimando si abbassa il costo con
  // il QUADRATO del fattore (meno campioni e meno lag da provare).
  P.D = Math.max(1, Math.round(sr / 12000));
  P.fsd = sr / P.D;
  const n = Math.floor(PITCH_FFT / P.D);
  P.lagMin = Math.max(2, Math.floor(P.fsd / F_HI));
  P.lagMax = Math.min(n - 64, Math.ceil(P.fsd / F_LO));
  P.W = n - P.lagMax;                 // campioni confrontabili al lag massimo
  P.x = new Float32Array(n);
  P.diff = new Float32Array(P.lagMax + 1);
  P.cmnd = new Float32Array(P.lagMax + 1);
  return `finestra ${(1000 * PITCH_FFT / sr).toFixed(0)} ms · ${(P.fsd / 1000).toFixed(1)} kHz interni` +
    ` · ${noteName(midiOf(F_LO))}–${noteName(midiOf(F_HI))}`;
}

// Ritorna {m, c}: semitoni MIDI e clarity 0..1. m = NaN quando non c'è segnale.
export function yin(buf) {
  const { D, x, diff, cmnd, lagMin, lagMax, W } = P;
  const n = x.length;

  // Decimazione con media mobile di D campioni: i suoi zeri cadono ESATTAMENTE
  // sui multipli di fsd, cioè sulle frequenze che il sottocampionamento
  // ripiegherebbe verso il basso. Fa da antialias senza filtro dedicato.
  let energy = 0;
  for (let j = 0, i = 0; j < n; j++, i += D) {
    let s = 0;
    for (let k = 0; k < D; k++) s += buf[i + k];
    s /= D;
    x[j] = s; energy += s * s;
  }
  if (energy / n < 1e-7) return { m: NaN, c: 0 };     // ~ -70 dBFS: silenzio

  for (let tau = 1; tau <= lagMax; tau++) {
    let s = 0;
    for (let j = 0; j < W; j++) { const d = x[j] - x[j + tau]; s += d * d; }
    diff[tau] = s;
  }
  // Normalizzazione cumulativa: senza, diff(tau) cresce con tau e il minimo
  // globale finisce sempre sui lag lunghi (errore di ottava verso il basso).
  let run = 0;
  cmnd[0] = 1;
  for (let tau = 1; tau <= lagMax; tau++) {
    run += diff[tau];
    cmnd[tau] = run > 0 ? diff[tau] * tau / run : 1;
  }

  // Prima discesa sotto soglia, poi giù fino in fondo a quella valle. È questo
  // "primo" invece di "migliore" che evita di agganciare la seconda armonica.
  let best = -1;
  for (let tau = lagMin; tau <= lagMax; tau++) {
    if (cmnd[tau] < YIN_THR) {
      while (tau < lagMax && cmnd[tau + 1] < cmnd[tau]) tau++;
      best = tau; break;
    }
  }
  // Niente sotto soglia: diamo comunque il candidato migliore e lasciamo che sia
  // la clarity a dire quanto vale. Il grafico lo taglierà da solo.
  if (best < 0) {
    let bv = Infinity;
    for (let tau = lagMin; tau <= lagMax; tau++) if (cmnd[tau] < bv) { bv = cmnd[tau]; best = tau; }
    if (best < 0) return { m: NaN, c: 0 };
  }

  // Interpolazione parabolica: senza, la risoluzione è quella dei lag interi —
  // a 12 kHz interni sono ~40 cent a C5, un errore che si vede.
  let tau = best;
  if (best > lagMin && best < lagMax) {
    const y0 = cmnd[best - 1], y1 = cmnd[best], y2 = cmnd[best + 1];
    const den = y0 + y2 - 2 * y1;
    if (den > 0) tau = best + 0.5 * (y0 - y2) / den;
  }
  const f = P.fsd / tau;
  if (!(f >= F_LO && f <= F_HI)) return { m: NaN, c: 0 };
  return { m: midiOf(f), c: Math.max(0, Math.min(1, 1 - cmnd[best])) };
}

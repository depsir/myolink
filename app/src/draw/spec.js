// ============================== spettrogramma ==============================
//
// Colormap tipo "magma": monotona in luminanza (nero → viola → arancio → bianco).
// L'ampiezza si legge quindi come chiarezza, cioè resta corretta in bianco e nero
// e con qualunque daltonismo — è il motivo per cui è lo standard per gli
// spettrogrammi, e il nero coincide col fondo del pannello.

import { spec, pitch } from "../core/state.js";
import { A, DB_MIN, DB_MAX } from "../audio/audio.js";
import { hzOf } from "../audio/pitch.js";
import { pThr, pMaxGap } from "./pitch.js";
import { sctx, specW, specH, PAD, SPAD } from "./canvas.js";
import { $ } from "../ui/dom.js";

const CMAP = (() => {
  const anchors = [
    [0, 0, 4], [24, 15, 62], [59, 15, 112], [98, 24, 122], [140, 41, 129], [183, 55, 121],
    [222, 73, 104], [246, 110, 92], [254, 159, 109], [254, 209, 141], [252, 253, 191],
  ];
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * (anchors.length - 1);
    const j = Math.min(anchors.length - 2, Math.floor(x)), f = x - j;
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(anchors[j][c] + f * (anchors[j + 1][c] - anchors[j][c]));
  }
  return lut;
})();

// byte acquisito → indice di colormap, secondo la finestra in dB scelta.
let remapKey = "";
const remap = new Uint8Array(256);
function buildRemap(lo, hi) {
  const key = lo + "/" + hi;
  if (key === remapKey) return;
  remapKey = key;
  const span = Math.max(1e-6, hi - lo);
  for (let b = 0; b < 256; b++) {
    const db = DB_MIN + (b / 255) * (DB_MAX - DB_MIN);
    remap[b] = Math.max(0, Math.min(255, Math.round(255 * (db - lo) / span)));
  }
}

// Riga di pixel → sorgente in frequenza. Precalcolato: cambia solo con la geometria.
// Due regimi opposti, e servono entrambi:
//
//  - più bin che pixel (parte alta dell'asse, FFT piccole): MASSIMO su [b0,b1],
//    così una riga armonica stretta non sparisce fra due pixel;
//  - meno bin che pixel (FFT grandi, e sempre in basso sull'asse log): INTERPOLAZIONE
//    lineare fra i due bin adiacenti. Senza questo lo stesso bin viene ripetuto
//    identico per decine di righe, ed è metà dell'effetto a quadretti.
//
// L'interpolazione lavora sui byte, cioè in dB: è la scala giusta per una magnitudine.
let rowsKey = "", rowB0 = null, rowB1 = null, rowI = null, rowF = null;
let binLo = 0, binHi = 0;          // unione dei bin che finiscono a schermo
function buildRows(gh, fMin, fMax, nBins, nyq) {
  const key = [gh, fMin, fMax, nBins, nyq].join("|");
  if (key === rowsKey) return;
  rowsKey = key;
  rowB0 = new Int32Array(gh); rowB1 = new Int32Array(gh);
  rowI = new Int32Array(gh); rowF = new Float32Array(gh);
  const perBin = nyq / nBins;
  const fOf = fMin > 0 ? (u) => fMin * Math.pow(fMax / fMin, u) : (u) => u * fMax;
  const clamp = (b) => Math.max(0, Math.min(nBins - 1, b));
  for (let y = 0; y < gh; y++) {
    const b0 = Math.floor(fOf(1 - (y + 1) / gh) / perBin);       // y = 0 è in alto = fMax
    const b1 = Math.ceil(fOf(1 - y / gh) / perBin) - 1;
    rowB0[y] = clamp(b0); rowB1[y] = Math.max(clamp(b0), clamp(b1));
    // Centro della riga in coordinate di bin: il bin b è centrato in (b + 0.5) * perBin.
    const p = Math.max(0, Math.min(nBins - 1, fOf(1 - (y + 0.5) / gh) / perBin - 0.5));
    const i = Math.max(0, Math.min(nBins - 2, p | 0));
    rowI[y] = i; rowF[y] = p - i;
  }
  // y = 0 è fMax, y = gh-1 è fMin: gli estremi danno l'intervallo utile. Un bin di
  // margine per parte copre il vicino che serve all'interpolazione.
  binLo = Math.max(0, rowB0[gh - 1] - 1);
  binHi = Math.min(nBins - 1, rowB1[0] + 1);
}

// Una colonna sorgente (offset `o` in spec.d) → gh valori 0..255 secondo la mappa
// sopra. `keepMax` accumula invece di sovrascrivere: serve quando in un pixel
// cadono più colonne.
function fillCol(out, d, o, gh, keepMax) {
  for (let y = 0; y < gh; y++) {
    const b0 = rowB0[y], b1 = rowB1[y];
    let v;
    if (b1 > b0) {
      v = 0;
      for (let b = b0; b <= b1; b++) { const s = d[o + b]; if (s > v) v = s; }
    } else {
      const i = o + rowI[y], a = d[i];
      v = a + rowF[y] * (d[i + 1] - a);
    }
    if (keepMax) { if (v > out[y]) out[y] = v; } else out[y] = v;
  }
}

// Disegniamo in un canvas fuori schermo a risoluzione CSS (non dpr) e lo scaliamo:
// un quarto dei pixel per frame su schermo retina. Ora che i due assi interpolano,
// il dato sotto è continuo e l'ingrandimento bilineare non si vede — mentre prima
// del campionamento nearest raddoppiava proprio i quadretti.
const specOff = document.createElement("canvas");
const soctx = specOff.getContext("2d");
let specImg = null;
// colA/colB: le due colonne sorgente rimappate in frequenza; colO: quella da
// scrivere a schermo. Tenere A e B separate dall'uscita permette di riusarle fra
// pixel adiacenti, che con l'hop tipico ricadono sulla stessa coppia.
let colN = 0, colA = null, colB = null, colO = null;
let mixN = 0, mixBins = null;             // massimo sui bin grezzi, vedi drawSpec

export function drawSpec(ax) {
  sctx.clearRect(0, 0, specW, specH);

  const gw = Math.max(1, Math.round(specW - PAD.l - PAD.r));
  const gh = Math.max(1, Math.round(specH - SPAD.t - SPAD.b));
  const nBins = spec.bins, nyq = A.sampleRate / 2;
  if (!nBins || !nyq) return;                       // microfono mai aperto

  const fMax = Math.max(100, Math.min(nyq, 1000 * (+$("fmax").value || 5)));
  const fMin = $("flog").checked ? 40 : 0;
  buildRows(gh, fMin, fMax, nBins, nyq);
  buildRemap(+$("dblo").value, +$("dbhi").value);

  if (specOff.width !== gw || specOff.height !== gh) {
    specOff.width = gw; specOff.height = gh;
    specImg = soctx.createImageData(gw, gh);
  }

  if (colN !== gh) {
    colN = gh;
    colA = new Float32Array(gh); colB = new Float32Array(gh); colO = new Float32Array(gh);
  }
  if (mixN !== nBins) { mixN = nBins; mixBins = new Uint8Array(nBins); }

  const px = specImg.data, d = spec.d;
  const tol = Math.max(0.04, 2.5 * A.hopMs / 1000);   // oltre questo, per quel pixel non c'è dato
  const dt = ax.W / gw;
  // k = ultima colonna con t < bordo sinistro del pixel, -1 se non c'è.
  // Il tempo cresce con x: basta far avanzare un puntatore, non una ricerca per pixel.
  let k = spec.firstAtOrAfter(ax.tLeft) - 1;
  // Quali colonne logiche stanno in colA/colB. Gli indici logici sono stabili solo
  // dentro un frame (spec non avanza mentre disegniamo), quindi la cache vive qui.
  let inA = -1, inB = -1;

  // Rimappa la colonna logica j in colA (slot 0) o colB (slot 1), riusando quello che
  // c'è già; se serve in A ciò che sta in B si copia invece di ricalcolare.
  const need = (j, slot) => {
    if (slot === 0) {
      if (inA === j) return colA;
      if (inB === j) { colA.set(colB); inA = j; return colA; }
      fillCol(colA, d, spec.idx(j) * nBins, gh, false); inA = j; return colA;
    }
    if (inB === j) return colB;
    if (inA === j) { colB.set(colA); inB = j; return colB; }
    fillCol(colB, d, spec.idx(j) * nBins, gh, false); inB = j; return colB;
  };

  for (let x = 0; x < gw; x++) {
    const tA = ax.tLeft + x * dt, tB = tA + dt;
    while (k + 1 < spec.n && spec.t[spec.idx(k + 1)] < tA) k++;
    let m = k;                                         // colonne dentro il pixel: (k, m]
    while (m + 1 < spec.n && spec.t[spec.idx(m + 1)] < tB) m++;

    let have = false;
    if (m > k) {
      // Colonne più dense dei pixel: massimo, così un transiente non viene saltato.
      // Il massimo si fa sui BIN grezzi, e solo su quelli visibili, poi si rimappa
      // in frequenza una volta sola: esatto per qualunque numero di colonne e più
      // economico che rimappare colonna per colonna.
      const o1 = spec.idx(k + 1) * nBins;
      for (let b = binLo; b <= binHi; b++) mixBins[b] = d[o1 + b];
      for (let j = k + 2; j <= m; j++) {
        const o = spec.idx(j) * nBins;
        for (let b = binLo; b <= binHi; b++) { const v = d[o + b]; if (v > mixBins[b]) mixBins[b] = v; }
      }
      fillCol(colO, mixBins, 0, gh, false);
      k = m; have = true;
    } else {
      // Colonne più rade dei pixel: interpolazione lineare nel tempo fra le due che
      // racchiudono il pixel. Senza questo ogni colonna diventa una barra piatta
      // larga più pixel — l'altra metà dell'effetto a quadretti.
      const tc = tA + dt / 2;
      const hasP = k >= 0, hasN = k + 1 < spec.n;
      const tp = hasP ? spec.t[spec.idx(k)] : 0;
      const tn = hasN ? spec.t[spec.idx(k + 1)] : 0;
      if (hasP && hasN && tn - tp <= tol) {
        const w = (tc - tp) / (tn - tp);
        const a = need(k, 0), b = need(k + 1, 1);
        for (let y = 0; y < gh; y++) colO[y] = a[y] + w * (b[y] - a[y]);
        have = true;
      } else if (hasP && tc - tp <= tol) {
        colO.set(need(k, 0)); have = true;
      } else if (hasN && tn - tc <= tol) {
        colO.set(need(k + 1, 1)); have = true;
      }
    }

    if (!have) {
      // Nessuna colonna vicina: buco. Come sul grafico, si deve vedere come tale.
      for (let y = 0; y < gh; y++) {
        const q = (y * gw + x) * 4;
        px[q] = 26; px[q + 1] = 31; px[q + 2] = 40; px[q + 3] = 255;
      }
      continue;
    }
    for (let y = 0; y < gh; y++) {
      const c = remap[(colO[y] + 0.5) | 0] * 3, q = (y * gw + x) * 4;
      px[q] = CMAP[c]; px[q + 1] = CMAP[c + 1]; px[q + 2] = CMAP[c + 2]; px[q + 3] = 255;
    }
  }
  soctx.putImageData(specImg, 0, 0);
  sctx.drawImage(specOff, PAD.l, SPAD.t, gw, gh);

  // asse delle frequenze
  const yOf = fMin > 0
    ? (f) => SPAD.t + gh * (1 - Math.log(Math.max(fMin, f) / fMin) / Math.log(fMax / fMin))
    : (f) => SPAD.t + gh * (1 - f / fMax);
  const ticks = [];
  if (fMin > 0) {
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) if (f >= fMin && f <= fMax) ticks.push(f);
  } else {
    const st = fMax <= 1200 ? 200 : fMax <= 3000 ? 500 : fMax <= 6000 ? 1000 : fMax <= 12000 ? 2000 : 5000;
    for (let f = st; f <= fMax + 1; f += st) ticks.push(f);
  }
  sctx.strokeStyle = "rgba(255,255,255,.10)"; sctx.fillStyle = "#6e7681";
  sctx.lineWidth = 1; sctx.font = "10px ui-monospace, monospace";
  sctx.textAlign = "right"; sctx.textBaseline = "middle";
  for (const f of ticks) {
    const y = Math.round(yOf(f)) + .5;
    const yl = Math.min(SPAD.t + gh - 5, Math.max(SPAD.t + 5, y));
    const lbl = f >= 1000 ? f / 1000 + "k" : String(f);
    sctx.beginPath(); sctx.moveTo(PAD.l, y); sctx.lineTo(specW - PAD.r, y); sctx.stroke();
    sctx.textAlign = "right"; sctx.fillText(lbl, PAD.l - 6, yl);
    sctx.textAlign = "left"; sctx.fillText(lbl, specW - PAD.r + 6, yl);
  }
  // Con i margini stretti dello schermo di un telefono la scritta finirebbe
  // addosso all'etichetta della tacca più alta, e fra le due è quella che porta
  // meno informazione: un asse con 5k/2k/1k non lo si confonde con altro.
  if (PAD.l >= 44) { sctx.textAlign = "left"; sctx.fillText("Hz", 6, SPAD.t + 5); }

  // La stessa linea sopra lo spettrogramma: deve cadere sulla prima riga
  // armonica. Quando non ci cade, il pitch tracker sta sbagliando e si vede.
  if ($("povl").checked && pitch.n) {
    const thr = pThr();
    sctx.save();
    sctx.beginPath(); sctx.rect(PAD.l, SPAD.t, gw, gh); sctx.clip();
    sctx.strokeStyle = "rgba(126,231,135,.9)"; sctx.lineWidth = 1.4; sctx.lineJoin = "round";
    sctx.beginPath();
    let prevT = null;
    for (let k2 = pitch.firstAtOrAfter(ax.tLeft); k2 < pitch.n; k2++) {
      const i = pitch.idx(k2);
      if (pitch.c[i] < thr) { prevT = null; continue; }
      const t = pitch.t[i], x = PAD.l + ((t - ax.tLeft) / ax.W) * gw, y = yOf(hzOf(pitch.m[i]));
      if (prevT === null || t - prevT > pMaxGap) sctx.moveTo(x, y); else sctx.lineTo(x, y);
      prevT = t;
    }
    sctx.stroke();
    sctx.restore();
  }
}

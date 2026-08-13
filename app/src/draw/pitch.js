// ============================== grafico del pitch ==============================
//
// Asse Y in semitoni con lo sfondo di una tastiera: i tasti neri come bande
// scure, i DO con la linea marcata e il nome. Così la nota si legge senza
// contare le tacche, che è tutto il punto del pannello.

import { pitch } from "../core/state.js";
import { BLACK, PITCH_HOP, centsStr, hzOf, noteName, parseNote } from "../audio/pitch.js";
import { pctx, pitW, pitH, PAD, PPAD } from "./canvas.js";
import { $ } from "../ui/dom.js";

const PITCH_COL = "#7ee787";                       // distinto dal blu EMG e dal magma
const pMaxGap = 2.5 * PITCH_HOP / 1000;
export const pThr = () => Math.max(0, Math.min(1, +$("pthr").value || 0));

// Il range automatico insegue i dati con un filtro lento: a inseguimento
// istantaneo l'asse ballerebbe a ogni frame e il grafico sarebbe illeggibile.
//
// Gli estremi sono PERCENTILI, non minimo e massimo: un singolo spurio d'ottava
// a un attacco schiaccerebbe altrimenti tutto il resto in mezza altezza. Chi
// esce dal quadro si vede lo stesso, perché la linea va a sbattere sul bordo —
// che è l'informazione giusta da dare, invece di nascondere l'outlier o di
// lasciargli decidere la scala. L'istogramma è per semitono, cioè esattamente la
// risoluzione che serve all'asse, e costa una passata sola senza allocazioni.
const P_TRIM = 0.02;
const pHist = new Int32Array(128);
let pRange = null;

// Passando ad automatico si riparte dai dati in vista, senza inseguire da dove
// era rimasto il range manuale.
export function resetPitchRange() { pRange = null; }

function pitchRange(ax) {
  if (!$("pauto").checked) {
    const lo = parseNote($("plo").value, 36), hi = parseNote($("phi").value, 84);
    return { lo: Math.min(lo, hi - 2), hi: Math.max(hi, lo + 2) };
  }
  pHist.fill(0);
  let tot = 0;
  const thr = pThr();
  for (let k = pitch.firstAtOrAfter(ax.tLeft); k < pitch.n; k++) {
    const i = pitch.idx(k);
    if (pitch.c[i] < thr) continue;
    const b = Math.round(pitch.m[i]);
    if (b >= 0 && b < 128) { pHist[b]++; tot++; }
  }
  let tLo, tHi;
  if (!tot) { tLo = 48; tHi = 72; }                // niente in vista: due ottave da C3
  else {
    const cut = Math.floor(tot * P_TRIM);
    let acc = 0, lo = 0, hi = 127;
    for (let b = 0; b < 128; b++) { acc += pHist[b]; if (acc > cut) { lo = b; break; } }
    acc = 0;
    for (let b = 127; b >= 0; b--) { acc += pHist[b]; if (acc > cut) { hi = b; break; } }
    const span = Math.max(12, hi - lo + 4);        // mai meno di un'ottava
    tLo = Math.round((lo + hi) / 2 - span / 2); tHi = tLo + span;
  }
  if (!pRange) pRange = { lo: tLo, hi: tHi };
  else { pRange.lo += (tLo - pRange.lo) * 0.06; pRange.hi += (tHi - pRange.hi) * 0.06; }
  return pRange;
}

export function drawPitch(ax) {
  pctx.clearRect(0, 0, pitW, pitH);
  const gw = pitW - PAD.l - PAD.r, gh = pitH - PPAD.t - PPAD.b;
  if (gw <= 0 || gh <= 0) return;

  const r = pitchRange(ax);
  const X = (t) => PAD.l + ((t - ax.tLeft) / ax.W) * gw;
  const Y = (m) => PPAD.t + gh - ((m - r.lo) / (r.hi - r.lo)) * gh;
  const semi = gh / (r.hi - r.lo);                 // pixel per semitono
  const m0 = Math.floor(r.lo), m1 = Math.ceil(r.hi);
  const thr = pThr(), from = pitch.firstAtOrAfter(ax.tLeft);

  pctx.save();
  pctx.beginPath(); pctx.rect(PAD.l, PPAD.t, gw, gh); pctx.clip();

  // tastiera
  pctx.fillStyle = "#11161d";
  for (let m = m0; m <= m1; m++) {
    if (BLACK[((m % 12) + 12) % 12]) pctx.fillRect(PAD.l, Y(m + 0.5), gw, semi);
  }
  // confini fra le note: tutti solo se c'è spazio, altrimenti solo le ottave
  pctx.lineWidth = 1;
  for (let m = m0; m <= m1; m++) {
    const isC = ((m % 12) + 12) % 12 === 0;
    if (!isC && semi < 9) continue;
    pctx.strokeStyle = isC ? "#2f3846" : "#191f28";
    const y = Math.round(Y(m - 0.5)) + .5;
    pctx.beginPath(); pctx.moveTo(PAD.l, y); pctx.lineTo(PAD.l + gw, y); pctx.stroke();
  }
  // reticolo dei tempi, con lo stesso passo del grafico EMG
  const step = ax.W <= 2 ? 0.25 : ax.W <= 6 ? 1 : ax.W <= 20 ? 2 : 5;
  pctx.strokeStyle = "#1c222c";
  for (let s = Math.ceil(ax.tLeft / step) * step; s <= ax.tNow; s += step) {
    const x = Math.round(X(s)) + .5;
    pctx.beginPath(); pctx.moveTo(x, PPAD.t); pctx.lineTo(x, PPAD.t + gh); pctx.stroke();
  }

  // La linea si interrompe quando la stima non è credibile: un tratto continuo
  // sopra il silenzio o sopra una consonante sarebbe un'invenzione.
  pctx.strokeStyle = PITCH_COL; pctx.lineWidth = 1.8; pctx.lineJoin = "round";
  pctx.beginPath();
  let prevT = null, lastGood = -1;
  for (let k = from; k < pitch.n; k++) {
    const i = pitch.idx(k);
    if (pitch.c[i] < thr) { prevT = null; continue; }
    const t = pitch.t[i], x = X(t), y = Y(pitch.m[i]);
    if (prevT === null || t - prevT > pMaxGap) pctx.moveTo(x, y); else pctx.lineTo(x, y);
    prevT = t; lastGood = i;
  }
  pctx.stroke();

  pctx.strokeStyle = "#30363d"; pctx.lineWidth = 1;
  const xc = Math.round(X(ax.tNow)) + .5;
  pctx.beginPath(); pctx.moveTo(xc, PPAD.t); pctx.lineTo(xc, PPAD.t + gh); pctx.stroke();

  if (lastGood >= 0) {
    pctx.fillStyle = PITCH_COL;
    pctx.beginPath(); pctx.arc(X(pitch.t[lastGood]), Y(pitch.m[lastGood]), 2.5, 0, 7); pctx.fill();
  }
  pctx.restore();

  // Striscia di clarity: dice quando fidarsi della linea qui sopra. Con una base
  // musicale in cassa scende subito, ed è il segnale che il valore non vale.
  const sy = PPAD.t + gh + 5;
  for (let k = from; k < pitch.n; k++) {
    const i = pitch.idx(k), x = X(pitch.t[i]);
    if (x < PAD.l || x > PAD.l + gw) continue;
    const c = pitch.c[i];
    pctx.fillStyle = c >= thr ? "#3fb950" : c >= thr * 0.75 ? "#d29922" : "#6e2c2c";
    pctx.fillRect(x, sy, 2, 3);
  }

  // Nomi delle note nei margini, fuori dal clip. Su ENTRAMBI i lati: dal vivo si
  // guarda il bordo destro, perché è lì che esce la nota che si sta cantando.
  pctx.font = "10px ui-monospace, monospace";
  pctx.textBaseline = "middle";
  for (let m = m0; m <= m1; m++) {
    const isC = ((m % 12) + 12) % 12 === 0;
    if (!isC && semi < 12) continue;
    const y = Y(m);
    if (y < PPAD.t + 4 || y > PPAD.t + gh - 4) continue;
    const nm = noteName(m);
    pctx.fillStyle = isC ? "#8b949e" : "#5a626c";
    pctx.textAlign = "right"; pctx.fillText(nm, PAD.l - 6, y);
    pctx.textAlign = "left"; pctx.fillText(nm, PAD.l + gw + 8, y);
  }

  if (lastGood >= 0) {
    const m = pitch.m[lastGood], y = Y(m);
    pctx.fillStyle = PITCH_COL; pctx.textAlign = "left"; pctx.textBaseline = "top";
    pctx.font = "11px ui-monospace, monospace";
    pctx.fillText(`${noteName(m)} ${centsStr(m)} · ${hzOf(m).toFixed(1)} Hz`, PAD.l + 6, PPAD.t + 4);

    // Targhetta all'altezza della linea, sull'asse destro: copre l'etichetta
    // fissa che le sta dietro, ed è voluto — quella che conta adesso è questa.
    if (y > PPAD.t - 1 && y < PPAD.t + gh + 1) {
      const bx = PAD.l + gw + 3, bw = PAD.r - 6;
      pctx.fillStyle = PITCH_COL;
      pctx.fillRect(bx, y - 7, bw, 14);
      pctx.fillStyle = "#0a0d12";
      pctx.font = "bold 10px ui-monospace, monospace";
      pctx.textAlign = "center"; pctx.textBaseline = "middle";
      pctx.fillText(noteName(m), bx + bw / 2, y + .5);
    }
  }
}

export { PITCH_COL, pMaxGap };

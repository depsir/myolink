// ============================== grafico del pitch ==============================
//
// Asse Y in semitoni con lo sfondo di una tastiera: i tasti neri come bande
// scure, i DO con la linea marcata e il nome. Così la nota si legge senza
// contare le tacche, che è tutto il punto del pannello.

import { pitch } from "../core/state.js";
import { BLACK, PITCH_HOP, centsStr, hzOf, noteName, parseNote } from "../audio/pitch.js";
import { pctx, pitW, pitH, PAD, PPAD } from "./canvas.js";
import { etichetteTempi, reticoloTempi } from "./tempo.js";
import { semplice } from "../ui/modo.js";
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
let pRange = null, pSnap = null;

// Passando ad automatico si riparte dai dati in vista, senza inseguire da dove
// era rimasto il range manuale.
export function resetPitchRange() { pRange = null; pSnap = null; }

// ---- l'asse del modo semplice: ottave, e sta fermo ----
//
// L'inseguimento continuo è giusto in avanzato e illeggibile nel semplice: «il
// pitch, che si autoadatta, non si capisce molto». Il difetto non è la velocità
// — il filtro è già lento — è che l'asse non ha MAI due volte la stessa scala:
// i DO scivolano, i tasti neri si spostano sotto la linea, e una nota tenuta
// ferma sembra salire perché è il fondo a scendere.
//
// Qui invece l'asse si aggancia alle OTTAVE e si muove a scatti: gli estremi
// sono sempre dei DO, il campo è un numero intero di ottave (minimo due), e
// cambia solo quando la voce sta davvero per uscire — un semitono di margine
// dentro il bordo, che è l'isteresi senza cui l'asse sbatterebbe avanti e
// indietro su ogni nota di confine. Il risultato è una tastiera che resta ferma
// per tutta una canzone, e quando si sposta lo fa di un'ottava intera: si vede
// che è successo, invece di scoprirlo dopo.
const OTT = 12;
// `vuoto` = in vista non c'è nessuna stima buona, cioè una pausa. Lì l'asse NON
// si tocca: il campo proposto sarebbe quello di ripiego (due ottave da C3) e la
// tastiera salterebbe a ogni respiro, che è il contrario di quello che serve.
function ottave(tLo, tHi, vuoto) {
  if (pSnap && (vuoto || (tLo >= pSnap.lo + 1 && tHi <= pSnap.hi - 1))) return pSnap;
  let lo = Math.floor(tLo / OTT) * OTT;
  let hi = Math.ceil(tHi / OTT) * OTT;
  while (hi - lo < 2 * OTT) { hi += OTT; if (hi - lo < 2 * OTT) lo -= OTT; }
  pSnap = { lo, hi };
  return pSnap;
}

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
  if (semplice()) return ottave(tLo, tHi, !tot);
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
  // reticolo dei tempi: la stessa funzione del grafico EMG, quindi lo stesso passo
  reticoloTempi(pctx, ax, X, PPAD.t, gh);

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

  // ---- la striscia di clarity, e perché nel semplice non c'è ----
  //
  // Dice quando fidarsi della linea qui sopra: verde sopra la soglia, gialla
  // appena sotto, rosso scuro quando la stima non è credibile — silenzio,
  // consonanti, una base in cassa che porta una seconda sorgente. È una misura
  // sulla MISURA, non sulla voce.
  //
  // Nel semplice non si disegna. Non perché sia inutile, ma perché lì non è
  // spiegata da niente e viene letta come un dato («cosa sono quei puntini rossi
  // e verdi in basso? non capisco»): una fila di puntini colorati sotto un
  // grafico sembra un secondo grafico. E soprattutto **quello che dice si vede
  // già**: sotto soglia la linea si interrompe, e un buco è più leggibile di un
  // puntino rosso. In avanzato resta, perché lì la soglia è un comando in barra e
  // la striscia è come la si tara.
  if (!semplice()) {
    const sy = PPAD.t + gh + 5;
    for (let k = from; k < pitch.n; k++) {
      const i = pitch.idx(k), x = X(pitch.t[i]);
      if (x < PAD.l || x > PAD.l + gw) continue;
      const c = pitch.c[i];
      pctx.fillStyle = c >= thr ? "#3fb950" : c >= thr * 0.75 ? "#d29922" : "#6e2c2c";
      pctx.fillRect(x, sy, 2, 3);
    }
  }

  // L'asse dei tempi, uguale a quello del sensore: i due pannelli hanno la stessa
  // finestra e gli stessi margini, e finché uno solo dei due la scriveva
  // bisognava guardare l'altro per sapere quanto si stava vedendo.
  etichetteTempi(pctx, ax, X, PAD.l, PAD.l + gw, PPAD.t + gh + 11);

  // Nomi delle note nei margini, fuori dal clip. Su ENTRAMBI i lati: dal vivo si
  // guarda il bordo destro, perché è lì che esce la nota che si sta cantando.
  pctx.font = "10px ui-monospace, monospace";
  pctx.textBaseline = "middle";
  for (let m = m0; m <= m1; m++) {
    const isC = ((m % 12) + 12) % 12 === 0;
    if (!isC && semi < 12) continue;
    const y = Y(m);
    // Il nome rientra invece di sparire, ma **solo nel semplice**: lì l'asse è
    // agganciato alle ottave e i DO cadono ESATTAMENTE sui due bordi, quindi
    // saltandoli resterebbe etichettato solo quello di mezzo — una tastiera con
    // un nome solo. In avanzato sono etichettati tutti i semitoni, e un nome
    // tirato dentro finirebbe addosso al suo vicino: lì il bordo taglia, come
    // ha sempre fatto.
    const dentro = y >= PPAD.t + 4 && y <= PPAD.t + gh - 4;
    const sposta = !dentro && semplice() && y > PPAD.t - 6 && y < PPAD.t + gh + 6;
    if (!dentro && !sposta) continue;
    const yl = dentro ? y : Math.max(PPAD.t + 5, Math.min(PPAD.t + gh - 5, y));
    const nm = noteName(m);
    pctx.fillStyle = isC ? "#8b949e" : "#5a626c";
    pctx.textAlign = "right"; pctx.fillText(nm, PAD.l - 6, yl);
    pctx.textAlign = "left"; pctx.fillText(nm, PAD.l + gw + 8, yl);
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

// ============================== pannello statistiche ==============================
//
// Servono a rispondere a "il BLE regge?" con numeri invece che a occhio. Sono
// ventisei, e ventisei tessere tutte uguali in fila non si leggono: la domanda
// che uno si fa è di UNA famiglia per volta — "il collegamento tiene", "il
// microfono sente", "cosa sta misurando" — e la risposta sta sparsa fra le
// altre due. Quindi tre gruppi con un titolo, che è l'unica cosa che serviva.
//
// Vivono solo nel modo avanzato: nel semplice non si calcolano nemmeno.

import { S, store, clock } from "../core/state.js";
import { ACT_WIN, CAL, medianSince, norm, sliceRing, snr, verdict, worst } from "../core/calib.js";
import { faticaSerie, sintesi } from "../core/fatica.js";
import { A } from "../audio/audio.js";
import { P, centsStr, noteName } from "../audio/pitch.js";
import { FT } from "./fatica.js";
import { semplice } from "./modo.js";
import { pThr } from "../draw/pitch.js";
import { $ } from "./dom.js";

// La finestra su cui si riassume lo sforzo (vedi `sint()` più sotto): dichiarata
// qui perché entra nelle etichette, che si costruiscono al caricamento.
const SINT_WIN = 60;

const COLLEGAMENTO = [
  ["trasporto", () => S.transport || "—"],
  ["pacchetti/s", () => rate(S.winPkts).toFixed(1)],
  ["campioni/s", () => rateWeighted(S.winSamples).toFixed(1), (v) => {
      const exp = 1e6 / S.dtUs; const d = Math.abs(+v - exp) / exp;
      return d < 0.02 ? "ok" : d < 0.1 ? "warn" : "bad"; }],
  ["Hz nominali", () => (1e6 / S.dtUs).toFixed(1)],
  ["campioni tot", () => S.samples.toLocaleString("it")],
  ["pacchetti persi", () => S.lostPackets + (S.packets ? " (" + (100 * S.lostPackets / (S.packets + S.lostPackets)).toFixed(2) + "%)" : ""),
    () => S.lostPackets === 0 ? "ok" : S.lostPackets / Math.max(1, S.packets) < 0.01 ? "warn" : "bad"],
  ["buffer pieno", () => S.gapFlags, () => S.gapFlags ? "bad" : "ok"],
  ["errori CRC", () => S.crcErrors, () => S.crcErrors ? "bad" : "ok"],
  ["ritardo", () => lagNow().toFixed(0) + " ms", () => {
      const l = lagNow(); return l < 2.5 * S.dtUs / 1000 ? "ok" : l < 200 ? "warn" : "bad"; }],
  ["ritardo max", () => S.maxLagMs.toFixed(0) + " ms"],
  ["jitter (σ)", () => clock.jitterMs.toFixed(1) + " ms"],
  ["skew clock", () => (clock.x0 === null ? "—" : clock.skewPpm.toFixed(0) + " ppm")],
  ["banda", () => (S.bytes / Math.max(0.001, (performance.now() - S.tStartHost) / 1000) / 1024).toFixed(2) + " kB/s"],
  ["pacchetto", () => S.mtuHint ? S.mtuHint + " B" : "—"],
];

const AUDIO = [
  ["microfono", () => A.on ? (A.sampleRate / 1000).toFixed(1) + " kHz" : "—"],
  ["livello", () => A.on ? A.rms.toFixed(0) + " dBFS" : "—", () => {
      if (!A.on) return ""; return A.rms > -1 ? "bad" : A.rms > -60 ? "ok" : "warn"; }],
  ["colonne/s", () => A.on ? rate(A.cols).toFixed(0) : "—"],
  ["clip audio", () => A.clips, () => A.clips ? "bad" : "ok"],
  ["nota", () => (A.on && isFinite(P.m) && P.c >= pThr()) ? noteName(P.m) + " " + centsStr(P.m) : "—"],
  ["clarity", () => A.on ? P.c.toFixed(2) : "—", () => {
      if (!A.on) return ""; return P.c >= pThr() ? "ok" : P.c >= pThr() * 0.75 ? "warn" : "bad"; }],
];

const MISURA = [
  // L'attivazione è la lettura per cui esiste la calibrazione: la media degli
  // ultimi 200 ms, non il campione, perché un singolo campione non si legge e
  // una soglia non ci si mette mai.
  ["attivazione", actBest],
  ["sopra il riposo", actSigma],
  // La fatica è l'unica riga di questo gruppo che NON ha bisogno della
  // calibrazione: lo zero se lo prende dalla sessione (vedi core/fatica.js).
  // Qui c'è il numero esatto; il colore, che è quello che si guarda cantando,
  // sta nel semaforo in barra.
  ["fatica (2 s)", () => (isFinite(FT.val) ? (FT.val >= 0 ? "+" : "") + FT.val.toFixed(0) + " count" : "—"),
    () => (FT.zona === "rosso" ? "bad" : FT.zona === "giallo" ? "warn" : FT.zona ? "ok" : "")],
  ["riposo", () => (isFinite(FT.base) ? FT.base.toFixed(0) + " count" : "—")],
  // Media E mediana, tutt'e due. Sulla presa del 4 settembre la media è +12 e la
  // mediana +4: la differenza sono tutti e soli i 5,4 secondi di rosso.
  // Mostrarne una sola vorrebbe dire scegliere per chi guarda quale delle due
  // domande conti — "quanto ti è costata in tutto" o "com'è andata di solito" —
  // e sono due domande diverse, tutt'e due legittime.
  [`sforzo medio (${SINT_WIN} s)`, () => cnt(sint().media)],
  [`sforzo mediano (${SINT_WIN} s)`, () => cnt(sint().mediana)],
  ["calibrazione", calText, () => calCache.lvl],
];

const GRUPPI = [
  ["Collegamento", COLLEGAMENTO],
  ["Audio", AUDIO],
  ["Misura", MISURA],
];
const STATS = GRUPPI.flatMap(([, g]) => g);

// L'unità migliore fra quelle DISPONIBILI, col nome scritto per intero: ×rif se
// l'appoggio di riferimento è misurabile, altrimenti frazione del tetto
// balistico, altrimenti i count grezzi sopra il riposo. Sull'obliquo esterno
// l'appoggio del canto comodo sta spesso a pochi count dal riposo, e in quel caso
// ×rif non esiste — ma una lettura deve esserci comunque.
function actBest() {
  if (!CAL.ready || !store.n) return "—";
  const v = medianSince(store, ACT_WIN);
  if (CAL.hasRif) return norm(v, CAL, "rif").toFixed(2) + " ×rif";
  if (isFinite(CAL.peak)) return (100 * norm(v, CAL, "peak")).toFixed(1) + " % picco";
  return (v - CAL.base).toFixed(0) + " count";
}

// La scala che c'è sempre appena il riposo è misurato, e quella su cui la 5b
// ordinerà i momenti salienti: quante σ del riposo sopra il riposo.
function actSigma() {
  if (!CAL.ready || !store.n) return "—";
  return norm(medianSince(store, ACT_WIN), CAL, "sigma").toFixed(1) + " σ";
}

// Il verdetto si ricalcola solo quando cambia la calibrazione o la cadenza, non
// cinque volte al secondo: `CAL` è sostituito in blocco da useCal, quindi
// l'identità dell'oggetto è già la chiave della cache.
// ---- media e mediana dello sforzo ----
//
// Su una finestra e non su tutta la memoria: "lo sforzo medio da quando ho aperto
// la pagina" comprende la calibrazione, le prove di microfono e i cinque minuti
// in cui si è parlato — cioè non è lo sforzo di niente. Un minuto è quanto basta
// a coprire una strofa e il ritornello.
//
// Si ricalcola ogni due secondi e non a 5 Hz: sono due mediane mobili su
// seimila campioni, e il numero che ne esce si muove di un decimo al secondo.
let sinCache = { t: -1e9, media: NaN, mediana: NaN };
function sint() {
  const now = performance.now();
  if (now - sinCache.t < 2000) return sinCache;
  sinCache = { t: now, media: NaN, mediana: NaN };
  if (!store.n || !isFinite(FT.base)) return sinCache;
  const tEnd = store.tLast();
  const { ts, vs } = sliceRing(store, tEnd - SINT_WIN, tEnd);
  if (ts.length < 40) return sinCache;
  const q = sintesi(faticaSerie(ts, vs, FT.base));
  sinCache.media = q.media; sinCache.mediana = q.mediana;
  return sinCache;
}
const cnt = (v) => (isFinite(v) ? (v >= 0 ? "+" : "") + v.toFixed(0) + " count" : "—");

let calCache = { cal: null, hz: -1, lvl: "", txt: "—" };
function calText() {
  const hz = S.dtUs ? 1e6 / S.dtUs : 0;
  if (calCache.cal !== CAL || calCache.hz !== hz) {
    const v = CAL.ready ? verdict(CAL, { hzNow: hz }) : null;
    calCache = v
      ? { cal: CAL, hz, lvl: worst(v), txt: worst(v) + " · SNR " + snr(CAL).toFixed(0) }
      : { cal: CAL, hz, lvl: "", txt: "—" };
  }
  return calCache.txt;
}

function rate(arr) {
  const cut = performance.now() - 2000;
  while (arr.length && arr[0] < cut) arr.shift();
  return arr.length / 2;
}
function rateWeighted(arr) {
  const cut = performance.now() - 2000;
  while (arr.length && arr[0][0] < cut) arr.shift();
  let s = 0; for (const [, n] of arr) s += n;
  return s / 2;
}
function lagNow() {
  if (!store.n || clock.x0 === null) return 0;
  return Math.max(0, (clock.hostToDevice(performance.now() / 1000) - store.t[store.last()]) * 1000);
}

let statsEl = null;

// Le tessere si costruiscono una volta e si tengono in un array piatto: l'ordine
// di `STATS` e quello di `celle` sono lo stesso per costruzione, quindi
// l'aggiornamento non deve cercare niente.
let celle = [];

export function setupStats() {
  statsEl = $("stats");
  celle = [];
  for (const [nome, gruppo] of GRUPPI) {
    const sec = document.createElement("section");
    sec.className = "stat-g";
    const h = document.createElement("div");
    h.className = "stat-h";
    h.textContent = nome;
    const grid = document.createElement("div");
    grid.className = "stat-grid";
    for (const [k] of gruppo) {
      const d = document.createElement("div");
      d.className = "stat";
      d.innerHTML = '<div class="k"></div><div class="v"></div>';
      d.firstChild.textContent = k;
      grid.appendChild(d);
      celle.push(d.lastChild);
    }
    sec.append(h, grid);
    statsEl.appendChild(sec);
  }
}

let lastStatsPaint = 0;
export function updateStats() {
  // Nel modo semplice non sono a schermo, e allora non si calcolano: due mediane
  // mobili e una dozzina di conversioni cinque volte al secondo per un pannello
  // che nessuno sta guardando.
  if (semplice()) return;
  const now = performance.now();
  if (now - lastStatsPaint < 200) return;      // 5 Hz: leggibile e a costo zero
  lastStatsPaint = now;
  STATS.forEach(([, get, cls], i) => {
    const el = celle[i];
    const v = String(get());
    if (el.textContent !== v) el.textContent = v;
    el.className = "v" + (cls ? " " + cls(v) : "");
  });
}

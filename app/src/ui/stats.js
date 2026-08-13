// ============================== pannello statistiche ==============================
//
// Servono a rispondere a "il BLE regge?" con numeri invece che a occhio.

import { S, store, clock } from "../core/state.js";
import { A } from "../audio/audio.js";
import { P, centsStr, noteName } from "../audio/pitch.js";
import { pThr } from "../draw/pitch.js";
import { $ } from "./dom.js";

const STATS = [
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
  ["audio", () => A.on ? (A.sampleRate / 1000).toFixed(1) + " kHz" : "—"],
  ["livello", () => A.on ? A.rms.toFixed(0) + " dBFS" : "—", () => {
      if (!A.on) return ""; return A.rms > -1 ? "bad" : A.rms > -60 ? "ok" : "warn"; }],
  ["colonne/s", () => A.on ? rate(A.cols).toFixed(0) : "—"],
  ["clip audio", () => A.clips, () => A.clips ? "bad" : "ok"],
  ["nota", () => (A.on && isFinite(P.m) && P.c >= pThr()) ? noteName(P.m) + " " + centsStr(P.m) : "—"],
  ["clarity", () => A.on ? P.c.toFixed(2) : "—", () => {
      if (!A.on) return ""; return P.c >= pThr() ? "ok" : P.c >= pThr() * 0.75 ? "warn" : "bad"; }],
];

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

export function setupStats() {
  statsEl = $("stats");
  STATS.forEach(([k]) => {
    const d = document.createElement("div");
    d.className = "stat";
    d.innerHTML = '<div class="k"></div><div class="v"></div>';
    d.firstChild.textContent = k;
    statsEl.appendChild(d);
  });
}

let lastStatsPaint = 0;
export function updateStats() {
  const now = performance.now();
  if (now - lastStatsPaint < 200) return;      // 5 Hz: leggibile e a costo zero
  lastStatsPaint = now;
  STATS.forEach(([, get, cls], i) => {
    const el = statsEl.children[i].lastChild;
    const v = String(get());
    if (el.textContent !== v) el.textContent = v;
    el.className = "v" + (cls ? " " + cls(v) : "");
  });
}

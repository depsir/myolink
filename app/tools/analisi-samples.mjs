// ============================== i numeri del 4 settembre ==============================
//
// Rifà, con un comando, TUTTE le misure su cui si regge il piano della fase 6:
//
//   node app/tools/analisi-samples.mjs
//
// Esiste perché quelle misure hanno ribaltato una conclusione presa a ragionamento,
// e la prossima volta che si cambia una costante bisogna poter rivedere subito
// l'effetto sugli stessi dati invece di ricordarsi i numeri. È il gemello di
// verify-csv.mjs e marks-csv.mjs.
//
// I dati sono in docs/samples/: tre registrazioni dello stesso pomeriggio, quindi
// stesso montaggio e valori confrontabili IN ASSOLUTO — cosa che di solito non si
// può fare, ed è metà del loro valore. Le durate dei tre mp4 coincidono con quelle
// dei CSV al centesimo, quindi i tempi stampati qui sono i tempi del video.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ACT_WIN, median, movMedian, quantile } from "../src/core/calib.js";
import { ROSSO, VERDE } from "../src/core/fatica.js";

const ROOT = dirname(dirname(dirname(new URL(import.meta.url).pathname)));
const DIR = join(ROOT, "docs/samples");
const REG = {
  silenzio: "myolink-20260904-161922",
  errore:   "myolink-20260904-162656",
  ok:       "myolink-20260904-162809",
  cane:     "myolink-20260904-163516",   // "call me a dog", giudicata "abbastanza buona"
};
// I tratti, presi dalla descrizione di chi cantava e dal profilo. Stanno qui e non
// sparsi nel codice perché sono LE ETICHETTE: l'unico dataset che esiste.
const TRATTI = [
  ["LA STROFA SBAGLIATA",     "errore",   44, 56],
  ["spinge ma va bene",       "ok",       24, 46],
  ["canta bene (errore, 1a)", "errore",    2, 34],
  ["canta bene (ok, 1a)",     "ok",        2, 22],
  ["silenzio",                "silenzio",  2, 32],
  ["call me a dog (intera)",  "cane",      2, 196],
];
const WIN = 2;                 // la finestra di lettura, in secondi
const SOGLIE = [25, 35, 45, 55, 65];

function leggi(base, pitch = false) {
  const p = join(DIR, base + (pitch ? ".pitch.csv" : ".csv"));
  let txt;
  try { txt = readFileSync(p, "utf8"); } catch { return null; }
  const righe = txt.trim().split("\n").slice(1);
  const ts = [], vs = [], cs = [];
  for (const l of righe) {
    const c = l.split(",").map(Number);
    if (!isFinite(c[0])) continue;
    ts.push(c[0]); vs.push(c[1]); if (pitch) cs.push(c[2]);
  }
  return { ts, vs, cs, t0: ts[0], dur: ts[ts.length - 1] - ts[0] };
}

// Le due grandezze in gara, lette sulla STESSA finestra: confrontare una misura a
// 2 s con una a 0.3 s direbbe più sulle finestre che sulle grandezze.
function serie(d) {
  const liv = movMedian(d.ts, d.vs, ACT_WIN);
  const len = movMedian(d.ts, liv, WIN);
  const osc = liv.map((x, i) => x - len[i]);
  const livW = new Array(liv.length).fill(NaN);
  const amp = new Array(liv.length).fill(NaN);
  let lo = 0;
  for (let i = 0; i < liv.length; i++) {
    while (d.ts[i] - d.ts[lo] > WIN) lo++;
    if (d.ts[i] - d.ts[0] < WIN) continue;
    livW[i] = median(liv.slice(lo, i + 1));
    // σ e non MAD: il livello è una mediana di INTERI, quindi osc vive su una
    // griglia da mezzo count e una MAD può solo cadere sui suoi nodi — sul
    // silenzio dava esattamente 0, cioè una divisione per zero sul riferimento.
    const n = i - lo + 1;
    let s = 0, s2 = 0;
    for (let k = lo; k <= i; k++) { s += osc[k]; s2 += osc[k] * osc[k]; }
    amp[i] = Math.sqrt(Math.max(0, s2 / n - (s / n) * (s / n)));
  }
  return { liv, livW, amp };
}

const mmss = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
const D = {}, S = {};
for (const k in REG) {
  D[k] = leggi(REG[k]);
  if (!D[k]) { console.error("manca " + join(DIR, REG[k] + ".csv")); process.exit(1); }
  S[k] = serie(D[k]);
}
const BASE = median(D.silenzio.vs);
const AMP_RIP = median(S.silenzio.amp.filter(isFinite));

console.log("=== le tre registrazioni ===");
for (const k in REG)
  console.log(`  ${k.padEnd(9)} ${D[k].dur.toFixed(1)} s · ${(D[k].ts.length / D[k].dur).toFixed(0)} Hz · ${D[k].ts.length} campioni`);
console.log(`\nriposo, dal silenzio: livello ${BASE} count · oscillazione ${AMP_RIP.toFixed(2)} count`);

const dentro = (k, a, b, campo) => {
  const out = [], d = D[k], s = S[k];
  for (let i = 0; i < d.ts.length; i++) {
    const t = d.ts[i] - d.t0;
    if (t >= a && t <= b && isFinite(s[campo][i])) out.push(campo === "livW" ? s[campo][i] - BASE : s[campo][i]);
  }
  return out;
};

console.log("\n=== la scala, in count sopra il riposo ===");
console.log("  tratto                       livello        in σ      oscillazione");
for (const [nome, k, a, b] of TRATTI) {
  const L = median(dentro(k, a, b, "livW")), A = median(dentro(k, a, b, "amp"));
  console.log(`  ${nome.padEnd(26)} ${("+" + L.toFixed(0)).padStart(6)}  ${(L / AMP_RIP).toFixed(0).padStart(6)}σ` +
              `  ${A.toFixed(2).padStart(9)}  (${(A / AMP_RIP).toFixed(1)}× il riposo)`);
}

console.log("\n=== livello o oscillazione? soglia al 5° percentile dell'errore ===");
for (const campo of ["livW", "amp"]) {
  const err = dentro(TRATTI[0][1], TRATTI[0][2], TRATTI[0][3], campo);
  const resto = TRATTI.slice(1).flatMap(([, k, a, b]) => dentro(k, a, b, campo));
  const e05 = quantile(err, 0.05);
  const falsi = resto.filter((x) => x >= e05).length;
  console.log(`  ${campo === "livW" ? "LIVELLO     " : "OSCILLAZIONE"} 5° dell'errore ${e05.toFixed(1).padStart(5)}` +
              ` · il ${(100 * falsi / resto.length).toFixed(1)}% del resto la supera`);
}
const r = (n, c) => median(dentro(TRATTI[n][1], TRATTI[n][2], TRATTI[n][3], c));
console.log(`  errore / spinge-ok:  livello ${(r(0,"livW")/r(1,"livW")).toFixed(2)}×` +
            `   oscillazione ${(r(0,"amp")/r(1,"amp")).toFixed(2)}×`);
console.log(`  il rapporto osc/liv SCENDE quando si spinge: ` +
            `${(r(2,"amp")/r(2,"livW")).toFixed(2)} cantando normale → ${(r(0,"amp")/r(0,"livW")).toFixed(2)} nell'errore`);

console.log("\n=== una soglia sola sul livello: cosa trova in ognuna ===");
for (const soglia of SOGLIE) {
  const righe = [];
  for (const k of Object.keys(REG)) {
    const d = D[k], w = S[k].livW, seg = [];
    for (let i = 0; i < w.length; i++) {
      if (!(w[i] - BASE >= soglia)) continue;
      let j = i, pk = i;
      while (j < w.length && w[j] - BASE >= soglia * 0.7) { if (w[j] > w[pk]) pk = j; j++; }
      // il livello a t descrive [t-WIN, t]: il tratto si attribuisce al centro
      const t0 = d.ts[i] - d.t0 - WIN / 2, t1 = d.ts[Math.min(j, w.length - 1)] - d.t0 - WIN / 2;
      if (t1 - t0 >= 1) seg.push(`${mmss(t0)}–${mmss(t1)} (+${(w[pk] - BASE).toFixed(0)})`);
      i = j;
    }
    righe.push(`${k} ${String(seg.length)}${seg.length ? ": " + seg.join(" ") : ""}`);
  }
  console.log(`  +${String(soglia).padStart(2)} count · ` + righe.join("  ·  "));
}

console.log("\n=== il controllo: durante l'errore stava cantando? ===");
const nomi = ["Do","Do#","Re","Re#","Mi","Fa","Fa#","Sol","Sol#","La","La#","Si"];
const nota = (m) => (isFinite(m) && m > 0 ? nomi[Math.round(m) % 12] + (Math.floor(Math.round(m) / 12) - 1) : "—");
for (const [nome, k, a, b] of TRATTI) {
  const p = leggi(REG[k], true);
  if (!p) { console.log(`  ${nome.padEnd(26)} niente pitch`); continue; }
  const seg = [];
  for (let i = 0; i < p.ts.length; i++) { const t = p.ts[i] - p.t0; if (t >= a && t <= b) seg.push(i); }
  const voce = seg.filter((i) => p.cs[i] >= 0.8);
  const ms = voce.map((i) => p.vs[i]).sort((x, y) => x - y);
  console.log(`  ${nome.padEnd(26)} voce nel ${String(Math.round(100 * voce.length / seg.length)).padStart(2)}% del tempo` +
              (ms.length ? ` · nota mediana ${nota(ms[ms.length >> 1])}` : ""));
}


// ---- il livello è solo un misuratore di quanto è acuta la nota? ----
//
// È la domanda che chi canta ha posto per primo: "anche se la nota è acuta ma vado
// giusto, la linea resta tranquilla". Se il livello seguisse l'altezza della nota,
// una soglia segnalerebbe ogni passaggio acuto — cioè il falso positivo peggiore.
//
// La risposta sta nel confronto Sol#4 fra le due prese di Man in the Box: stessa
// nota, stesso cantante, minuti di distanza.
console.log("\n=== il livello segue la nota? ===");
const nomiN = ["Do","Do#","Re","Re#","Mi","Fa","Fa#","Sol","Sol#","La","La#","Si"];
const notaN = (m) => nomiN[Math.round(m) % 12] + (Math.floor(Math.round(m) / 12) - 1);
for (const k of ["errore", "ok", "cane"]) {
  const p2 = leggi(REG[k], true);
  if (!p2) continue;
  const per = {};
  let j = 0;
  for (let i = 0; i < p2.ts.length; i++) {
    if (!(p2.cs[i] >= 0.8) || !(p2.vs[i] > 0)) continue;
    while (j < D[k].ts.length - 1 && D[k].ts[j] < p2.ts[i]) j++;
    if (!isFinite(S[k].livW[j])) continue;
    (per[Math.round(p2.vs[i])] ||= []).push(S[k].livW[j] - BASE);
  }
  const chiavi = Object.keys(per).map(Number).sort((a, b) => a - b).filter((x) => per[x].length >= 40);
  const tutte = [], note = [];
  for (const c of chiavi) for (const x of per[c]) { tutte.push(x); note.push(c); }
  const mx = tutte.reduce((a, b) => a + b, 0) / tutte.length;
  const mn = note.reduce((a, b) => a + b, 0) / note.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < tutte.length; i++) { sxy += (note[i]-mn)*(tutte[i]-mx); sxx += (note[i]-mn)**2; syy += (tutte[i]-mx)**2; }
  const alte = chiavi.filter((c) => c >= 68);
  console.log(`  ${k.padEnd(9)} r² = ${((sxy*sxy)/(sxx*syy)*100).toFixed(0)}% · ` +
    alte.map((c) => `${notaN(c)} +${median(per[c]).toFixed(0)}`).join(" · "));
}


// ---- le tre zone (fase 6c) ----
//
// Verde fino a +30: il tetto di cio' che questo cantante sostiene bene (le due
// parti "spinge ma va bene" stanno a +24 e non superano mai +32).
// Rosso oltre +55: dove vive l'errore confermato (mediana +68), e dove le prese
// buone non arrivano mai. In mezzo il giallo, che dice "e' costato piu' del tuo
// normale, e puo' darsi vada bene cosi' perche' e' difficile" — la sola cosa
// onesta da dire su un passaggio che nemmeno chi ha cantato sa giudicare.
//
// I confini sono tarati su DUE eventi etichettati di UNA sessione: si sposteranno.
// Vengono da core/fatica.js e non sono ricopiati qui: se qualcuno li sposta,
// questa tabella si rifà con i nuovi e non racconta più i vecchi.
console.log(`\n=== le tre zone · verde <+${VERDE} · giallo +${VERDE}..+${ROSSO} · rosso >+${ROSSO} ===`);
console.log("  presa       durata     verde    giallo     rosso");
for (const k of Object.keys(REG)) {
  const v = S[k].livW.filter(isFinite).map((x) => x - BASE);
  const hz = D[k].ts.length / D[k].dur;
  const g = v.filter((x) => x >= VERDE && x < ROSSO).length / hz;
  const r = v.filter((x) => x >= ROSSO).length / hz;
  const ve = v.length / hz - g - r;
  console.log(`  ${k.padEnd(9)} ${D[k].dur.toFixed(0).padStart(5)} s ${ve.toFixed(0).padStart(8)} s` +
              ` ${g.toFixed(1).padStart(8)} s ${r.toFixed(1).padStart(8)} s` +
              (r > 0 ? `   (${(100 * r / (v.length / hz)).toFixed(1)}% in rosso)` : ""));
}

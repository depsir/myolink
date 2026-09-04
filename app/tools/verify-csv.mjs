// ============================== verifica su dati veri ==============================
//
// Prende un CSV esportato dall'app e ci fa girare il modulo VERO di calibrazione:
// stesse funzioni, stesse costanti, stesso verdetto che vedrebbe l'utente. Serve a
// due cose per cui l'app non basta:
//
//  - **capire un rifiuto a freddo**, su una registrazione già fatta, senza
//    rimettere il sensore addosso a nessuno;
//  - **cambiare una costante e rivedere subito l'effetto** su una sessione reale,
//    che è il solo modo di tarare soglie senza indovinare.
//
// Uso:
//   node app/tools/verify-csv.mjs sessione.csv \
//        --rest 0:30 --max 34:38,44:48,50:54 --ha 58:74 [--rif 80:88]
//
// Gli intervalli sono in secondi dall'inizio del file (`inizio:fine`). `--rif` è
// facoltativo: senza, la scala ×rif resta spenta e il verdetto lo dice — che è
// esattamente il comportamento dell'app.
//
// Senza argomenti oltre al file stampa solo il profilo al secondo, che è come si
// trovano gli intervalli da passargli.

import { readFileSync } from "node:fs";
import {
  ACT_WIN, blockSummary, buildCal, ceiling, restStats, slowness, snr, verdict,
} from "../src/core/calib.js";

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error("uso: node verify-csv.mjs sessione.csv [--rest a:b] [--max a:b,c:d] [--ha a:b] [--rif a:b]");
  process.exit(2);
}

const arg = (name) => {
  const i = rest.indexOf("--" + name);
  return i >= 0 ? rest[i + 1] : null;
};
const ranges = (spec) => (spec || "").split(",").filter(Boolean).map((r) => r.split(":").map(Number));

// ---- il file ----
const T = [], V = [];
for (const line of readFileSync(file, "utf8").split("\n").slice(1)) {
  if (!line.trim()) continue;
  const [a, b] = line.split(",");
  T.push(+a); V.push(+b);
}
const t0 = T[0];
for (let i = 0; i < T.length; i++) T[i] -= t0;
const span = T[T.length - 1];

const dts = [];
for (let i = 1; i < T.length; i++) dts.push(T[i] - T[i - 1]);
dts.sort((a, b) => a - b);
const dt = dts[dts.length >> 1];
const attesi = Math.round(span / dt) + 1;
console.log(`${file}`);
console.log(`  ${T.length} campioni in ${span.toFixed(1)} s · passo mediano ${(dt * 1000).toFixed(2)} ms ` +
            `(${(1 / dt).toFixed(0)} Hz) · persi ${(100 * (1 - T.length / attesi)).toFixed(1)}%`);

const slice = ([a, b]) => {
  const ts = [], vs = [];
  for (let i = 0; i < T.length; i++) if (T[i] >= a && T[i] < b) { ts.push(T[i]); vs.push(V[i]); }
  return { ts, vs };
};

// ---- senza intervalli: il profilo, che è come si trovano ----
if (!arg("rest")) {
  console.log("\nprofilo (media al secondo) — da qui si leggono gli intervalli da passare:");
  const bucket = new Map();
  for (let i = 0; i < T.length; i++) {
    const k = Math.floor(T[i]);
    const b = bucket.get(k) || [0, 0];
    b[0] += V[i]; b[1]++; bucket.set(k, b);
  }
  const ks = [...bucket.keys()].sort((a, b) => a - b);
  for (let i = 0; i < ks.length; i += 20) {
    const row = ks.slice(i, i + 20).map((k) => {
      const [s, n] = bucket.get(k);
      return String(Math.round(s / n)).padStart(5);
    });
    console.log(`  ${String(ks[i]).padStart(4)}s ${row.join(" ")}`);
  }
  process.exit(0);
}

// ---- il verdetto ----
const blocks = {
  rest: ranges(arg("rest")).map(slice),
  max: ranges(arg("max")).map(slice),
  ha: ranges(arg("ha")).map(slice),
  rif: ranges(arg("rif")).map(slice),
};
// Senza un blocco del riferimento buildCal non parte: se manca, si passa il
// riposo, che è per costruzione dentro il rumore. Il verdetto dirà "×rif spenta",
// che è la verità.
if (!blocks.rif.length) blocks.rif = blocks.rest;

const hz = Math.round(1 / dt);
const cal = buildCal(blocks, { hz, t: Date.now() });
const n0 = (x) => (Number.isFinite(x) ? x.toFixed(0) : "—");

console.log("\nblocchi:");
const r = blocks.rest[0] ? restStats(blocks.rest[0].ts, blocks.rest[0].vs) : null;
for (const k of ["rest", "max", "ha", "rif"]) {
  const s = blockSummary(k, blocks[k], r);
  if (s) console.log(`  ${k.padEnd(5)} ${s}`);
}
console.log("\nnumeri:");
console.log(`  riposo ${n0(cal.base)} · ±${(cal.noise || 0).toFixed(2)}/campione · ` +
            `±${(cal.noiseLvl || 0).toFixed(2)} sulla lettura a ${ACT_WIN * 1000} ms ` +
            `(sopravvive al filtro: ${(slowness(cal) * 100).toFixed(0)}%)`);
console.log(`  tenuto ${n0(cal.max)} (+${n0(cal.max - cal.base)})  ` +
            `picco ${n0(cal.peak)} (+${n0(cal.peak - cal.base)})  ` +
            `appoggio ${n0(cal.rif)} (+${n0(cal.rif - cal.base)})`);
console.log(`  tetto usato ${n0(ceiling(cal))} · SNR ${snr(cal).toFixed(0)}`);
console.log(`  ready ${cal.ready} · hasMax ${cal.hasMax} · hasRif ${cal.hasRif}`);
console.log("\nverdetto:");
for (const v of verdict(cal, { hzNow: hz })) {
  console.log(`  ${{ ok: "✓", warn: "!", bad: "✗" }[v.level]} ${v.msg}`);
}

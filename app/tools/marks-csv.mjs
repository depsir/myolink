// ============================== i momenti su dati veri ==============================
//
// Prende un CSV esportato dall'app e ci fa girare il modulo VERO dei momenti
// salienti: stesse funzioni, stesse costanti, stessi punti che vedrebbe l'utente.
// È il gemello di verify-csv.mjs, e serve alla stessa cosa — cambiare una costante
// e rivedere subito l'effetto su una registrazione reale, che è il solo modo di
// tarare senza indovinare.
//
// Uso:
//   node app/tools/marks-csv.mjs sessione.csv [--pitch sessione-pitch.csv]
//        [--clarity 0.8] [--da 0 --a 300] [--vtt momenti.vtt] [--t0 12.5]
//
// **Il pitch è facoltativo**, e dalla fase 6 lo è davvero: il rilevatore è
// muscolare e la nota è solo un'etichetta accanto al punto. Non ci sono più né
// `--n` né `--cerca`, perché non ci sono più né lo slider né i tre rilevatori.
//
// `--vtt` scrive i capitoli da dare in pasto a VLC accanto all'mp4: è il modo di
// controllare i punti ASCOLTANDO, senza passare dall'app. `--t0` è il tempo (nella
// scala del CSV) in cui comincia il video; senza, si assume il primo campione.

import { readFileSync, writeFileSync } from "node:fs";
import { ROSSO, VERDE } from "../src/core/fatica.js";
import { analyze, markKey, mmss } from "../src/core/marks.js";
import { marksVtt } from "../src/record/export.js";

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error("uso: node marks-csv.mjs sessione.csv [--pitch p.csv] " +
                "[--clarity 0.8] [--da s --a s] [--vtt out.vtt] [--t0 s]");
  process.exit(2);
}
const arg = (name, dflt = null) => {
  const i = rest.indexOf("--" + name);
  return i >= 0 ? rest[i + 1] : dflt;
};

// ---- i file ----

function readCsv(path, cols) {
  const out = Array.from({ length: cols }, () => []);
  for (const line of readFileSync(path, "utf8").split("\n").slice(1)) {
    if (!line.trim()) continue;
    const p = line.split(",");
    for (let c = 0; c < cols; c++) out[c].push(+p[c]);
  }
  return out;
}

let [ts, vs] = readCsv(file, 2);
const da = +arg("da", -Infinity), a = +arg("a", Infinity);
if (isFinite(da) || isFinite(a)) {
  const k = ts.map((t, i) => i).filter((i) => ts[i] >= da && ts[i] <= a);
  ts = k.map((i) => ts[i]); vs = k.map((i) => vs[i]);
}
if (ts.length < 40) { console.error("troppi pochi campioni nell'intervallo."); process.exit(2); }

const pf = arg("pitch");
let pitch = null;
if (pf) {
  const [pt, pm, pc] = readCsv(pf, 3);
  const k = pt.map((t, i) => i).filter((i) => pt[i] >= ts[0] && pt[i] <= ts[ts.length - 1]);
  pitch = { ts: k.map((i) => pt[i]), m: k.map((i) => pm[i]), c: k.map((i) => pc[i]) };
}

const thr = +arg("clarity", 0.8);

// ---- il profilo, che è come si trovano gli intervalli ----

const span = ts[ts.length - 1] - ts[0];
const dts = [];
for (let i = 1; i < ts.length; i++) dts.push(ts[i] - ts[i - 1]);
dts.sort((x, y) => x - y);
const dt = dts[dts.length >> 1];
console.log(file);
console.log(`  ${ts.length} campioni in ${span.toFixed(1)} s (${mmss(span)}) · ` +
            `passo mediano ${(dt * 1000).toFixed(2)} ms (${(1 / dt).toFixed(0)} Hz)` +
            (pitch ? ` · pitch: ${pitch.ts.length} stime da ${pf}` : " · senza pitch"));
if (!pitch) console.log("  → i punti non avranno la nota accanto; il rilevamento è lo stesso.");

// ---- l'analisi vera ----

const an = analyze({ ts, vs, pitch, thr });
const q = an.rest;
console.log(`\nriposo (dai tratti quieti della registrazione, ${q.quiete}/${q.finestre} finestre):`);
console.log(`  base ${q.base.toFixed(1)} · rumore ${q.noise.toFixed(2)} per campione, ` +
            `${q.noiseLvl.toFixed(2)} sulla lettura a 300 ms`);
console.log(`  deriva ${q.driftNoto ? (q.drift >= 0 ? "+" : "") + q.drift.toFixed(1) + " count" : "non misurabile (tratti quieti in una metà sola)"}` +
            "  ← si MOSTRA, non si corregge");

const z = an.tempi, tot = z.verde + z.giallo + z.rosso;
const pc = (x) => (tot > 0 ? `${(100 * x / tot).toFixed(1)}%` : "—");
console.log(`\ntempo in zona (verde <+${VERDE} · giallo +${VERDE}…+${ROSSO} · rosso >+${ROSSO}):`);
console.log(`  verde ${z.verde.toFixed(0).padStart(5)} s ${pc(z.verde).padStart(6)}` +
            `   giallo ${z.giallo.toFixed(1).padStart(5)} s ${pc(z.giallo).padStart(6)}` +
            `   rosso ${z.rosso.toFixed(1).padStart(5)} s ${pc(z.rosso).padStart(6)}`);

const list = an.momenti;
console.log(`\n${list.length ? list.length + " momenti fuori dal verde:" : an.off}`);
for (const m of list) {
  console.log(`  ${mmss(m.t0 - ts[0]).padStart(6)}–${mmss(m.t1 - ts[0]).padEnd(6)} ` +
              `${("+" + m.val.toFixed(0)).padStart(5)}  ${m.zona.padEnd(7)}` +
              `${(m.t1 - m.t0).toFixed(1)}s  ${isFinite(m.m) ? "midi " + m.m.toFixed(1) : "—"}` +
              `   ${markKey(m)}`);
}

const out = arg("vtt");
if (out) {
  const t0 = +arg("t0", ts[0]);
  writeFileSync(out, marksVtt(list, {
    tFrom: t0,
    label: (m) => `${m.zona} +${m.val.toFixed(0)}` + (isFinite(m.m) ? " · midi " + m.m.toFixed(1) : ""),
  }));
  console.log(`\n${out} scritto (tempi dal video, che comincia a t=${t0.toFixed(2)} del CSV).`);
  console.log("  VLC: mettilo accanto all'mp4 con lo stesso nome, o trascinalo sulla finestra.");
}

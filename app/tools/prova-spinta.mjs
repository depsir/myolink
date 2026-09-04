// ============================== prova: la spinta ==============================
//
// UNA misura sola, per rispondere a UNA domanda: dove sta tirando?
//
// Nasce da due tracce vere del serial plotter — un passaggio cantato bene su una
// nota acuta, e lo stesso tipo di passaggio tirato — misurate colonna per colonna
// dalle immagini. Quello che dicono, e che non era indovinabile:
//
//   grandezza                        calmo   tirato   separa?
//   livello (mediana)                 17.5     32.0    1.9x, sì ma poco
//   AMPIEZZA dell'oscillazione         0.8      3.6    4.7x, la migliore
//   picco-picco dell'oscillazione      3.2     11.8    3.7x
//   ampiezza / livello                0.04     0.12    2.8x, la PEGGIORE
//
// AGGIORNAMENTO 4 settembre, dopo tre registrazioni vere (docs/samples).
// **Sui dati veri è il LIVELLO a separare, non l'oscillazione.** Le due salgono
// insieme e il livello sale di più: fra la strofa sbagliata e la parte che spinge
// ma va bene, livello 1.94x contro oscillazione 1.55x. Le due immagini qui sopra
// erano un altro contrasto (una nota acuta tenuta bene contro una tirata) e da due
// spezzoni non si generalizzava. Quello che invece regge, e che era il punto vero:
// **non si divide**. Il rapporto oscillazione/livello su questi dati SCENDE quando
// si spinge (1.15 cantando normale, 0.47 nella strofa sbagliata): wobble() non è
// debole, è invertito.
//
// E la scala esiste, in count sopra il riposo — è averla buttata via convertendo
// tutto in percentili interni alla registrazione il guasto dell'app:
//
//   silenzio 0 · canta normale +2/+3 · spinge ma va bene +18 (picco +32)
//   · LA STROFA SBAGLIATA +35 (picco +82)
//
// Con una soglia sola a +35 sopra il riposo: silenzio 0 tratti, presa buona 0
// tratti, presa con l'errore 1 tratto (0:46-0:52). Vedi tools/soglia.
//
// Le tre conseguenze dalle immagini, che restano il perché di questo file:
//
//  1. **Il fenomeno è l'ampiezza dell'oscillazione, non il livello.** Tirare alza
//     il livello di 1.9 volte e l'oscillazione di 4.7: il segnale sta lì.
//  2. **Non si divide per il livello.** wobble() in marks.js lo fa, per essere
//     scale-free, e così facendo butta via metà della separazione: livello e
//     oscillazione salgono INSIEME, e il rapporto le fa cancellare a vicenda.
//     È il motivo per cui "instabile" nell'app non distingue niente.
//  3. **Non è periodico.** L'autocorrelazione delle due tracce non ha picco
//     (r=0.25 sul calmo, r=-0.01 sul tirato) e gli attraversamenti al secondo sono
//     gli STESSI nei due casi. Non è un tremore a una frequenza: è mosso di più.
//     Cercare una banda 4-8 Hz sarebbe cercare una cosa che non c'è.
//
// L'unità è "quante volte più mosso del tuo normale": nessuna calibrazione, e si
// dice a voce a chi canta.
//
// Uso:
//   node app/tools/prova-spinta.mjs sessione.csv            # una registrazione dell'app
//   node app/tools/prova-spinta.mjs traccia.json --px       # una traccia estratta da immagine
//   ... [--lento 2] [--amp 2] [--soglia 2.5] [--quiete 0.2] [--min 0.8]

import { readFileSync } from "node:fs";
import { median, movMedian, MAD_SIGMA, quantile, ACT_WIN } from "../src/core/calib.js";

const args = process.argv.slice(2);
const file = args[0];
if (!file) {
  console.error("uso: node prova-spinta.mjs <sessione.csv | traccia.json --px> [--soglia 2.5]");
  process.exit(2);
}
const flag = (n, d) => { const i = args.indexOf("--" + n); return i < 0 ? d : Number(args[i + 1]); };
const has = (n) => args.includes("--" + n);

const PX = has("px");
// In pixel l'unità è la colonna. I valori vengono dalla lunghezza di correlazione
// misurata sulle due tracce (primo zero dell'autocorrelazione a ~20 colonne).
const U = PX ? { liv: 6, lento: 80, amp: 200, min: 60, nome: "colonne" }
             : { liv: ACT_WIN, lento: 2, amp: 2, min: 0.8, nome: "s" };
const W_LENTO = flag("lento", U.lento), W_AMP = flag("amp", U.amp);
const SOGLIA = flag("soglia", 2.5), Q_QUIETE = flag("quiete", 0.2), MIN = flag("min", U.min);

// ---- i dati ----
let ts, vs;
if (PX) {
  const v = JSON.parse(readFileSync(file, "utf8"));
  vs = []; ts = [];
  v.forEach((x, i) => { if (x !== null) { ts.push(i); vs.push(x); } });
} else {
  const righe = readFileSync(file, "utf8").trim().split("\n");
  const testa = righe[0].toLowerCase().split(",");
  const it = testa.findIndex((c) => /^t/.test(c.trim()));
  const iv = testa.findIndex((c) => /emg|v$|valore|adc/.test(c.trim()));
  ts = []; vs = [];
  for (const r of righe.slice(1)) {
    const c = r.split(",");
    const t = Number(c[it < 0 ? 0 : it]), v = Number(c[iv < 0 ? 1 : iv]);
    if (isFinite(t) && isFinite(v)) { ts.push(t); vs.push(v); }
  }
}
if (ts.length < 20) { console.error("troppi pochi campioni"); process.exit(1); }
const dur = ts[ts.length - 1] - ts[0];

// ---- la misura, quattro righe ----
//
// livello: la mediana a 300 ms, la stessa che usa l'app. Toglie i bozzi stretti.
const livello = movMedian(ts, vs, U.liv);
// lento: il respiro e l'andamento della frase. Si toglie perche' non e' "mosso":
// una frase che cresce non sta oscillando.
const lento = movMedian(ts, livello, W_LENTO);
// osc: quello che resta in mezzo. E' la banda dove sta il fenomeno.
const osc = livello.map((x, i) => x - lento[i]);
// amp: quanto e' grande l'oscillazione, con una MAD perche' un artefatto isolato
// non deve diventare "sta tirando".
//
// La σ e non la MAD, e non è un dettaglio: il livello è una mediana mobile di
// INTERI, quindi `osc` vive su una griglia da mezzo count, e una MAD — che è una
// mediana di distanze — può solo cadere sui nodi di quella griglia. Sui dati veri
// del 4 settembre usciva a multipli di 0.74 e sul silenzio dava **esattamente 0**,
// cioè una divisione per zero proprio sul riferimento. La σ media dei quadrati su
// duecento campioni e ne esce un numero continuo anche su dati quantizzati.
// Gli artefatti isolati, che sono la ragione per cui altrove si usa la mediana,
// qui li ha già tolti il filtro a 300 ms: quello che resta sono movimenti veri.
function ampiezza(ts, osc, win) {
  const out = new Array(osc.length).fill(NaN);
  let lo = 0;
  for (let i = 0; i < osc.length; i++) {
    while (ts[i] - ts[lo] > win) lo++;
    if (ts[i] - ts[0] < win) continue;
    const n = i - lo + 1;
    let s = 0, s2 = 0;
    for (let k = lo; k <= i; k++) { s += osc[k]; s2 += osc[k] * osc[k]; }
    out[i] = Math.sqrt(Math.max(0, s2 / n - (s / n) * (s / n)));
  }
  return out;
}
const amp = ampiezza(ts, osc, W_AMP);

// Il riferimento: il proprio normale, preso dalla registrazione stessa. Un
// percentile basso e non il minimo — il minimo e' un buco di pacchetti.
const buone = amp.filter(isFinite);
const quiete = quantile(buone, Q_QUIETE);
const spinta = amp.map((a) => (isFinite(a) && quiete > 0 ? a / quiete : NaN));

// ---- i tratti sopra soglia ----
const tratti = [];
for (let i = 0; i < spinta.length; i++) {
  if (!(spinta[i] >= SOGLIA)) continue;
  let k = i, pk = i;
  while (k < spinta.length && spinta[k] >= SOGLIA * 0.7) { if (spinta[k] > spinta[pk]) pk = k; k++; }
  // amp[i] descrive la finestra [t-W, t]: il tratto si attribuisce al CENTRO
  // delle finestre, altrimenti sbanda di mezza finestra in avanti.
  const t0 = ts[i] - W_AMP / 2, t1 = ts[Math.min(k, ts.length - 1)] - W_AMP / 2;
  if (t1 - t0 >= MIN) tratti.push({ t0, t1, t: ts[pk] - W_AMP / 2, max: spinta[pk] });
  i = k;
}

// ---- spazzata sulla banda: quale coppia di finestre separa meglio ----
//
// Serve perche' la banda giusta NON e' nota. Le due tracce da cui viene questa
// misura sono del plotter dell'Arduino IDE, che disegna quello che stampava un
// vecchio sketch: non so a che ritmo, quindi non so a che frequenza stia
// l'oscillazione che si vede li'. Il nostro grafico invece disegna ogni campione
// grezzo a 200 Hz (chart.js), che e' un'altra cosa ancora.
//
// Quindi: non si sceglie la banda a ragionamento. Si segnano due tratti su una
// registrazione vera — uno cantato bene, uno tirato — e si guarda quale coppia di
// finestre li separa. `--sweep --calmo a:b --tirato c:d`.
function intervallo(spec) {
  const [a, b] = String(spec).split(":").map(Number);
  const i = [];
  for (let k = 0; k < ts.length; k++) if (ts[k] >= a && ts[k] <= b) i.push(k);
  return i;
}
if (has("sweep") && PX) {
  console.log("\nATTENZIONE: in modalità --px i valori sono quantizzati al pixel (la MAD\n" +
              "esce a multipli di ~0.74), quindi la spazzata dice poco sulle FINESTRE.\n" +
              "Serve un CSV vero dell'app per tararle.");
}
if (has("sweep")) {
  const ic = intervallo(args[args.indexOf("--calmo") + 1]);
  const it = intervallo(args[args.indexOf("--tirato") + 1]);
  if (!ic.length || !it.length) { console.error("--calmo a:b e --tirato c:d sono obbligatori con --sweep"); process.exit(2); }
  const LENTI = PX ? [40, 80, 160, 320] : [1, 2, 4, 8];
  const AMPI  = PX ? [60, 120, 200, 320] : [0.6, 1.2, 2, 3];
  console.log(`\nspazzata: calmo ${ic.length} campioni · tirato ${it.length} campioni`);
  console.log("  lento  ampiezza   calmo  tirato   rapporto  separa");
  let best = null;
  for (const L of LENTI) {
    for (const A of AMPI) {
      const le = movMedian(ts, livello, L);
      const os = livello.map((x, i) => x - le[i]);
      const am = ampiezza(ts, os, A);
      const vc = ic.map((i) => am[i]).filter(isFinite);
      const vt = it.map((i) => am[i]).filter(isFinite);
      if (vc.length < 8 || vt.length < 8) continue;
      const mc = median(vc), mt = median(vt);
      // separa se il 95° del calmo sta sotto il 5° del tirato
      const sep = quantile(vc, 0.95) < quantile(vt, 0.05);
      const rap = mt / mc;
      if (!best || rap > best.rap) best = { L, A, rap, sep };
      console.log(`  ${String(L).padStart(5)}  ${String(A).padStart(8)}   ${mc.toFixed(2).padStart(5)}  ${mt.toFixed(2).padStart(6)}   ${rap.toFixed(2).padStart(6)}×  ${sep ? "sì" : "no"}`);
    }
  }
  if (best) console.log(`\nmigliore: lento ${best.L}, ampiezza ${best.A} ${U.nome} → ${best.rap.toFixed(1)}× ${best.sep ? "(separa)" : "(NON separa)"}`);
  process.exit(0);
}

// ---- referto ----
const n2 = (x) => (isFinite(x) ? x.toFixed(2) : "—");
const T0 = ts[0];
const rel = (t) => {
  if (PX) return (t - T0).toFixed(0);
  const s = Math.max(0, t - T0);
  return Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0") +
         "." + String(Math.round((s % 1) * 10));
};
console.log(`${file} · ${ts.length} campioni · ${dur.toFixed(1)} ${U.nome}` +
            (PX ? "" : ` · ${(ts.length / dur).toFixed(0)} Hz`));
console.log(`finestre: livello ${U.liv} · lento ${W_LENTO} · ampiezza ${W_AMP} ${U.nome}`);
console.log(`livello mediano ${median(vs).toFixed(1)} · ampiezza mediana ${n2(median(buone))}` +
            ` · quiete (${Q_QUIETE * 100}° pct) ${n2(quiete)}`);
console.log(`spinta: mediana ${n2(median(spinta.filter(isFinite)))} ×` +
            ` · 90° pct ${n2(quantile(buone, 0.9) / quiete)} ×` +
            ` · massimo ${n2(Math.max(...spinta.filter(isFinite)))} ×`);

// profilo, una riga ogni decimo di registrazione
const NB = 40;
console.log("\nprofilo (× = quante volte più mosso del normale)");
for (let b = 0; b < NB; b++) {
  const a = ts[0] + (dur * b) / NB, z = a + dur / NB;
  const seg = [];
  for (let i = 0; i < ts.length; i++) if (ts[i] >= a && ts[i] < z && isFinite(spinta[i])) seg.push(spinta[i]);
  if (!seg.length) continue;
  const m = median(seg);
  const barra = "█".repeat(Math.min(46, Math.round(m * 6)));
  const marca = m >= SOGLIA ? " ←" : "";
  console.log(`  ${rel(a).padStart(7)} ${m.toFixed(1).padStart(5)}× ${barra}${marca}`);
}

console.log(`\n${tratti.length} tratti sopra ${SOGLIA}×:`);
for (const s of tratti)
  console.log(`  ${rel(s.t0)} → ${rel(s.t1)} · picco ${s.max.toFixed(1)}× a ${rel(s.t)}`);

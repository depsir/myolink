// ============================== momenti salienti: il pannello ==============================
//
// Nessuna manopola e una striscia. Tutto il resto sta in core/marks.js e
// core/fatica.js, e qui non se ne rifà nemmeno un pezzo: questo modulo raccoglie i
// campioni, li passa, disegna, e raccoglie i sì/no di chi ascolta.
//
// **Le manopole non ci sono più, ed è la modifica.** La 5b aveva uno slider
// "quanti punti" e tre caselle; con un rilevatore solo e una soglia assoluta non
// c'è niente da scegliere, e soprattutto la lista può essere VUOTA — che su una
// performance pulita è il risultato giusto, e che con lo slider era impossibile.
//
// **La striscia panoramica è il pezzo che risponde alla richiesta.** Una lista da
// scorrere non risolve "su cinque minuti vedere subito i punti caldi": una
// striscia larga quanto la finestra, che rappresenta tutta la registrazione con
// sotto il NASTRO DELLE ZONE — verde/giallo/rosso secondo per secondo — sì. È la
// stessa cosa che il semaforo fa dal vivo, srotolata nel tempo.
//
// **Il cursore di revisione.** Cliccare un punto sposta l'asse dei tempi dei tre
// pannelli su quel momento, con il punto al centro. È un pezzo di 5c preso in
// anticipo — la 5c è la stessa cosa col video agganciato — e senza di lui la
// lista sarebbe decorativa: si potrebbe sapere che c'è un momento a 2:14 e non
// poterlo guardare.

import { S, T, pitch, store } from "../core/state.js";
import { CAL, sliceRing } from "../core/calib.js";
import { ROSSO, VERDE, WIN, Z, ZONE, colore, zona } from "../core/fatica.js";
import { analyze, markKey, mmss, pickRange } from "../core/marks.js";
import { noteName } from "../audio/pitch.js";
import { TP, playFrom, playPos, stopPlay } from "../audio/tape.js";
import { pThr } from "../draw/pitch.js";
import { PAD, dpr } from "../draw/canvas.js";
import { R, saveBlob } from "../record/recorder.js";
import { calEndT } from "./calib.js";
import { marksJson, marksVtt, stampName } from "../record/export.js";
import { $, log } from "./dom.js";

const COLS = 1024;                 // colonne dell'inviluppo e del nastro delle zone
const HIT_PX = 9;                  // quanto vicino deve essere un clic per prendere un punto
const NASTRO = 10;                 // altezza del nastro delle zone

const MK = {
  an: null,                        // l'ultima analisi
  list: [],                        // i momenti (= an.momenti, con la curatela attaccata)
  sel: null,                       // chiave del punto selezionato
  cursor: null,                    // tempo di revisione, o null = dal vivo
  range: null,                     // { t0, t1, rec } intervallo analizzato
  env: null,                       // inviluppo e nastro delle zone per la striscia
  scelte: new Map(),               // chiave → "keep" | "drop": la curatela
};

// Quello che serve a chi disegna il grafico EMG (le bande) e al ciclo di disegno.
export const marks = () => MK.list;
// L'intervallo analizzato: chi disegna le bande scrive i tempi RELATIVI a esso,
// come la lista. Un'etichetta in tempo del grafico e una riga in tempo della
// registrazione, per lo stesso punto, sono due numeri diversi.
export const range = () => MK.range;
export const selected = () => MK.sel;
// Lo zero dell'ultima analisi: il grafico lo usa per le fasce quando il semaforo
// dal vivo non ha ancora abbastanza storia (una sessione appena aperta su dati
// caricati, per esempio).
export const restBase = () => MK.an?.rest?.base ?? NaN;
// Il tempo su cui sono puntati i tre pannelli. Mentre si riascolta è la
// riproduzione a deciderlo, e i pannelli scorrono con l'audio senza nessun timer
// in più: `timeAxis()` chiama già questa a ogni fotogramma.
export const reviewT = () => (TP.playing ? playPos() : MK.cursor);

export function setupMarks() {
  legenda();
  $("btnMarks").onclick = run;
  $("mkLive").onclick = () => goto(null);
  $("mkPlay").onclick = toggleListen;
  $("btnMkVtt").onclick = saveVtt;
  $("btnMkJson").onclick = saveJson;
  const cv = $("strip");
  cv.onclick = onStripClick;
  new ResizeObserver(() => drawStrip(null)).observe(cv);
  // n/p: dal vivo, con le mani occupate, è l'unica interazione che serve davvero.
  // Non quando si sta scrivendo in un campo, o "n" sparirebbe dentro un numero.
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName)) return;
    if (e.key === "n") step(1);
    else if (e.key === "p") step(-1);
    // La barra spaziatrice scorrerebbe la pagina: qui vale la pena prendersela,
    // perché "ascolta da qui" è l'azione che si fa venti volte di fila.
    else if (e.key === " " && !$("pMarks").hidden) { e.preventDefault(); toggleListen(); }
  });
}

// La legenda ha preso il posto delle tre caselle: gli stessi tre colori, ma non
// si spengono più — non sono filtri, sono la scala. Il titolo di ognuna dice cosa
// vuol dire, che è l'unica cosa che serviva davvero delle vecchie caselle.
function legenda() {
  const box = $("mkWant");
  box.textContent = "";
  for (const z of ZONE) {
    const s = document.createElement("span");
    s.className = "zlab";
    s.title = z.help;
    s.innerHTML = '<i></i><span></span>';
    s.querySelector("i").style.background = z.col;
    s.querySelector("span").textContent =
      z.key === "verde" ? `verde <+${VERDE}` : z.key === "giallo" ? `giallo +${VERDE}…+${ROSSO}` : `rosso >+${ROSSO}`;
    box.appendChild(s);
  }
}

// ---- l'analisi ----

function run() {
  const r = rangeToAnalyze();
  if (!r) return info("nessun campione da analizzare: registra o collega il sensore.");
  const seg = sliceRing(store, r.t0, r.t1);
  if (seg.vs.length < 40) return info(`solo ${seg.vs.length} campioni nell'intervallo: troppo pochi.`);

  const p = slicePitch(pitch, r.t0, r.t1);
  const an = analyze({
    ts: seg.ts, vs: seg.vs,
    pitch: p.ts.length ? p : null,
    thr: pThr(),
    cal: CAL.ready ? CAL : null,
  });
  MK.an = an; MK.range = r;
  MK.env = envelope(seg.ts, seg.vs, an.fatica, r);
  $("pMarks").hidden = false;
  report(an, r, seg.vs.length);
  MK.list = an.momenti;
  for (const m of MK.list) m.scelta = MK.scelte.get(markKey(m)) || null;
  if (MK.sel && !MK.list.some((m) => markKey(m) === MK.sel)) MK.sel = null;
  render();
}

// L'intervallo su cui guardare lo decide core/marks.js: qui si raccolgono solo i
// tre numeri che serve sapere. `R.t0`/`R.t1` sono tempi dell'HOST e si convertono
// adesso, non quando sono stati presi: se nel frattempo si è connesso un link, la
// base dei tempi è cambiata.
function rangeToAnalyze() {
  if (!store.n) return null;
  const rec = R.t0
    ? { t0: T.fromHost(R.t0), t1: R.t1 ? T.fromHost(R.t1) : store.tLast() }
    : null;
  return pickRange({
    first: store.t[store.idx(0)], end: store.tLast(), rec, calEnd: calEndT(),
  });
}

function slicePitch(ring, tFrom, tTo) {
  const ts = [], m = [], c = [];
  for (let k = ring.firstAtOrAfter(tFrom); k < ring.n; k++) {
    const i = ring.idx(k);
    if (ring.t[i] > tTo) break;
    ts.push(ring.t[i]); m.push(ring.m[i]); c.push(ring.c[i]);
  }
  return { ts, m, c };
}

// Inviluppo min/max a colonne fisse, più la zona di ogni colonna: si calcola una
// volta per analisi e non a ogni fotogramma. Sessanta mila campioni per frame
// sarebbero sprecati per disegnare mille pixel.
//
// La zona della colonna è la PEGGIORE dei suoi campioni e non la mediana: su tre
// minuti in mille colonne, un secondo di rosso occupa mezza colonna, e una
// mediana lo cancellerebbe proprio dove il nastro serve.
function envelope(ts, vs, fatica, r) {
  const lo = new Float32Array(COLS).fill(NaN), hi = new Float32Array(COLS).fill(NaN);
  const zon = new Array(COLS).fill(null);
  const rank = { verde: 1, giallo: 2, rosso: 3 };
  const span = Math.max(1e-6, r.t1 - r.t0);
  for (let i = 0; i < vs.length; i++) {
    const c = Math.min(COLS - 1, Math.max(0, Math.floor(((ts[i] - r.t0) / span) * COLS)));
    if (!(vs[i] >= lo[c])) lo[c] = vs[i];
    if (!(vs[i] <= hi[c])) hi[c] = vs[i];
    const z = zona(fatica?.[i]);
    if (z && (!zon[c] || rank[z] > rank[zon[c]])) zon[c] = z;
  }
  return { lo, hi, zon };
}

// Il referto: nel log, che è la storia della sessione. Dice quattro cose che
// senza scriverle non si scoprirebbero — su che intervallo ha guardato, da dove
// viene il riposo, quanto tempo è stato passato in ciascuna zona, e quanti
// momenti sono usciti.
function report(an, r, n) {
  const secs = r.t1 - r.t0;
  log(`momenti: ${r.da} — ${mmss(secs)}, ${n.toLocaleString("it")} campioni`);
  if (r.da === "tutto quello in memoria") {
    log("   ! se in questo intervallo c'è la calibrazione, i suoi accenti finiscono " +
        "in lista come momenti: premi Registra prima di cantare, e Momenti guarderà " +
        "solo la registrazione.");
  }
  const q = an.rest;
  const n0 = (x) => (isFinite(x) ? x.toFixed(0) : "—");
  log(`   riposo ${n0(q.base)} ±${(q.noiseLvl || 0).toFixed(2)} sulla lettura ` +
      `(da: ${q.da}, ${q.quiete}/${q.finestre} finestre quiete)` +
      (q.driftNoto ? ` · deriva ${q.drift >= 0 ? "+" : ""}${q.drift.toFixed(0)} count in ${mmss(secs)}` : ""));
  if (q.driftNoto && Math.abs(q.drift) > 8 * (q.noiseLvl || 1)) {
    log("   ! la linea di base si è spostata durante la registrazione. Non viene corretta " +
        "(durante un brano non ci sono pause di riposo, e correggere in silenzio sarebbe " +
        "inventare uno zero): tienine conto, perché la soglia delle zone è ASSOLUTA e una " +
        "deriva la sposta tutta.");
  }
  const t = an.tempi, tot = t.verde + t.giallo + t.rosso;
  const pc = (x) => (tot > 0 ? ` (${(100 * x / tot).toFixed(1)}%)` : "");
  log(`   zone: verde ${t.verde.toFixed(0)} s · giallo ${t.giallo.toFixed(1)} s${pc(t.giallo)} · ` +
      `rosso ${t.rosso.toFixed(1)} s${pc(t.rosso)}`);
  log(`   ${an.momenti.length ? an.momenti.length + " momenti fuori dal verde" : an.off}`);
}

// ---- la lista ----

function render() {
  const ol = $("mkList");
  ol.textContent = "";
  for (const m of MK.list) {
    const key = markKey(m);
    const row = document.createElement("div");
    row.className = "mk" + (key === MK.sel ? " sel" : "") + (m.scelta ? " " + m.scelta : "");
    row.innerHTML = '<i></i><b></b><span class="mkV"></span><span class="mkT"></span>' +
                    '<span class="mkN2"></span>' +
                    '<button class="mkKeep" title="tieni">✓</button>' +
                    '<button class="mkDrop" title="scarta">✗</button>';
    row.querySelector("i").style.background = Z[m.zona].col;
    row.querySelector("b").textContent = mmss(m.t - MK.range.t0);
    // Il numero, che la 5b nascondeva di proposito. Non è una manopola: non
    // regola niente, dice quanto è costato quel passaggio — +24 tenuta bene,
    // +42 un pochino su, +68 sbagliata.
    const v = row.querySelector(".mkV");
    v.textContent = "+" + m.val.toFixed(0);
    v.style.color = Z[m.zona].col;
    row.querySelector(".mkT").textContent =
      Z[m.zona].label + " · " + (m.t1 - m.t0).toFixed(1) + " s";
    row.querySelector(".mkN2").textContent = isFinite(m.m) ? noteName(m.m) : "";
    row.onclick = () => goto(m);
    row.querySelector(".mkKeep").onclick = (e) => { e.stopPropagation(); choose(m, "keep"); };
    row.querySelector(".mkDrop").onclick = (e) => { e.stopPropagation(); choose(m, "drop"); };
    ol.appendChild(row);
  }
  const an = MK.an;
  const scelti = MK.list.filter((m) => m.scelta).length;
  const t = an?.tempi;
  info(!an ? "" :
    `${MK.range.da} ${mmss(MK.range.t1 - MK.range.t0)} · ` +
    (MK.list.length ? `${MK.list.length} momenti` : "nessun momento fuori dal verde") +
    (t ? ` · giallo ${t.giallo.toFixed(1)} s, rosso ${t.rosso.toFixed(1)} s` : "") +
    (scelti ? ` · ${MK.list.filter((m) => m.scelta === "keep").length} tenuti, ` +
              `${MK.list.filter((m) => m.scelta === "drop").length} scartati` : "") +
    (MK.cursor === null ? "" : " · in revisione " + mmss(MK.cursor - MK.range.t0)));
  $("mkLive").hidden = MK.cursor === null;
  const nastro = TP.tape?.span();
  $("mkPlay").disabled = !nastro;
  $("mkPlay").textContent = TP.playing ? "■ ferma" : "▶ ascolta";
  $("mkPlay").title = nastro
    ? "riascolta dal cursore in avanti (barra spaziatrice); i tre pannelli scorrono con l'audio"
    : "il nastro dell'audio gira solo col microfono aperto";
}

const info = (t) => { $("mkInfo").textContent = t; };

// La curatela è l'unica via alla taratura fine: le etichette che esistono sono
// due (una strofa sbagliata e una tenuta bene), e questi sì/no sono il solo modo
// in cui se ne formeranno altre — finiscono in marks.json col numero e la zona
// accanto, che è ciò che permetterà un domani di spostare i confini con criterio.
// Un secondo clic sullo stesso lato annulla la scelta: sbagliare bersaglio capita.
function choose(m, v) {
  const key = markKey(m);
  if (MK.scelte.get(key) === v) MK.scelte.delete(key); else MK.scelte.set(key, v);
  m.scelta = MK.scelte.get(key) || null;
  render();
}

// ---- riascoltare ----
//
// Il nastro gira per tutto il tempo in cui il microfono è aperto (vedi
// audio/tape.js), quindi non serve aver premuto Registra: si clicca un momento e
// si sente. Durante la riproduzione il cursore si muove da sé, cioè EMG, pitch e
// spettrogramma scorrono insieme all'audio — che è il replay della 5c senza il
// video.
function toggleListen() {
  if (TP.playing) {
    const pos = stopPlay();
    if (pos != null) MK.cursor = pos;
    return render();
  }
  const t = MK.cursor ?? MK.list[0]?.t;
  if (t == null) return info("clicca prima un punto della striscia, o un momento della lista.");
  const s = TP.tape?.span();
  if (!s) return info("niente da riascoltare: il nastro gira col microfono aperto.");
  const got = playFrom(t, (pos) => { MK.cursor = pos; render(); });
  if (got === null) {
    const da = MK.range ? mmss(Math.max(0, s.t0 - MK.range.t0)) : mmss(0);
    return info(`qui l'audio non c'è: il nastro comincia a ${da} (microfono aperto dopo).`);
  }
  MK.cursor = got;
  render();
}

function goto(m) {
  if (TP.playing) stopPlay();
  MK.sel = m ? markKey(m) : null;
  MK.cursor = m ? m.t : null;
  render();
}

function step(d) {
  if (!MK.list.length) return;
  const i = MK.list.findIndex((m) => markKey(m) === MK.sel);
  const next = i < 0 ? (d > 0 ? 0 : MK.list.length - 1)
                     : Math.max(0, Math.min(MK.list.length - 1, i + d));
  goto(MK.list[next]);
}

function onStripClick(e) {
  if (!MK.range) return;
  const cv = $("strip"), b = cv.getBoundingClientRect();
  const gw = Math.max(1, b.width - PAD.l - PAD.r);
  const f = (e.clientX - b.left - PAD.l) / gw;
  const t = MK.range.t0 + Math.max(0, Math.min(1, f)) * (MK.range.t1 - MK.range.t0);
  // Il punto più vicino, se è vicino: altrimenti si guarda semplicemente lì —
  // la striscia è anche la barra di navigazione della registrazione.
  const tol = (HIT_PX / gw) * (MK.range.t1 - MK.range.t0);
  let best = null, bd = Infinity;
  for (const m of MK.list) {
    const d = Math.abs(m.t - t);
    if (d < bd) { bd = d; best = m; }
  }
  if (best && bd <= tol) return goto(best);
  MK.sel = null; MK.cursor = t; render();
}

// ---- la striscia ----

let sctx = null;
let lastPlayInfo = 0;

export function drawStrip(ax) {
  const cv = $("strip");
  if (!cv || $("pMarks").hidden) return;
  // Il tempo che scorre mentre si ascolta, a 5 Hz: è l'unica cosa che si muove
  // fuori dai canvas, e senza di lei non si sa dove si è arrivati.
  if (TP.playing && MK.range) {
    const now = performance.now();
    if (now - lastPlayInfo > 200) {
      lastPlayInfo = now;
      info(`▶ ${mmss(playPos() - MK.range.t0)} di ${mmss(MK.range.t1 - MK.range.t0)}`);
    }
  }
  sctx = sctx || cv.getContext("2d");
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const cx = sctx;
  cx.clearRect(0, 0, w, h);
  if (!MK.range) {
    cx.fillStyle = "#6e7681"; cx.font = "11px ui-monospace, monospace";
    cx.textAlign = "center"; cx.textBaseline = "middle";
    cx.fillText("premi “Momenti” per cercare i punti caldi in quello che hai registrato", w / 2, h / 2);
    return;
  }

  const gw = Math.max(1, w - PAD.l - PAD.r);
  const eh = Math.max(10, h - NASTRO - 14);                // altezza dell'inviluppo
  const { t0, t1 } = MK.range, span = Math.max(1e-6, t1 - t0);
  const X = (t) => PAD.l + ((t - t0) / span) * gw;

  // L'inviluppo: min/max per colonna, in scala sul proprio massimo. Non è un
  // grafico da leggere, è una mappa da riconoscere — serve a dare al punto un
  // "dove" dentro il brano.
  const { lo, hi, zon } = MK.env;
  let vLo = Infinity, vHi = -Infinity;
  for (let c = 0; c < COLS; c++) {
    if (isFinite(lo[c])) vLo = Math.min(vLo, lo[c]);
    if (isFinite(hi[c])) vHi = Math.max(vHi, hi[c]);
  }
  const k = eh / Math.max(1, vHi - vLo);
  cx.fillStyle = "#2f4a68";
  for (let px = 0; px < gw; px++) {
    const c0 = Math.floor((px / gw) * COLS), c1 = Math.max(c0 + 1, Math.floor(((px + 1) / gw) * COLS));
    let a = Infinity, b = -Infinity;
    for (let c = c0; c < c1 && c < COLS; c++) {
      if (isFinite(lo[c])) a = Math.min(a, lo[c]);
      if (isFinite(hi[c])) b = Math.max(b, hi[c]);
    }
    if (!isFinite(a)) continue;
    const y0 = 2 + eh - (b - vLo) * k, y1 = 2 + eh - (a - vLo) * k;
    cx.fillRect(PAD.l + px, y0, 1, Math.max(1, y1 - y0));
  }
  // La riga del riposo: è lo zero da cui si contano i count delle zone.
  if (isFinite(MK.an?.rest?.base)) {
    const y = Math.round(2 + eh - (MK.an.rest.base - vLo) * k) + .5;
    cx.strokeStyle = "#2f3846"; cx.setLineDash([3, 3]); cx.lineWidth = 1;
    cx.beginPath(); cx.moveTo(PAD.l, y); cx.lineTo(PAD.l + gw, y); cx.stroke();
    cx.setLineDash([]);
  }

  // La finestra che i tre pannelli stanno mostrando: senza, cliccare sulla
  // striscia sposterebbe la vista senza far vedere dove è andata.
  if (ax && ax.W > 0) {
    const a = Math.max(PAD.l, X(ax.tLeft)), b = Math.min(PAD.l + gw, X(ax.tNow));
    if (b > a) {
      cx.fillStyle = "#4ea1ff18";
      cx.fillRect(a, 1, b - a, eh + 2);
      cx.strokeStyle = "#4ea1ff66";
      cx.strokeRect(Math.round(a) + .5, 1.5, Math.max(1, b - a), eh + 1);
    }
  }

  // ---- il nastro delle zone ----
  //
  // La stessa cosa che il semaforo fa dal vivo, srotolata su tutta la
  // registrazione: una riga continua, verde/giallo/rosso, sotto l'inviluppo. È
  // questa — non la lista — che risponde a "come è andata": tre minuti quasi
  // tutti verdi con due tacche rosse si leggono in un colpo d'occhio, e le
  // proporzioni fra le zone sono la stessa cosa che il referto scrive in secondi.
  //
  // Ha preso il posto delle tre corsie della 5b, che erano tre perché i
  // rilevatori erano tre.
  const yN = 2 + eh + 2;
  cx.fillStyle = "#161b22";
  cx.fillRect(PAD.l, yN, gw, NASTRO - 3);
  for (let px = 0; px < gw; px++) {
    const c0 = Math.floor((px / gw) * COLS), c1 = Math.max(c0 + 1, Math.floor(((px + 1) / gw) * COLS));
    let peggio = null;
    const rank = { verde: 1, giallo: 2, rosso: 3 };
    for (let c = c0; c < c1 && c < COLS; c++) {
      if (zon[c] && (!peggio || rank[zon[c]] > rank[peggio])) peggio = zon[c];
    }
    if (!peggio) continue;
    // Il verde è tenuto basso e scuro: è il fondo, e deve essere il giallo e il
    // rosso a saltare fuori. Con tre colori pieni la riga sarebbe una bandiera.
    cx.fillStyle = peggio === "verde" ? Z.verde.col + "55" : Z[peggio].col;
    cx.fillRect(PAD.l + px, yN, 1, NASTRO - 3);
  }
  // I momenti scelti/scartati si vedono sul nastro come una tacca più alta.
  for (const m of MK.list) {
    const x = Math.round(X(m.t));
    const on = markKey(m) === MK.sel;
    cx.fillStyle = m.scelta === "drop" ? "#6e768188" : on ? "#ffffff" : colore(m.val) + "cc";
    cx.fillRect(x - (on ? 1.5 : 0.5), yN - 3, on ? 3 : 2, NASTRO);
  }

  // Il selezionato attraversa tutto: è il "sei qui" della striscia. Mentre si
  // riascolta è la riproduzione a muoverlo, quindi la riga corre.
  const cur = reviewT();
  if (cur !== null) {
    const x = Math.round(X(cur)) + .5;
    cx.strokeStyle = "#e6edf3aa"; cx.lineWidth = 1;
    cx.beginPath(); cx.moveTo(x, 1); cx.lineTo(x, yN + NASTRO); cx.stroke();
  }

  // Tacche dei minuti, contate dall'inizio della registrazione.
  cx.fillStyle = "#6e7681"; cx.font = "10px ui-monospace, monospace";
  cx.textBaseline = "bottom";
  const stepS = span > 600 ? 120 : span > 240 ? 60 : span > 60 ? 30 : 10;
  // Fino a mezzo passo dalla fine: l'ultima tacca e la durata totale, che si
  // scrive sempre a destra, cadrebbero altrimenti una sopra l'altra.
  for (let s = 0; s <= span - stepS * 0.5; s += stepS) {
    const x = X(t0 + s);
    cx.textAlign = s === 0 ? "left" : "center";
    cx.fillText(mmss(s), x, h - 1);
  }
  cx.textAlign = "right";
  cx.fillText(mmss(span), PAD.l + gw, h - 1);
}

// ---- quello che esce ----

function saveVtt() {
  const kept = MK.list.filter((m) => m.scelta !== "drop");
  if (!kept.length) return info("niente da esportare: nessun punto tenuto.");
  const name = stampName("myolink-momenti", "vtt");
  const tFrom = R.t0 ? T.fromHost(R.t0) : MK.range.t0;
  const txt = marksVtt(kept, {
    tFrom,
    label: (m) => `${m.zona} +${m.val.toFixed(0)}` + (isFinite(m.m) ? " · " + noteName(m.m) : ""),
  });
  saveBlob(new Blob([txt], { type: "text/vtt" }), name);
  log(`momenti: ${name} — ${kept.length} punti, tempi relativi all'inizio del video`);
}

function saveJson() {
  if (!MK.list.length) return info("niente da esportare.");
  const name = stampName("myolink-momenti", "json");
  const txt = marksJson(MK.list, {
    creato: new Date().toISOString(),
    intervallo: { da: +MK.range.t0.toFixed(3), a: +MK.range.t1.toFixed(3), registrazione: MK.range.rec },
    tVideo0: R.t0 ? +T.fromHost(R.t0).toFixed(3) : null,
    riposo: MK.an.rest,
    // Le costanti con cui questi numeri sono stati prodotti: senza, fra un anno
    // un file esportato non si saprebbe più leggere. I confini SI SPOSTERANNO.
    misura: { finestra_s: WIN, verde: VERDE, rosso: ROSSO, unita: "count sopra il riposo" },
    zone: MK.an.tempi,
    clarity: MK.an.thr,
    hz: S.dtUs ? +(1e6 / S.dtUs).toFixed(1) : 0,
  });
  saveBlob(new Blob([txt], { type: "application/json" }), name);
  log(`momenti: ${name} — ${MK.list.length} punti con la curatela dentro`);
}

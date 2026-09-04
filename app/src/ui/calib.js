// ============================== procedura di calibrazione ==============================
//
// La calibrazione è un'INTERAZIONE, non un pannello: quattro blocchi cronometrati
// in cui la persona fa una cosa precisa, e alla fine un verdetto. Tutta la parte
// numerica sta in core/calib.js e qui non se ne rifà nemmeno un pezzo: questo
// modulo raccoglie finestre di tempo, le ritaglia dallo store e le passa.
//
// Due scelte che si notano usandola:
//
//  - **Ogni blocco parte con due secondi di "preparati".** Senza, il primo
//    secondo di ogni misura è il gesto che parte — e nel blocco del riposo
//    sarebbe la mano che lascia il mouse, cioè un artefatto proprio dentro il
//    dato che definisce lo zero.
//  - **Le tre prove del massimo NON si concatenano da sole.** Dopo un'espirazione
//    forzata serve respirare, e il tempo di ripresa non lo può indovinare un
//    timer: si preme Avvia quando si è pronti.

import { S, store, T } from "../core/state.js";
import {
  ACT_WIN, ADC_FULL, BLOCKS, CAL, CAL_KEY, CAL_STALE_H, blockSummary, buildCal,
  calAgeH, medianSince, parseCal, restStats, sliceRing, useCal, verdict,
} from "../core/calib.js";
import { $, log } from "./dom.js";

const LEAD_S = 2;         // "preparati"
const GRACE_MS = 400;     // il link ha un ritardo: gli ultimi campioni arrivano dopo
const MIN_HZ = 4;         // sotto questo, nel blocco non c'è abbastanza da misurare

const blocks = {};        // key → [{ts, vs}, ...], una voce per ripetizione
let run = null;           // corsa in atto
let tick = null;          // il timer che muove countdown e livello dal vivo
let barMax = ADC_FULL / 8;
const summary = {};       // key → la riga da mostrare accanto al blocco
let shown = null;         // il verdetto in mostra nel dialog
// L'ultima calibrazione COSTRUITA, accettata o no. `CAL` tiene solo quella
// attiva — una rifiutata non deve diventare attiva — ma i suoi numeri esistono e
// devono restare ispezionabili: è il percorso su cui si sbaglia, e non averlo
// raggiungibile dal banco di prova voleva dire non poterlo verificare.
let built = null;
export const lastCal = () => built;
// L'istante (tempo del grafico) in cui è finito l'ultimo blocco misurato in
// QUESTA sessione. Non serve alla calibrazione: serve ai momenti salienti, che
// senza di lui analizzerebbero anche i cinque accenti massimali — 13-17 volte un
// tenuto — e ci troverebbero dentro tutti i loro "punti caldi", lasciando il
// canto schiacciato in basso. Zero se la calibrazione è stata ripresa dal
// salvataggio: in quel caso nello store non c'è.
let calEnd = 0;
export const calEndT = () => calEnd;

const SIGN = { ok: "✓", warn: "!", bad: "✗" };
const hzNow = () => (S.dtUs ? 1e6 / S.dtUs : 0);

export function setupCalib() {
  buildSteps();
  $("btnCal").onclick = open;
  $("calRun").onclick = startNext;
  $("calClear").onclick = clear;
  $("calClose").onclick = () => $("calDlg").close();
  // Esc chiude il dialog senza passare dal pulsante: la corsa in atto va
  // annullata comunque, o resterebbe un timer a misurare una cosa che nessuno
  // sta più facendo.
  $("calDlg").addEventListener("close", () => {
    run = null;
    if (tick) { clearInterval(tick); tick = null; }
  });
  restore();
}

function open() {
  $("calDlg").showModal();
  if (!tick) tick = setInterval(onTick, 100);
  render();
}

// ---- i quattro blocchi nel dialog ----

function buildSteps() {
  const ol = $("calSteps");
  for (const b of BLOCKS) {
    const li = document.createElement("li");
    li.innerHTML = '<div class="calTop"><b></b><span class="calState"></span>' +
                   '<button class="calRedo">rifai</button></div>' +
                   '<p class="calHint"></p><p class="calSum"></p>';
    li.querySelector("b").textContent = b.label;
    li.querySelector(".calHint").textContent = b.hint;
    li.querySelector(".calRedo").onclick = () => { blocks[b.key] = []; startRun(b.key); };
    ol.appendChild(li);
  }
}

const doneReps = (key) => (blocks[key] || []).length;
const nextBlock = () => BLOCKS.find((b) => doneReps(b.key) < b.reps);

function startNext() {
  const b = nextBlock();
  if (!b) return msg("tutti i blocchi sono fatti: usa “rifai” su quello che vuoi rimisurare.");
  startRun(b.key);
}

function startRun(key) {
  if (!S.running) {
    return msg("collega il sensore, o premi Simulatore: senza campioni non c'è niente da misurare.");
  }
  const b = BLOCKS.find((x) => x.key === key);
  const now = performance.now();
  run = { key, secs: b.secs, rep: doneReps(key) + 1, reps: b.reps, tLead: now + LEAD_S * 1000, tFrom: null };
  msg("");
  render();
}

function onTick() {
  if (run) {
    const now = performance.now();
    // Il tempo del BLOCCO si prende sull'asse del grafico, non su quello
    // dell'host: è lì che sono timbrati i campioni.
    if (run.tFrom === null && now >= run.tLead) run.tFrom = T.now();
    if (run.tFrom !== null && now >= run.tLead + run.secs * 1000 + GRACE_MS) finish();
  }
  render();
}

function finish() {
  const { key, rep, reps, secs, tFrom } = run;
  const b = BLOCKS.find((x) => x.key === key);
  const seg = sliceRing(store, tFrom, tFrom + secs);
  run = null;

  if (seg.vs.length < secs * MIN_HZ) {
    return msg(`“${b.label}”: solo ${seg.vs.length} campioni in ${secs} s. ` +
               "Il link si è fermato o la cadenza è troppo bassa — rifai.");
  }
  (blocks[key] ||= []).push(seg);
  calEnd = Math.max(calEnd, tFrom + secs);
  log(`calibrazione: ${b.label}${reps > 1 ? ` — prova ${rep}/${reps}` : ""}, ` +
      `${seg.vs.length} campioni in ${secs} s`);
  // Tutti e quattro, non solo quello appena finito: gli accenti e il riferimento
  // si leggono rispetto al riposo, quindi rifare il riposo li ridefinisce.
  refreshSummaries();

  if (nextBlock()) msg(reps > 1 && rep < reps ? "riprendi fiato, poi Avvia per la prossima prova." : "");
  else apply();
}

function refreshSummaries() {
  const r0 = blocks.rest?.[0];
  const rest = r0 ? restStats(r0.ts, r0.vs) : null;
  for (const b of BLOCKS) summary[b.key] = blockSummary(b.key, blocks[b.key], rest);
}

function apply() {
  const cal = built = buildCal(blocks, { hz: hzNow(), t: Date.now() });
  if (!cal.ready) {
    // Il referto si scrive anche qui. Mandare a "guardare il verdetto nel log"
    // era sbagliato due volte: il log non lo riceveva, e il dialog modale ci sta
    // davanti. Adesso il verdetto compare QUI, che è dove si sta guardando.
    report("calibrazione rifiutata", cal);
    return msg("i quattro blocchi ci sono ma non fanno una scala. Il perché è qui sotto.");
  }
  useCal(cal);
  // Si salva da sé: riaprire la pagina non deve costare dieci minuti di prove.
  // È locale e reversibile (Azzera), e l'età la si dice a ogni ripresa.
  try { localStorage.setItem(CAL_KEY, JSON.stringify(cal)); } catch { /* modalità privata */ }
  report("calibrazione fatta");
  msg("fatto: il verdetto è qui sotto, e sul grafico compaiono le righe del riposo " +
      "e del riferimento.", "ok");
}

function clear() {
  for (const b of BLOCKS) { blocks[b.key] = []; summary[b.key] = ""; }
  calEnd = 0;
  shown = built = null;
  useCal(null);
  try { localStorage.removeItem(CAL_KEY); } catch { /* modalità privata */ }
  log("calibrazione azzerata.");
  msg("");
  render();
}

// ---- ripresa dal salvataggio ----

function restore() {
  let txt = null;
  try { txt = localStorage.getItem(CAL_KEY); } catch { /* modalità privata */ }
  const cal = txt && parseCal(txt);
  if (!cal) return;
  useCal(cal);
  const h = calAgeH(cal, Date.now());
  const age = h < 1 ? Math.round(h * 60) + " min" : h.toFixed(1) + " h";
  report(`calibrazione ripresa (${age} fa)`);
  if (h > CAL_STALE_H) {
    log(`   ${SIGN.warn} più di ${CAL_STALE_H} h: se gli elettrodi sono stati staccati e rimessi ` +
        "non vale più, e i numeri sbagliati non si vedono. Rifalla.");
  }
}

// Il referto: nel log, che resta la storia della sessione, e nel dialog, che è
// dove si guarda mentre la procedura è aperta. Prende il `cal` come parametro
// perché lo chiama anche il percorso di rifiuto, dove non è quello attivo.
function report(head, cal = CAL) {
  const ms = (s) => (s * 1000).toFixed(0) + " ms";
  const n0 = (x) => (isFinite(x) ? x.toFixed(0) : "—");
  // Due tetti e non uno: il tenuto è quello che normalizza %max, l'istantaneo
  // esce dagli accenti ed è più alto — vale la pena vederli accanto.
  log(`${head}: riposo ${n0(cal.base)} ±${(cal.noise || 0).toFixed(1)} per campione, ` +
      `±${(cal.noiseLvl || 0).toFixed(2)} sulla lettura a ${ACT_WIN * 1000} ms · ` +
      `tenuto ${n0(cal.max)} (+${n0(cal.max - cal.base)}) · appoggio ${n0(cal.rif)} count` +
      (cal.burst ? ` · accento: picco ${n0(cal.burst.picco)} (+${n0(cal.peak - cal.base)}), ` +
                   `salita ${ms(cal.burst.salita)}, durata ${ms(cal.burst.durata)}` : ""));
  shown = verdict(cal, { hzNow: hzNow() });
  for (const v of shown) log(`   ${SIGN[v.level]} ${v.msg}`);
  render();
}

// ---- disegno del dialog ----

// Il livello serve al colore: un rifiuto e un "fatto" nello stesso arancione
// facevano leggere la fine della procedura come un problema.
function msg(t, level = "warn") {
  const el = $("calMsg");
  el.textContent = t;
  el.className = t ? level : "";
}

function render() {
  BLOCKS.forEach((b, i) => {
    const li = $("calSteps").children[i];
    const n = doneReps(b.key), on = run?.key === b.key;
    li.querySelector(".calState").textContent =
      on ? "● in corso" : n >= b.reps ? SIGN.ok + (b.reps > 1 ? ` ${n}/${b.reps}` : "") :
      n ? `${n}/${b.reps}` : "—";
    li.classList.toggle("run", on);
    li.classList.toggle("done", !on && n >= b.reps);
    li.querySelector(".calRedo").disabled = !!run || !n;
    li.querySelector(".calSum").textContent = summary[b.key] || "";
  });

  const v = store.n ? medianSince(store, ACT_WIN) : NaN;
  // La barra si autoscala al picco visto da quando il dialog è aperto: a scala
  // fissa sul fondo scala dell'ADC il riposo sarebbe una barra ferma a zero, e
  // non si saprebbe se il sensore è vivo.
  if (isFinite(v)) barMax = Math.max(barMax, v * 1.15);
  $("calBar").style.width = (isFinite(v) ? Math.min(100, 100 * v / barMax) : 0) + "%";
  $("calVal").textContent = isFinite(v) ? v.toFixed(0) + " count" : "nessun campione";

  const now = performance.now();
  let head = "";
  if (run) {
    const b = BLOCKS.find((x) => x.key === run.key);
    const rep = run.reps > 1 ? ` — prova ${run.rep} di ${run.reps}` : "";
    head = run.tFrom === null
      ? `preparati… ${Math.ceil((run.tLead - now) / 1000)}`
      : `${b.label}${rep}: ${Math.max(0, Math.ceil((run.tLead + run.secs * 1000 - now) / 1000))}`;
  }
  const vd = $("calVerdict");
  vd.textContent = "";
  for (const v of shown || []) {
    const d = document.createElement("div");
    d.className = v.level;
    d.textContent = SIGN[v.level] + " " + v.msg;
    vd.appendChild(d);
  }

  $("calNow").textContent = head;
  $("calRun").disabled = !!run;
  $("calRun").textContent = nextBlock() ? "Avvia" : "Fatti tutti";
}

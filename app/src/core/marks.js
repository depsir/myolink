// ============================== momenti salienti ==============================
//
// Su una canzone di cinque minuti, vedere subito i punti caldi senza scorrere
// tutto. Questo e nient'altro: non un rilevatore di errori vocali, non un
// giudizio. Uno strumento che dice *"guarda qui, ed ecco quanto"* e raccoglie il
// sì/no di chi ha orecchie — perché chi lo usa è un insegnante di canto, non un
// tecnico.
//
// **Fase 6: un rilevatore solo.** I tre della 5b sono stati cancellati dopo le
// prime registrazioni cantate vere (`docs/samples/`, 4 settembre): "instabile"
// ordinava rumore ed era per giunta invertito, e "troppa tensione" e "sostegno
// che manca" erano i due versi della stessa misura. Quello che resta è
// `core/fatica.js` — il livello sopra il riposo — e questo modulo lo trasforma in
// una lista di momenti con un numero e una zona accanto.
//
// Tre decisioni, e sono il rovescio esatto di tre decisioni della 5b:
//
//  1. **Nessuna manopola.** Non c'è più lo slider "quanti punti": la soglia è il
//     confine del verde, e la lista può essere vuota. Consegnare venti punti
//     comunque insegnava a non fidarsi della lista.
//  2. **Il numero si mostra.** La 5b lo nascondeva di proposito, «perché un numero
//     inviterebbe a regolarlo». È l'unica informazione che distingue una canzone
//     con quattro punti caldi da una che va bene, e non regola niente: descrive.
//  3. **Soglia assoluta, non percentile.** I percentili d'ingresso della 5b
//     convertivano una scala che significa qualcosa nei quantili di QUESTA
//     registrazione, cioè buttavano via il confronto fra due prese dello stesso
//     brano — che è l'unica cosa che un insegnante vuole fare.
//
// **I falsi positivi restano preferibili**, e questa non è cambiata: il coach
// ascolta la voce e decide lui. Un punto di troppo costa dieci secondi, un punto
// mancato non si recupera — per questo la soglia sta al confine del verde e non
// più in alto, e per questo il giallo esiste.
//
// Come calib.js: niente DOM, e le sole dipendenze sono calib.js e fatica.js, che
// a loro volta non importano DOM. È codice che sbagliato non si vede — un
// percentile storto non si nota, si propaga — quindi è tutto coperto dai test.

import { ACT_WIN, levelSigma, median, movMedian, noiseSigma, quantile } from "./calib.js";
import { ZERO_Q, faticaSerie, tempiInZona, tratti } from "./fatica.js";

// ---- il riposo, preso dalla registrazione stessa ----
//
// La registrazione si divide in finestre disgiunte, si prende la frazione più
// QUIETA e da quelle esce il rumore; la base è un percentile basso del livello.
// Non il minimo assoluto: un buco di pacchetti o un artefatto isolato sarebbe il
// minimo, e diventerebbe lo zero.
//
// Le finestre sono da 1,5 s e non da dieci come in calibrazione, e la ragione è
// il brano: dentro una canzone non esistono dieci secondi di fermo. Quello che
// esiste è la PAUSA FRA DUE FRASI, che sull'addome è il rilascio inspiratorio —
// un secondo o due — ed è lì che sta il riposo vero di una registrazione cantata.
//
// **Questo zero non ha bisogno di un blocco di silenzio, ed è misurato.** Sulle
// quattro registrazioni del 4 settembre `base` vale 251,0 su tutte e quattro,
// cioè esattamente la mediana dei 34 secondi di silenzio registrati apposta:
// scarto 0,0 count anche su tre minuti di canto quasi continuo. Era la domanda
// aperta della fase 6b, e la risposta è che il blocco di silenzio non serve.
//
// **La deriva in sessione si misura e si MOSTRA, non si corregge.** Durante un
// brano continuo non ci sono pause di riposo: un detrend silenzioso sarebbe
// inventare uno zero. Se sul brano vero la deriva risulta grossa, si vede nel
// referto e si decide guardandola.
const REST_WIN = 1.5, REST_FRAC = 0.2;
const REST_Q = ZERO_Q;              // lo stesso percentile dello zero dal vivo: è la stessa grandezza

const fin = (x) => isFinite(x);

export function restFromRecording(ts, vs, cal = null) {
  const out = {
    base: NaN, noise: NaN, noiseLvl: NaN, drift: 0, driftNoto: false,
    quiete: 0, finestre: 0, da: "registrazione", secs: 0,
  };
  if (!ts?.length || ts.length !== vs.length) return out;
  out.secs = ts[ts.length - 1] - ts[0];

  const lvl = movMedian(ts, vs, ACT_WIN);
  const wins = chunks(ts, REST_WIN)
    .map((w) => ({ ...w, lev: median(lvl.slice(w.i0, w.i1)) }))
    .filter((w) => fin(w.lev));
  out.finestre = wins.length;
  if (!wins.length) {
    // Registrazione più corta di una finestra: si legge tutta come se fosse
    // quieta. È il caso dei test e di una prova di due secondi, e vale la pena
    // rispondere qualcosa invece di NaN.
    out.base = quantile(lvl.filter(fin), REST_Q);
    out.noise = noiseSigma(vs);
    out.noiseLvl = levelSigma(ts, vs);
    return withCal(out, cal);
  }

  const k = Math.max(1, Math.round(wins.length * REST_FRAC));
  const quiet = wins.slice().sort((a, b) => a.lev - b.lev).slice(0, k);
  out.quiete = quiet.length;

  out.base = quantile(lvl.filter(fin), REST_Q);
  out.noise = median(quiet.map((w) => noiseSigma(vs.slice(w.i0, w.i1))).filter(fin));
  out.noiseLvl = median(quiet.map((w) => levelSigma(ts.slice(w.i0, w.i1), vs.slice(w.i0, w.i1))).filter(fin));

  // Deriva: il livello dei tratti quieti della seconda metà meno quello della
  // prima. Le due metà si guardano SEPARATAMENTE, ognuna coi propri tratti
  // quieti, e questo non è un dettaglio: prendendo i più quieti di tutta la
  // registrazione, con una deriva in salita cadono tutti nella prima metà — cioè
  // la misura sarebbe cieca esattamente quando c'è qualcosa da vedere. Trovato
  // dai test, iniettando 60 count di deriva.
  const mid = (ts[0] + ts[ts.length - 1]) / 2;
  const a = quietLev(wins, ts, ts[0], mid), b = quietLev(wins, ts, mid, Infinity);
  if (fin(a) && fin(b)) { out.drift = b - a; out.driftNoto = true; }
  return withCal(out, cal);
}

// La calibrazione, quando c'è, migliora il RUMORE e non la base.
//
// La base va presa dalla registrazione perché è lo zero di questa registrazione:
// se gli elettrodi si sono mossi fra calibrazione e canzone, quella di calib.js è
// lo zero di un'altra cosa — e adesso che la soglia è ASSOLUTA questo conta molto
// più di prima, perché non c'è più un percentile a rendere innocuo un offset.
// Il rumore invece è misurato su dieci secondi di fermo VERO, mentre un tratto
// quieto dentro un brano contiene respiro e coda di frase: la σ della
// registrazione è quindi un limite SUPERIORE, e si tiene la più piccola delle due.
function withCal(r, cal) {
  if (!cal?.ready) return r;
  if (fin(cal.noise)) r.noise = Math.min(fin(r.noise) ? r.noise : Infinity, cal.noise);
  if (fin(cal.noiseLvl)) r.noiseLvl = Math.min(fin(r.noiseLvl) ? r.noiseLvl : Infinity, cal.noiseLvl);
  r.calBase = cal.base;
  r.da = "registrazione + calibrazione";
  return r;
}

// Il livello dei tratti quieti dentro un intervallo.
function quietLev(wins, ts, from, to) {
  const w = wins.filter((x) => ts[x.i0] >= from && ts[x.i0] < to);
  if (!w.length) return NaN;
  const k = Math.max(1, Math.round(w.length * REST_FRAC));
  return median(w.slice().sort((a, b) => a.lev - b.lev).slice(0, k).map((x) => x.lev));
}

// Finestre disgiunte a durata (non a numero di campioni): un buco di pacchetti
// non deve accorciare una finestra senza che si sappia.
function chunks(ts, winS, minN = 8) {
  const out = [];
  let i0 = 0;
  for (let i = 1; i <= ts.length; i++) {
    if (i === ts.length || ts[i] - ts[i0] >= winS) {
      if (i - i0 >= minN) out.push({ i0, i1: i });
      i0 = i;
    }
  }
  return out;
}

// La nota è un'ETICHETTA: rende leggibile un punto ("2:14 · Sol#4") e navigabile
// il replay, non lo rileva. Il rilevamento è muscolare e funziona a microfono
// chiuso — cosa che dalla fase 6 vale senza eccezioni, perché il rilevatore che
// aveva bisogno del microfono ("sostegno che manca") non c'è più.
export function noteAt(p, thr, t0, t1) {
  if (!p?.ts?.length) return NaN;
  const a = [];
  for (let i = 0; i < p.ts.length; i++) {
    if (p.ts[i] < t0) continue;
    if (p.ts[i] > t1) break;
    if (p.c[i] >= thr) a.push(p.m[i]);
  }
  return a.length ? median(a) : NaN;
}

// ---- l'analisi ----
//
// Funzione pura di (campioni, pitch, calibrazione): cinque minuti a 200 Hz sono
// 60k campioni, cioè un conto istantaneo. Non c'è più la divisione in due della
// 5b (analisi qui, scelta in `pick()`) perché non c'è più niente da scegliere: la
// lista è quella che è, e cambia solo se cambiano i dati.
export function analyze(inp) {
  const { ts, vs, pitch = null, thr = 0.8, cal = null } = inp;
  const rest = restFromRecording(ts, vs, cal);
  const span = { t0: ts?.[0] ?? 0, t1: ts?.[ts.length - 1] ?? 0 };
  const vuoto = {
    rest, span, thr, momenti: [], fatica: [],
    tempi: { verde: 0, giallo: 0, rosso: 0, muto: 0 }, n: ts?.length || 0,
  };
  if (!ts?.length || ts.length < 20 || !fin(rest.base)) {
    return { ...vuoto, off: "troppi pochi campioni per dire qualcosa" };
  }
  if (span.t1 - span.t0 < 3) {
    return { ...vuoto, off: "meno di tre secondi: la finestra di lettura ne vuole due" };
  }

  const fatica = faticaSerie(ts, vs, rest.base);
  const momenti = tratti(ts, fatica).map((m) => ({
    ...m, m: noteAt(pitch, thr, m.t0, m.t1),
  }));
  return {
    ...vuoto, fatica, momenti,
    tempi: tempiInZona(ts, fatica),
    off: momenti.length ? null : "nessun momento fuori dal verde: la lista è vuota, ed è un risultato",
  };
}

// ---- su che intervallo si guarda ----
//
// NON tutto lo store, e non è un dettaglio: nello store possono starci i cinque
// accenti massimali della calibrazione, che stanno 13-17 volte sopra un tenuto.
// Con quelli dentro, il riposo resta giusto (è un percentile basso) ma la lista
// dei momenti si riempie di calibrazione invece che di canto.
//
// Tre casi, in ordine di quanto sono affidabili, e quale sia stato **si scrive**:
// un intervallo sbagliato non produce un errore, produce punti plausibili nel
// posto sbagliato.
//
//  1. c'è una registrazione: è quella, e i tempi dei punti sono già quelli del video;
//  2. niente registrazione, ma la calibrazione è stata fatta in questa sessione: si
//     parte da dove è finita. È il caso di chi calibra, canta e preme Momenti senza
//     passare da Registra — cioè la cosa che viene naturale fare;
//  3. altrimenti tutto lo store, dicendo che è tutto lo store.
//
// Sta qui e non nella UI perché è una decisione, non un collegamento: sbagliata
// non si vede, e i test la coprono.
export const MIN_SPAN = 8;      // sotto questo non c'è niente da guardare
// Dopo l'ultimo blocco della calibrazione: il dialog si chiude, la persona si
// rimette in posizione, riprende fiato. Quei due secondi sono movimento, non
// canto, e sull'addome il movimento produce attivazione.
export const CAL_GAP = 2;

export function pickRange({ first = 0, end = 0, rec = null, calEnd = 0 } = {}) {
  if (!(end > first)) return null;
  if (rec && rec.t1 - rec.t0 > MIN_SPAN) {
    return { t0: rec.t0, t1: rec.t1, rec: true, da: "registrazione" };
  }
  if (calEnd > first && end - calEnd - CAL_GAP > MIN_SPAN) {
    return { t0: calEnd + CAL_GAP, t1: end, rec: false, da: "dopo la calibrazione" };
  }
  return { t0: first, t1: end, rec: false, da: "tutto quello in memoria" };
}

// Identità di un momento: serve alla curatela, che deve sopravvivere a un
// ricalcolo — e il ricalcolo produce oggetti nuovi, non gli stessi. Con un
// rilevatore solo basta il tempo; con tre serviva anche il tipo.
export const markKey = (m) => `t@${m.t.toFixed(2)}`;

// mm:ss, che è come si legge un punto in una canzone. Non hh:mm:ss: cinque minuti
// non hanno ore, e le due cifre in più sono rumore in una lista di righe.
export function mmss(t) {
  const s = Math.max(0, Math.round(t));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

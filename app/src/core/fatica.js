// ============================== la fatica: una misura sola ==============================
//
// Quanto costa questo passaggio, in count sopra il riposo. È l'unica grandezza
// su cui si regge la fase 6, e sostituisce i tre rilevatori della 5b — che
// ordinavano fra loro i momenti di UNA registrazione senza mai dire quanto
// fossero gravi, e che su un indice (`wobble`) si erano rivelati addirittura
// invertiti.
//
// **La misura.** Mediana mobile a 300 ms → letta con una seconda mediana su una
// finestra di 2 s → meno il riposo. Due mediane e una sottrazione: niente
// percentili, niente rapporti fra grandezze, niente girone.
//
//  - la prima mediana (`ACT_WIN`) toglie il dentellìo per campione, che
//    sull'obliquo esterno è quattro volte più grosso del fenomeno da vedere;
//  - la seconda (`WIN`) risponde alla domanda giusta, che non è "quanto stai
//    spingendo adesso" ma "quanto ti è costato questo passaggio": un attacco di
//    frase non è fatica, due secondi tenuti su sì;
//  - la sottrazione del riposo è ciò che rende il numero LEGGIBILE — +24 non è
//    un punteggio, è la distanza dal tuo zero.
//
// **Perché il livello e non l'oscillazione.** Sulle quattro registrazioni del
// 4 settembre le due grandezze salgono insieme e il livello sale di più (1,94×
// contro 1,55× fra la strofa sbagliata e la parte che spinge ma va bene); il
// rapporto fra le due — l'indice "scale-free" della 5b — SCENDE quando si
// spinge. Tutti i numeri si rifanno con `node app/tools/analisi-samples.mjs`.
//
// **E non misura l'altezza della nota**, che era la prima obiezione di chi
// canta: sullo stesso Sol#4, stessa canzone, minuti di distanza, la presa buona
// sta a +24 e quella con l'errore a +68. La nota spiega il 16–24% della varianza.
//
// Niente DOM qui dentro, come in calib.js: è codice che sbagliato non si vede.

import { ACT_WIN, median, movMedian, quantile, sliceRing } from "./calib.js";

// ---- la finestra di lettura ----
//
// 2 s: è la durata di un passaggio, non di un istante. Con una finestra corta il
// numero segue ogni attacco di frase e non si riesce a leggerlo; con una lunga si
// perde la strofa sbagliata dentro la media della canzone.
//
// Conseguenza da sapere e da non nascondere: il numero a `t` descrive
// **[t-2s, t]**, quindi dal vivo è in ritardo di un secondo sul suo centro, e i
// tratti trovati a posteriori si attribuiscono al CENTRO della finestra (vedi
// `tratti`) — altrimenti cadrebbero un secondo dopo il punto che descrivono.
export const WIN = 2;

// ---- le tre zone ----
//
// Non una soglia: tre zone. La proposta viene da chi canta, guardando la linea
// del grafico mentre cantava *Call Me a Dog*: «mi sembrava che si alzasse, ma non
// mi sembrava di andare così male… potrebbe essere una zona gialla, che potrebbe
// andare meglio oppure anche verde con sufficiente sostegno perché comunque
// difficile».
//
// I due confini sono ANCORATI ai suoi due passaggi etichettati, non scelti:
//
//  - **+30** è il tetto di ciò che sostiene bene: le due parti "spinge ma va
//    bene" stanno a +24 di mediana e non superano mai +32;
//  - **+55** è la soglia sotto cui l'errore confermato non scende: quella strofa
//    ha mediana +68, e le due prese buone non arrivano mai lì.
//
// Il giallo dice una cosa che una soglia non può dire, ed è esattamente quella
// vera: *questo passaggio è costato più del tuo normale, e può darsi vada bene
// così perché è difficile*. Non è prudenza — è la descrizione di ciò che la
// misura sa e di ciò che non sa: i tre momenti gialli di *Call Me a Dog* sono
// rimasti senza etichetta perché nemmeno chi li ha cantati sa dire se fossero
// giusti, e ci resteranno.
//
// **Sono tarati su QUEL montaggio.** Sposta gli elettrodi e non valgono più: in σ
// del riposo (0,89 count) stanno a 34σ e 62σ, in multipli del passaggio tenuto
// bene (+24) a 1,25× e 2,3×. Quale delle due unità trasferisca si decide con una
// seconda sessione, misurando; finché non c'è, restano in count e si dice.
export const VERDE = 30, ROSSO = 55;

export const ZONE = [
  {
    key: "verde", label: "verde", col: "#3fb950",
    help: "dentro quello che sostieni bene: fino a +" + VERDE + " count sopra il riposo.",
  },
  {
    key: "giallo", label: "giallo", col: "#d29922",
    help: "è costato più del tuo normale (+" + VERDE + " … +" + ROSSO + "). Può " +
          "darsi vada bene così, perché il passaggio è difficile: da riascoltare, " +
          "non da correggere per forza.",
  },
  {
    key: "rosso", label: "rosso", col: "#f85149",
    help: "oltre +" + ROSSO + ": è la fascia in cui sta l'unico errore confermato " +
          "che abbiamo registrato. Le prese buone non ci arrivano mai.",
  },
];
export const Z = Object.fromEntries(ZONE.map((z) => [z.key, z]));

// `null` e non "verde" quando il numero non c'è: i primi due secondi di una
// registrazione non sono verdi, sono senza misura — e vanno disegnati come tali.
export function zona(f) {
  if (!isFinite(f)) return null;
  return f >= ROSSO ? "rosso" : f >= VERDE ? "giallo" : "verde";
}
export const colore = (f) => Z[zona(f)]?.col || "#6e7681";

// ---- la serie ----
//
// Allineata a `ts`, `NaN` finché la finestra non è piena: i primi due secondi non
// hanno una lettura, e un valore parziale sarebbe più basso del vero proprio
// all'inizio, cioè dove ci si fida di più.
export function faticaSerie(ts, vs, base) {
  const out = new Array(ts.length).fill(NaN);
  if (ts.length < 2 || !isFinite(base)) return out;
  const liv = movMedian(ts, vs, ACT_WIN);
  const len = movMedian(ts, liv, WIN);
  for (let i = 0; i < ts.length; i++) if (ts[i] - ts[0] >= WIN) out[i] = len[i] - base;
  return out;
}

// ---- dal vivo ----
//
// La stessa misura, letta sulla coda del ring. `ACT_WIN` in più davanti perché la
// prima mediana ha bisogno del suo margine: senza, i 300 ms più vecchi della
// finestra sarebbero calcolati su mezza finestra.
export function faticaOra(ring, base) {
  if (!ring?.n || !isFinite(base)) return NaN;
  const tEnd = ring.tLast();
  const { ts, vs } = sliceRing(ring, tEnd - WIN - ACT_WIN, tEnd);
  if (ts.length < 8 || tEnd - ts[0] < WIN) return NaN;
  const liv = movMedian(ts, vs, ACT_WIN);
  const coda = [];
  for (let i = 0; i < ts.length; i++) if (ts[i] >= tEnd - WIN) coda.push(liv[i]);
  return coda.length ? median(coda) - base : NaN;
}

// ---- lo zero, senza chiedere niente a nessuno ----
//
// Il 5° percentile del livello a 300 ms sulla coda della sessione. Non serve un
// blocco di silenzio, e non è una comodità: sulle quattro registrazioni del
// 4 settembre questo numero dà **251,0 su tutte e quattro**, cioè esattamente la
// mediana dei 34 secondi di silenzio registrati apposta — scarto 0,0 count anche
// su *Call Me a Dog*, che sono tre minuti di canto quasi continuo.
//
// Funziona perché dentro una canzone il riposo esiste comunque: è la PAUSA FRA
// DUE FRASI, che sull'addome è il rilascio inspiratorio. Un percentile basso la
// trova; il minimo assoluto no, quello sarebbe un buco di pacchetti.
//
// Non il minimo, non la media delle finestre quiete, e non `CAL.base`: se gli
// elettrodi si sono mossi fra la calibrazione e il canto, quello è lo zero di
// un'altra cosa. Lo zero di questa sessione lo dice questa sessione.
export const ZERO_Q = 0.05;
export const ZERO_WIN = 120;      // su quanta storia si guarda
// **Cinque secondi, non venti.** La prima stesura ne chiedeva venti per una
// ragione vera — con dieci secondi di canto il "riposo" sarebbe la frase più
// piana — ma li chiedeva a chiunque, anche a chi il sensore lo accende e sta
// fermo, che è quello che fa chiunque apra l'app. Venti secondi di schermo che
// dice «sto misurando» prima di rispondere sono la prima cosa che si vede, e
// non è vero che servano: cinque secondi di quiete bastano al 5° percentile,
// perché su cinque secondi fermi la distribuzione è tutta riposo.
//
// Il caso brutto resta e si paga così com'è: chi parte cantando ottiene uno zero
// troppo alto, cioè una fatica sottostimata, per i primi secondi. Si corregge da
// sé — la finestra è mobile su due minuti e lo zero si ricalcola ogni secondo —
// e comunque è meglio di un numero che non arriva.
export const ZERO_MIN = 5;        // sotto questo non si risponde: sarebbe il canto più piano

export function zeroVivo(ring, { win = ZERO_WIN, min = ZERO_MIN } = {}) {
  if (!ring?.n) return NaN;
  const tEnd = ring.tLast();
  const { ts, vs } = sliceRing(ring, tEnd - win, tEnd);
  if (ts.length < 8 || tEnd - ts[0] < min) return NaN;
  const liv = movMedian(ts, vs, ACT_WIN).filter(isFinite);
  return liv.length ? quantile(liv, ZERO_Q) : NaN;
}

// ---- i tratti fuori dal verde ----
//
// Un momento è un tratto che ESCE DAL VERDE e ci resta per almeno un secondo.
// Una soglia sola, che è anche il confine del verde: non c'è un secondo numero da
// tarare, e la lista può — e deve — essere vuota su una performance pulita. Era
// il difetto peggiore della 5b, che consegnava venti punti comunque.
//
// L'uscita è più bassa dell'ingresso (isteresi, come per gli accenti in
// calib.js): con una soglia sola il rumore sul fronte di discesa spezzerebbe un
// tratto in tre.
export const USCITA = 0.7;
export const MIN_S = 1;

export function tratti(ts, f, opt = {}) {
  const { soglia = VERDE, uscita = USCITA, minS = MIN_S } = opt;
  const out = [];
  const esci = soglia * uscita;
  for (let i = 0; i < f.length; i++) {
    if (!(f[i] >= soglia)) continue;
    let j = i, pk = i;
    while (j < f.length && f[j] >= esci) { if (f[j] > f[pk]) pk = j; j++; }
    // Il valore a `t` descrive [t-WIN, t]: il tratto si attribuisce al CENTRO
    // della finestra, altrimenti comparirebbe un secondo dopo il punto che
    // descrive — e su un video si andrebbe a riguardare la battuta sbagliata.
    const t0 = ts[i] - WIN / 2, t1 = ts[Math.min(j, f.length - 1)] - WIN / 2;
    if (t1 - t0 >= minS) out.push({ t0, t1, t: ts[pk] - WIN / 2, val: f[pk], zona: zona(f[pk]) });
    i = j;
  }
  return out;
}

// ---- quanto tempo in ciascuna zona ----
//
// È più eloquente di qualunque elenco di momenti, ed è la riga che distingue le
// registrazioni buone da quella sbagliata: sui samples, 0 s di rosso nella presa
// "ok", 2,1 s in *Call Me a Dog* (1%) e 5,4 s nella strofa sbagliata (7,5%) —
// sette volte tanto, in un file lungo un terzo.
export function tempiInZona(ts, f) {
  const out = { verde: 0, giallo: 0, rosso: 0, muto: 0 };
  for (let i = 1; i < ts.length; i++) {
    const dt = ts[i] - ts[i - 1];
    if (!(dt > 0) || dt > 1) continue;              // un buco di pacchetti non è tempo cantato
    out[zona(f[i]) || "muto"] += dt;
  }
  return out;
}

// ---- media e mediana di una serie di fatica ----
//
// Le due si tengono ENTRAMBE, e non è indecisione. Sulla presa del 4 settembre
// la media è +12 e la mediana +4: la differenza sono tutti e soli quei 5,4
// secondi di rosso. Mostrarne una sola dal vivo vorrebbe dire scegliere per chi
// guarda quale dei due significati conti — "quanto ti è costata in tutto" oppure
// "com'è andata di solito" — e sono due domande diverse, tutt'e due legittime.
// Stanno insieme fra le misure avanzate, dove un riassunto ha senso.
//
// I `NaN` dei primi due secondi si saltano: non sono zeri, sono assenza di misura.
export function sintesi(f) {
  const ok = [];
  for (const v of f) if (isFinite(v)) ok.push(v);
  if (!ok.length) return { n: 0, media: NaN, mediana: NaN };
  let s = 0;
  for (const v of ok) s += v;
  ok.sort((a, b) => a - b);
  const h = ok.length >> 1;
  return {
    n: ok.length,
    media: s / ok.length,
    mediana: ok.length % 2 ? ok[h] : (ok[h - 1] + ok[h]) / 2,
  };
}

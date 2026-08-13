// ============================== registrazione ==============================
//
// Un canvas di composizione fuori schermo riceve a ogni fotogramma i tre canvas
// esistenti, impilati; `captureStream` lo trasforma in una traccia video, e la
// traccia audio del microfono entra nello STESSO MediaStream. Da lì un solo
// MediaRecorder.
//
// È il punto chiave di tutta la fase: la sincronia audio/video la dà il
// recorder, che timbra le due tracce con lo stesso orologio. Non c'è niente da
// allineare a mano — e l'`offset` audio dell'header agisce sul disegno, quindi
// finisce dentro il video da sé: il file mostra esattamente quello che si vedeva
// a schermo.
//
// Ambito: solo esportazione. Nessuna riapertura di sessione, nessuna timeline.

import { store } from "../core/state.js";
import { busLive, closeBus, openBus } from "../audio/bus.js";
import { cv, dpr, pitCv, specCv } from "../draw/canvas.js";
import { composeLayout } from "./layout.js";
import { emgCsv, extFor, stampName, supportedMimes, videoBitrate } from "./export.js";
import { $, log, setLabel } from "../ui/dom.js";

const FPS = 30;
const GAP = 8;                 // pixel di fondo fra uno strato e l'altro
const BG = "#0a0d12";          // lo stesso fondo dei pannelli: i canvas sono trasparenti

// L'ordine è quello a schermo, e non è alfabetico: il pitch sta in mezzo perché
// è quello che si confronta a occhio col sensore.
const LAYERS = [
  { key: "emg", cv, box: "recEmg" },
  { key: "pitch", cv: pitCv, box: "recPitch" },
  { key: "spec", cv: specCv, box: "recSpec" },
];

export const R = {
  rec: null, mime: "", chunks: [], bytes: 0, t0: 0,
  out: null, cx: null, rects: [], src: null,
  get on() { return !!this.rec; },
};

// L'avvio ha un'attesa dentro (il bus audio che parte), e in quella finestra il
// pulsante è ancora premibile: senza questo, due clic aprirebbero due
// registrazioni sullo stesso canvas.
let starting = false;

export async function toggleRecord() {
  if (R.on) return R.rec.stop();          // il resto lo fa onstop
  if (starting) return;
  if (typeof MediaRecorder === "undefined") {
    return log("registrazione: MediaRecorder non disponibile in questo browser.");
  }

  // Si registra alla risoluzione a cui l'app disegna davvero (pixel del
  // dispositivo, non CSS). Uno strato spento, nascosto o compresso misura 0 e
  // composeLayout lo scarta.
  const layers = LAYERS.filter((l) => $(l.box).checked)
    .map((l) => ({ key: l.key, w: l.cv.width, h: l.cv.height }));
  const L = composeLayout(layers, GAP);
  if (!L.rects.length) {
    return log("registrazione: nessuno strato da includere — spunta un pannello visibile.");
  }

  const out = document.createElement("canvas");
  out.width = L.w; out.height = L.h;
  // `alpha: false`: il fondo è opaco per costruzione e l'encoder non deve
  // inventarsi cosa c'è dietro.
  const cx = out.getContext("2d", { alpha: false });

  // Il controllo dei formati si fa qui — prima di aprire il bus — solo per non
  // accendere il microfono a vuoto quando non c'è niente da negoziare; la scelta
  // vera avviene dopo, provando a costruire (vedi buildRecorder).
  const mimes = supportedMimes((t) => MediaRecorder.isTypeSupported(t));
  if (!mimes.length) return log("registrazione: nessun formato supportato dal browser.");

  // La traccia audio è sempre quella del bus, mai quella del microfono: il bus
  // esiste per tutta la registrazione e il microfono si aggancia al suo grafo
  // quando c'è. Così premere Registra prima di aprire il microfono non produce
  // più un file muto — vedi audio/bus.js.
  //
  // Si aspetta che il bus stia davvero emettendo PRIMA di catturare il video e
  // di far partire il recorder: le due tracce devono cominciare insieme, o la
  // sincronia se ne va (il perché dell'attesa sta in bus.js).
  let audio;
  starting = true;
  // finally e non due assegnamenti: se l'apertura del bus salta, il pulsante deve
  // restare premibile invece di bloccarsi in "sto partendo".
  try { audio = await openBus(); } finally { starting = false; }

  const tracks = out.captureStream(FPS).getVideoTracks();
  if (audio) tracks.push(audio);

  const vbr = videoBitrate(L.w, L.h, FPS);
  const { rec, mime, err } = buildRecorder(new MediaStream(tracks), mimes, vbr);
  if (!rec) {
    closeBus();
    return log("registrazione: " + (err?.name || "errore") + " — " + (err?.message || mimes[0]));
  }

  Object.assign(R, {
    // Qui `mime` è quello CHIESTO, ed è giusto così: appena costruito il recorder
    // `rec.mimeType` non dice ancora niente di nuovo (rieccheggia la richiesta),
    // perché il livello del profilo lo rinegozia quando l'encoder parte davvero.
    // Il valore vero si legge alla chiusura — vedi save().
    rec, mime, chunks: [], bytes: 0, t0: performance.now(),
    out, cx, rects: L.rects,
    src: Object.fromEntries(LAYERS.map((l) => [l.key, l.cv])),
  });

  rec.ondataavailable = (e) => {
    if (e.data?.size) { R.chunks.push(e.data); R.bytes += e.data.size; }
    showInfo();
  };
  rec.onerror = (e) => log("registrazione: " + (e.error?.name || "errore"));
  rec.onstop = save;
  // Un chunk al secondo: serve a poter mostrare quanto sta pesando il file
  // mentre si registra, non a spezzarlo.
  rec.start(1000);

  drawComposite();                      // il primo fotogramma senza aspettare il raf
  setLabel($("btnRec"), "Ferma e salva", "Stop");
  $("btnRec").classList.add("danger");
  showInfo();
  // Il bitrate lo si rilegge dal recorder invece di ristampare quello chiesto:
  // `videoBitsPerSecond` è un desiderio, e sapere cosa il browser ha accettato
  // davvero è l'unico modo di capire un file venuto male senza indovinare.
  // Il MIME è quello chiesto e non il negoziato, che a questo punto è la stessa
  // stringa: il livello vero si sa solo a encoder partito, e lo stampa save().
  const got = Math.round((rec.videoBitsPerSecond || vbr) / 1e5) / 10;
  log(`registrazione avviata: ${L.w}×${L.h}, ${got} Mb/s, ${mime}` + audioNote(audio));
  // La risoluzione del file non è una scelta della registrazione: è quella a cui
  // l'app sta disegnando, cioè pixel CSS per dpr. Su un monitor non-Retina sono
  // metà per lato — un quarto dei pixel — e nessun bitrate lo recupera, quindi
  // conviene dirlo qui e non lasciarlo scoprire riguardando il file.
  if (dpr < 2) {
    log(`   → dpr ${dpr}: si registra a risoluzione CSS. Su uno schermo Retina lo stesso video esce col doppio dei pixel per lato.`);
  }
  log("   → non cambiare scheda: il disegno si ferma e il video prende un fotogramma lunghissimo.");
}

// Il primo formato che il browser dichiara di sapere fare non è detto che sappia
// anche costruire: chiediamo il profilo H.264 High, e dove l'encoder è software
// (OpenH264 fa solo baseline) il sì di `isTypeSupported` diventa un'eccezione
// proprio qui. Si scende lungo la lista invece di rinunciare — un file in
// baseline è comunque meglio di nessun file — e si tiene l'ULTIMO errore, che è
// quello del candidato meno ambizioso e quindi il più informativo sul perché
// nemmeno lui è passato.
function buildRecorder(stream, mimes, vbr) {
  let err = null;
  for (const mime of mimes) {
    try {
      return { rec: new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: vbr }), mime };
    } catch (e) { err = e; }
  }
  return { err };
}

// Il microfono chiuso non è più un file muto per sempre, e la riga di log deve
// dire quale dei tre casi è: si sente, si sentirà appena apri, non si sentirà mai.
function audioNote(track) {
  if (!track) return " (senza audio: Web Audio non disponibile)";
  return busLive() ? " (con audio)" : " (muto per ora: apri il microfono e l'audio entra da lì in avanti)";
}

// Chiamata dal ciclo di disegno di main.js DOPO i tre pannelli, così compone
// fotogrammi già completi.
export function drawComposite() {
  if (!R.cx) return;
  R.cx.fillStyle = BG;
  R.cx.fillRect(0, 0, R.out.width, R.out.height);
  for (const r of R.rects) {
    const s = R.src[r.key];
    // Un pannello compresso a metà registrazione misura 0 e la sua banda resta
    // fondo: drawImage con sorgente vuota sarebbe un'eccezione, non un no-op.
    if (!s.width || !s.height) continue;
    // La geometria del file non può cambiare a registrazione avviata, quindi il
    // rettangolo è quello fissato all'inizio: se l'utente tira il grip, il
    // pannello viene scalato dentro lo spazio che aveva. Meglio una scalatura
    // che un file che cambia formato a metà.
    R.cx.drawImage(s, r.x, r.y, r.w, r.h);
  }
}

function save() {
  const secs = (performance.now() - R.t0) / 1000;
  // Adesso — e non all'avvio — `rec.mimeType` dice cosa c'è davvero nei chunk: il
  // livello del profilo H.264 il browser lo rinegozia quando l'encoder parte
  // (chiesto `640028`, nel file `640020`), e il blob deve dichiarare il
  // contenuto, non l'intenzione. Va letto PRIMA che il reset azzeri R.rec.
  const mime = R.rec?.mimeType || R.mime;
  const blob = new Blob(R.chunks, { type: mime });
  const name = stampName("myolink", extFor(mime));

  // Qui i dati sono già stati consegnati (onstop arriva dopo l'ultimo
  // ondataavailable), quindi il bus si può spegnere: il microfono, se aperto,
  // resta aperto e la prossima registrazione se lo ritrova.
  closeBus();

  R.rec = null; R.chunks = []; R.cx = R.out = null; R.rects = [];
  setLabel($("btnRec"), "Registra", "Rec");
  $("btnRec").classList.remove("danger");
  $("recInfo").textContent = "";

  if (!blob.size) return log("registrazione: nessun dato, niente da salvare.");
  saveBlob(blob, name);
  // Il bitrate MEDIO effettivo, che è l'unico numero che dice se il tetto chiesto
  // all'avvio è servito o è rimasto lì: con pannelli quasi fermi il file esce a
  // una frazione del budget, ed è quello il comportamento giusto.
  log(`registrazione salvata: ${name} — ${secs.toFixed(1)} s, ${mb(blob.size)}` +
      `, ${(blob.size * 8 / secs / 1e6).toFixed(1)} Mb/s medi, ${mime}`);
}

export function exportCsv() {
  if (!store.n) return log("CSV: nessun campione da esportare.");
  const name = stampName("myolink", "csv");
  saveBlob(new Blob([emgCsv(store)], { type: "text/csv" }), name);
  log(`CSV salvato: ${name} — ${store.n.toLocaleString("it")} campioni`);
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  a.click();
  // Revocare subito annullerebbe un download appena iniziato: l'URL va tenuto
  // vivo finché il browser non ha letto il blob.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const p2 = (n) => String(n).padStart(2, "0");
const mb = (b) => (b / (1 << 20)).toFixed(1) + " MB";

function showInfo() {
  const s = (performance.now() - R.t0) / 1000;
  $("recInfo").textContent = `● ${Math.floor(s / 60)}:${p2(Math.floor(s % 60))} · ${mb(R.bytes)}`;
}

// La scheda in background è il limite vero di questo approccio, non un dettaglio:
// requestAnimationFrame viene sospeso, il canvas non cambia più e captureStream
// tiene l'ultimo fotogramma per tutta la durata. Meglio trovarselo scritto nel
// log che scoprirlo riguardando il file.
document.addEventListener("visibilitychange", () => {
  if (R.on && document.hidden) log("registrazione: scheda in background, il video si ferma finché non torni.");
});

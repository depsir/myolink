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
import { A } from "../audio/audio.js";
import { cv, pitCv, specCv } from "../draw/canvas.js";
import { composeLayout } from "./layout.js";
import { emgCsv, extFor, pickMime, stampName } from "./export.js";
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

export function toggleRecord() {
  if (R.on) return R.rec.stop();          // il resto lo fa onstop
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

  const tracks = out.captureStream(FPS).getVideoTracks();
  // La decisione sull'audio si prende QUI: una traccia aggiunta a registrazione
  // avviata non entrerebbe nel file. Microfono chiuso = video muto, e lo diciamo.
  const mic = A.on ? A.stream?.getAudioTracks()[0] : null;
  if (mic) tracks.push(mic);

  const mime = pickMime((t) => MediaRecorder.isTypeSupported(t));
  if (!mime) return log("registrazione: nessun formato supportato dal browser.");

  let rec;
  try {
    rec = new MediaRecorder(new MediaStream(tracks), {
      mimeType: mime,
      // ~0.12 bit per pixel per fotogramma: il contenuto è grafica vettoriale su
      // fondo scuro, dove i bitrate da fotocamera sono soldi buttati. Lo
      // spettrogramma è l'unico strato che sporca davvero, e sta nei limiti.
      videoBitsPerSecond: Math.round(Math.min(12e6, Math.max(2e6, L.w * L.h * FPS * 0.12))),
    });
  } catch (e) {
    return log("registrazione: " + (e?.name || "errore") + " — " + (e?.message || mime));
  }

  Object.assign(R, {
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
  log(`registrazione avviata: ${L.w}×${L.h}, ${mime}` + (mic ? " (con audio)" : " (senza audio: microfono chiuso)"));
  log("   → non cambiare scheda: il disegno si ferma e il video prende un fotogramma lunghissimo.");
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
  const blob = new Blob(R.chunks, { type: R.mime });
  const name = stampName("myolink", extFor(R.mime));

  R.rec = null; R.chunks = []; R.cx = R.out = null; R.rects = [];
  setLabel($("btnRec"), "Registra", "Rec");
  $("btnRec").classList.remove("danger");
  $("recInfo").textContent = "";

  if (!blob.size) return log("registrazione: nessun dato, niente da salvare.");
  saveBlob(blob, name);
  log(`registrazione salvata: ${name} — ${secs.toFixed(1)} s, ${mb(blob.size)}`);
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

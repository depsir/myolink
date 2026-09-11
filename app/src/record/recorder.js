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
// Una registrazione non è solo il video: allo stop si congelano anche i CAMPIONI
// dell'intervallo registrato, in CSV, con lo stesso nome del file video. Il
// perché sta in save(): lo store è un anello, e "salvo dopo" è il caso normale.
//
// Ambito: solo esportazione. Nessuna riapertura di sessione, nessuna timeline.

import { T, pitch, store } from "../core/state.js";
import { busLive, closeBus, openBus } from "../audio/bus.js";
import { cv, dpr, pitCv, specCv } from "../draw/canvas.js";
import { composeLayout } from "./layout.js";
import {
  countInRange, emgCsv, extFor, pitchCsv, stamp, supportedMimes, videoBitrate,
} from "./export.js";
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

// `t0` e `t1` sopravvivono alla fine della registrazione, e servono: sono
// l'ancora fra il tempo del grafico e quello del video, cioè quello che permette
// alla fase 5b di analizzare l'INTERVALLO REGISTRATO invece di tutto lo store,
// alla 5c di saltare al punto giusto del file, e a save() di tagliare i CSV
// esattamente sul video.
export const R = {
  rec: null, mime: "", chunks: [], bytes: 0, t0: 0, t1: 0,
  // Il file finito, TENUTO invece di scaricato da sé. Lo scarica il pulsante
  // "Salva video + CSV", e alla fase 5c è da qui che il replay prenderà il video.
  blob: null, name: "", secs: 0,
  // Se è finita sul disco oppure no. Il download avveniva e nessuno se ne
  // ricordava: "le ho scaricate o no?" era una delle cinque domande a cui la
  // fase 7 doveva rispondere, e senza questo flag non è rispondibile — né dal
  // distintivo sulla scheda della presa, né dalla domanda prima di buttarla.
  saved: false,
  // I dati della registrazione, congelati allo stop: `[{ name, blob, n, cosa }]`.
  // Sono ciò che l'utente si aspetta trovando un pulsante "salva" dopo aver
  // registrato — il video mostra la prova, questi la rendono rianalizzabile — e
  // NON sono il CSV di tutta la memoria, che è un altro pulsante.
  data: [],
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

  // La registrazione precedente sta in RAM e non ce ne stanno due: se non è stata
  // salvata, lo si dice invece di buttarla in silenzio.
  if (R.blob) {
    // Se era già stata salvata non è una perdita: il file è sul disco, e dirlo
    // con le stesse parole di quando invece si perde davvero qualcosa
    // insegnerebbe a non leggere l'avviso.
    log(`registrazione precedente (${dur(R.secs)}, ${fileSize(R.blob.size)}` +
        `${R.data.length ? " + CSV" : ""}) ` +
        (R.saved ? "tolta dalla memoria: era già salvata." : "buttata: non era stata salvata."));
    dimentica();
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
    rec, mime, chunks: [], bytes: 0, t0: performance.now(), t1: 0,
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
  // "Ferma" e non "Ferma e salva": allo stop il file resta in memoria, e
  // l'etichetta non deve promettere un download che non avviene.
  setLabel($("btnRec"), "Ferma", "Stop");
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
  // Il cronometro qui: è il posto che gira a ogni fotogramma finché si registra.
  showInfo();
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
  R.t1 = performance.now();
  const secs = (R.t1 - R.t0) / 1000;
  // Adesso — e non all'avvio — `rec.mimeType` dice cosa c'è davvero nei chunk: il
  // livello del profilo H.264 il browser lo rinegozia quando l'encoder parte
  // (chiesto `640028`, nel file `640020`), e il blob deve dichiarare il
  // contenuto, non l'intenzione. Va letto PRIMA che il reset azzeri R.rec.
  const mime = R.rec?.mimeType || R.mime;
  const blob = new Blob(R.chunks, { type: mime });
  // Un timbro solo per tutti i file di questa registrazione: `myolink-<data>.mp4`
  // e `myolink-<data>.csv` si riconoscono come lo stesso pezzo di prova stando
  // uno accanto all'altro nella cartella dei download. Timbrare ogni file per
  // conto suo darebbe due timbri a un secondo di distanza.
  const base = "myolink-" + stamp();
  const name = base + "." + extFor(mime);
  // I dati si congelano ADESSO e non al salvataggio: lo store è un anello, e a
  // 1 kHz tiene ~7 minuti — riascoltarsi, guardare i Momenti e poi salvare
  // vorrebbe dire trovare l'inizio della prova già mangiato da quello che è
  // arrivato dopo. Costa qualche MB di testo accanto a un video di cento.
  const data = snapshotData(base);

  // Qui i dati sono già stati consegnati (onstop arriva dopo l'ultimo
  // ondataavailable), quindi il bus si può spegnere: il microfono, se aperto,
  // resta aperto e la prossima registrazione se lo ritrova.
  closeBus();

  R.rec = null; R.chunks = []; R.cx = R.out = null; R.rects = [];
  setLabel($("btnRec"), "Registra", "Rec");
  $("btnRec").classList.remove("danger");
  $("recInfo").textContent = ""; shown = "";

  if (!blob.size) return log("registrazione: nessun dato, niente da salvare.");
  // NON si scarica da sé, e il cambio è voluto: premere Stop e vedersi comparire
  // un file nei download prima di aver guardato com'è venuto è la cosa che
  // sembrava strana a chi lo usa — e a ragione, perché fra Stop e "lo tengo" in
  // mezzo c'è il riascolto. Il file resta in memoria e lo scarica un pulsante.
  R.blob = blob; R.name = name; R.data = data; R.secs = secs; R.saved = false;
  showSave();
  // Il bitrate MEDIO effettivo, che è l'unico numero che dice se il tetto chiesto
  // all'avvio è servito o è rimasto lì: con pannelli quasi fermi il file esce a
  // una frazione del budget, ed è quello il comportamento giusto.
  log(`registrazione pronta: ${dur(secs)}, ${fileSize(blob.size)}` +
      `, ${(blob.size * 8 / secs / 1e6).toFixed(1)} Mb/s medi, ${mime}`);
  // Cosa c'è DENTRO la registrazione, oltre al video: è la riga che risponde alla
  // domanda "e i dati?" senza doverli scaricare per scoprirlo.
  if (data.length) {
    log("   → dati dell'intervallo registrato: " +
        data.map((f) => `${f.n.toLocaleString("it")} ${f.cosa} (${f.name})`).join(", "));
  } else {
    log("   ! nessun dato nell'intervallo: era registrato solo il video. " +
        "Collega il sensore (o apri il microfono) PRIMA di premere Registra.");
  }
  log('   → "Momenti" la analizza; "Salva video + CSV" la porta via, tutta insieme. ' +
      "Resta in memoria fino alla prossima registrazione o al ricaricamento della pagina.");
}

// I campioni dell'intervallo registrato, in CSV, pronti da scaricare.
//
// L'intervallo è quello del video: `R.t0`/`R.t1` sono tempi dell'HOST e si
// convertono qui, perché la conversione passa dalla regressione del clock e più
// tardi (o dopo una riconnessione) darebbe un altro intervallo. Gli estremi sono
// gli stessi che usa la ricerca dei momenti, quindi CSV, video e punti parlano
// dello stesso pezzo di tempo.
//
// Due file e non uno, come per l'export di tutta la memoria: EMG e pitch hanno
// due basi dei tempi diverse e fonderli vorrebbe dire interpolarne uno. Un file
// vuoto non si scrive affatto — sarebbe un dato perso travestito da intestazione.
function snapshotData(base) {
  const range = { t0: T.fromHost(R.t0), t1: T.fromHost(R.t1) };
  const out = [];
  for (const f of [
    { name: base + ".csv", ring: store, csv: emgCsv, cosa: "campioni" },
    { name: base + ".pitch.csv", ring: pitch, csv: pitchCsv, cosa: "stime di pitch" },
  ]) {
    const n = countInRange(f.ring, range);
    if (!n) continue;
    // Blob e non stringa: il testo di dieci minuti a 1 kHz sono ~12 MB, e come
    // blob il browser può tenerselo fuori dalla memoria della pagina.
    const blob = new Blob([f.csv(f.ring, range)], { type: "text/csv" });
    out.push({ name: f.name, blob, n, cosa: f.cosa });
  }
  return out;
}

// Il pulsante esiste solo quando c'è qualcosa da salvare, e dice quanto pesa:
// senza il peso non si sa se sono 3 MB o 300. Dice anche COSA porta via: il
// dubbio "i CSV che scarico sono quelli della registrazione?" si risolve
// sull'etichetta, non provando.
function showSave() {
  const b = $("btnSave");
  b.hidden = !R.blob;
  if (!R.blob) return;
  // Durata e peso: la prima dice QUALE prova è, il secondo cosa costa portarsela
  // via. Sull'etichetta corta resta il peso, che è il numero che conta quando si
  // sta per scaricare su una rete telefonica; la durata è comunque nel log.
  const size = fileSize(R.blob.size);
  setLabel(b, `Salva video${R.data.length ? " + CSV" : ""} (${dur(R.secs)} · ${size})`,
           "Salva " + size);
}

// Video e dati escono insieme, con lo stesso nome e in un clic solo: sono una
// prova, non tre file da ricomporre a mano.
export function saveRecording() {
  if (!R.blob) return log("nessuna registrazione in memoria.");
  saveBlob(R.blob, R.name);
  for (const f of R.data) saveBlob(f.blob, f.name);
  // Da qui in poi la presa è sul disco, e l'app lo sa: il distintivo sulla
  // scheda cambia, e tornare al vivo smette di essere una domanda.
  R.saved = true;
  showSave();
  log(`registrazione salvata: ${R.name} — ${dur(R.secs)}, ${fileSize(R.blob.size)}` +
      R.data.map((f) => `, ${f.name} — ${f.n.toLocaleString("it")} ${f.cosa}`).join(""));
  // Il permesso per "più download" lo chiede Chrome la prima volta e la richiesta
  // non spiega perché: meglio trovarne il motivo scritto qui sotto.
  if (R.data.length) log("   → se il browser chiede il permesso per più download, sono i CSV accanto al video.");
}

// Buttare la presa, su richiesta esplicita. È l'altra metà di "Salva": senza,
// l'unico modo di liberarsi di una registrazione venuta male era registrarne
// un'altra sopra — cioè scoprire per tentativi che la memoria ne tiene una sola.
//
// Non chiede conferma qui dentro: la domanda, quando serve, la fa chi ha il
// contesto per formularla (vedi la conferma del ritorno al vivo). Questa è la
// via in cui l'utente ha già detto di sì.
export function discardRecording() {
  if (!R.blob) return false;
  const era = `${dur(R.secs)}, ${fileSize(R.blob.size)}`;
  const salvata = R.saved;
  dimentica();
  log(`presa eliminata (${era})` + (salvata ? " — il file salvato sul disco resta." : " — non era stata salvata."));
  return true;
}

// Il pezzo comune fra "la butto io" e "la sovrascrive la prossima": dimenticare
// una presa è una cosa sola, e scriverla due volte vorrebbe dire dimenticare un
// campo in uno dei due punti.
function dimentica() {
  R.blob = null; R.name = ""; R.data = []; R.secs = 0; R.saved = false;
  showSave();
}

// Il CSV di TUTTO quello che c'è in memoria, registrazione o no: è l'altro
// pulsante, e la differenza va detta ogni volta nel log. Chi ha appena registrato
// e vuole i dati *di quella prova* usa "Salva video + CSV" — questo qui gliene
// darebbe di più, compresa la calibrazione e le prove di prima.
export function exportCsv() {
  if (!store.n && !pitch.n) return log("CSV live: nessun campione in memoria.");
  const base = "myolink-live-" + stamp();
  if (store.n) {
    const name = base + ".csv";
    saveBlob(new Blob([emgCsv(store)], { type: "text/csv" }), name);
    log(`CSV live salvato: ${name} — ${store.n.toLocaleString("it")} campioni, tutta la memoria`);
  }
  // Il pitch in un file a parte, e solo se c'è. Due basi dei tempi diverse non si
  // fondono in una tabella senza interpolarne una — e serve: senza il pitch, un
  // CSV rianalizzato a freddo non può far girare "sostegno che manca", che ha
  // bisogno di sapere quando c'era voce.
  if (pitch.n) {
    const pn = base + ".pitch.csv";
    saveBlob(new Blob([pitchCsv(pitch)], { type: "text/csv" }), pn);
    log(`CSV live salvato: ${pn} — ${pitch.n.toLocaleString("it")} stime di pitch, tutta la memoria`);
  }
  if (R.blob) {
    log('   → questi sono TUTTI i dati in memoria. Per i soli dati del video usa "Salva video + CSV".');
  }
}

// Esportata perché la scaricano anche i momenti salienti (.vtt e .json): il
// download sta qui insieme agli altri, invece di essere rifatto là.
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  a.click();
  // Revocare subito annullerebbe un download appena iniziato: l'URL va tenuto
  // vivo finché il browser non ha letto il blob.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const p2 = (n) => String(n).padStart(2, "0");
// Sotto il mega i kilobyte, e non `0.0 MB`: i primi chunk sono sempre piccoli, e
// uno zero accanto a un cronometro che corre è esattamente il numero che fa
// dubitare che stia registrando.
const fileSize = (b) =>
  (b < (1 << 20) ? Math.round(b / 1024) + " kB" : (b / (1 << 20)).toFixed(1) + " MB");
const mmss = (s) => Math.floor(s / 60) + ":" + p2(Math.floor(s % 60));

// La durata di una registrazione, che accanto ai mega è l'altra metà della
// risposta a "cos'è questo file": 12 MB non dicono se sono venti secondi o tre
// minuti, e fra due prove è la durata a farle riconoscere.
//
// Sotto il minuto i secondi con un decimale (`8.4 s`), sopra mm:ss (`2:24`): a
// otto secondi "0:08" nasconde proprio la cifra che serve a capire se il
// pulsante è stato premuto e ripremuto per sbaglio.
const dur = (s) => (s < 60 ? s.toFixed(1) + " s" : mmss(s));

// Il contatore mentre si registra. Lo muove il CICLO DI DISEGNO (vedi
// drawComposite) e non l'arrivo dei chunk: appeso a `ondataavailable` avanzava a
// scatti di due o tre secondi — l'encoder consegna quando gli conviene, non a
// cadenza fissa — e un cronometro che salta si legge come un'app che si è
// piantata. Il DOM si tocca solo quando il secondo cambia, non a 60 fps.
let shown = "";
function showInfo() {
  const s = Math.floor((performance.now() - R.t0) / 1000);
  // La chiave è il secondo E i byte: così il peso si aggiorna appena arriva un
  // chunk (che è quando cambia) e non si riscrive il DOM sessanta volte al
  // secondo per mostrare lo stesso testo.
  const key = s + "/" + R.bytes;
  if (key === shown) return;
  shown = key;
  // Il peso compare quando c'è, e non come `0.0 MB`: l'encoder consegna i byte
  // quando gli conviene — in una prova headless il primo chunk è arrivato dopo
  // sei secondi, tutto insieme — e uno zero fermo accanto a un cronometro che
  // corre si legge come "non sta registrando niente". Il tempo è la cosa che
  // l'app sa con certezza a ogni fotogramma, il peso arriva dopo.
  $("recInfo").textContent = `● ${mmss(s)}` + (R.bytes ? " · " + fileSize(R.bytes) : "");
}

// La scheda in background è il limite vero di questo approccio, non un dettaglio:
// requestAnimationFrame viene sospeso, il canvas non cambia più e captureStream
// tiene l'ultimo fotogramma per tutta la durata. Meglio trovarselo scritto nel
// log che scoprirlo riguardando il file.
document.addEventListener("visibilitychange", () => {
  if (R.on && document.hidden) log("registrazione: scheda in background, il video si ferma finché non torni.");
});

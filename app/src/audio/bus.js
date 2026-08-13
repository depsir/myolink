// ============================== bus audio della registrazione ==============================
//
// `MediaRecorder` fotografa le tracce all'avvio: una traccia aggiunta dopo non
// entra nel file. Prendere la traccia del microfono direttamente significava
// quindi che l'ordine dei pulsanti decideva il risultato — Registra e poi
// Microfono dava un mp4 muto, senza che riguardando il file si capisse perché.
//
// Qui la registrazione non prende mai la traccia del microfono: prende l'uscita
// di questo bus, un MediaStreamAudioDestinationNode che vive per tutta la
// registrazione e produce silenzio — silenzio vero, generato, vedi keepAlive —
// quando il microfono non c'è. Il microfono si aggancia e si sgancia dentro il
// grafo, che è la sola parte modificabile a registrazione avviata. L'ordine non
// conta più: aprendo il microfono a metà, il file ha silenzio prima e audio dopo;
// chiudendolo, torna silenzio invece di troncare la traccia.
//
// Il bus ha un AudioContext proprio, separato da quello dell'analisi: lo stesso
// MediaStream si può leggere da più contesti, mentre appoggiarsi al contesto
// dell'analisi vorrebbe dire chiudere il bus insieme al microfono — cioè proprio
// il caso che stiamo togliendo di mezzo.

import { log } from "../ui/dom.js";

const B = {
  ctx: null, dst: null,
  hum: null,       // sorgente muta sempre collegata, vedi keepAlive
  node: null,      // MediaStreamAudioSourceNode del microfono, se agganciato
  stream: null,    // il microfono aperto, anche a bus chiuso: serve al prossimo avvio
};

// La registrazione chiama questa e mette la traccia restituita nel proprio
// MediaStream. Torna null se Web Audio non c'è: video muto, come prima.
//
// È `await` per una ragione misurata, non per prudenza: vedi awaitRunning.
export async function openBus() {
  if (B.dst) return busTrack();
  if (typeof AudioContext === "undefined" || typeof MediaStreamAudioDestinationNode === "undefined") {
    return null;
  }
  try {
    B.ctx = new AudioContext();
    // Mono: il microfono lo apriamo a un canale, e l'AAC non deve codificare due
    // volte lo stesso segnale.
    B.dst = new MediaStreamAudioDestinationNode(B.ctx, { channelCount: 1 });
  } catch {
    closeBus();
    return null;
  }
  keepAlive();
  await awaitRunning();
  connect();
  return busTrack();
}

// Una destinazione con NIENTE collegato non produce silenzio: non produce
// affatto, e la traccia resta senza dati. Misurato in Chrome headless, e sono i
// due modi in cui si vedeva:
//   - registrato 4,9 s senza mai aprire il microfono → l'mp4 non ha nemmeno la
//     traccia audio;
//   - microfono chiuso a metà registrazione → l'audio finisce lì, 2,5 s su 5 di
//     video, e quello che c'è viene ribasato a zero, cioè sfasato.
// Una sorgente costante a offset 0 collegata per tutta la vita del bus rende il
// silenzio un segnale vero: la traccia parte col video, dura quanto il video, e
// il microfono si somma sopra quando c'è.
function keepAlive() {
  try {
    B.hum = new ConstantSourceNode(B.ctx, { offset: 0 });
    B.hum.connect(B.dst);
    B.hum.start();
  } catch {
    // Senza ConstantSourceNode si torna al comportamento di prima — audio solo
    // per il tratto in cui il microfono è collegato — invece di non registrare.
    B.hum = null;
    log("registrazione: audio senza sorgente di silenzio, la traccia coprirà solo il microfono.");
  }
}

// Un AudioContext appena creato è sospeso, e sospeso non produce campioni: la
// traccia del bus esiste ma non emette niente finché il dispositivo audio non è
// partito. Se la registrazione parte prima, Chrome ribasa il primo pacchetto
// audio a zero invece di lasciare il buco, e il risultato è una traccia audio
// più corta del video e in ANTICIPO di tutto il tempo di avvio — 1,3 s misurati
// in headless. Sarebbe il contrario di quello che questa registrazione promette,
// cioè la sincronia data dal recorder senza allineamenti a mano.
//
// Quindi si aspetta qui, prima che il MediaRecorder parta: è l'ultimo momento in
// cui la sincronia si può ancora garantire.
async function awaitRunning() {
  try { await B.ctx.resume?.(); } catch {}
  // resume() risolve quando lo stato è "running", ma il primo quanto di
  // rendering può arrivare dopo: currentTime che avanza è la prova che i
  // campioni escono davvero. Se non parte entro il tetto, si registra comunque:
  // meglio un audio disallineato che nessun video.
  for (let i = 0; i < 75 && !(B.ctx?.currentTime > 0); i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

export function closeBus() {
  disconnect();
  try { B.hum?.stop(); } catch {}
  try { B.ctx?.close(); } catch {}
  B.ctx = B.dst = B.hum = null;
  // B.stream NON si azzera: il microfono può restare aperto fra due
  // registrazioni, e la prossima deve ritrovarselo agganciato da sola.
}

// Chiamata all'apertura del microfono. Se una registrazione è in corso, il
// segnale entra nel file da adesso — e va detto, perché è l'unico momento in cui
// il file cambia contenuto a comando dato.
export function micAttach(stream) {
  B.stream = stream;
  if (connect()) log("registrazione: audio del microfono agganciato, da qui in avanti si sente.");
}

// Chiamata PRIMA di fermare le tracce del microfono: un source node che punta a
// una traccia già morta non si stacca più in modo pulito.
export function micDetach() {
  disconnect();
  B.stream = null;
}

// true = il file sta ricevendo il microfono adesso (bus aperto e microfono
// agganciato); serve alla registrazione per dire com'è partita.
export const busLive = () => !!B.node;

function busTrack() {
  return B.dst.stream.getAudioTracks()[0] || null;
}

function connect() {
  if (B.node || !B.dst || !B.stream) return false;
  // Una traccia già finita (dispositivo staccato) collegata al grafo darebbe
  // silenzio senza dirlo: meglio non agganciarla.
  if (!B.stream.getAudioTracks().some((t) => t.readyState !== "ended")) return false;
  try {
    B.node = B.ctx.createMediaStreamSource(B.stream);
    B.node.connect(B.dst);
  } catch (e) {
    B.node = null;
    log("registrazione: audio non agganciabile — " + (e?.name || "errore"));
    return false;
  }
  return true;
}

function disconnect() {
  try { B.node?.disconnect(); } catch {}
  B.node = null;
}

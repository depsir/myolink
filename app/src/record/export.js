// ============================== cosa esce dall'app ==============================
//
// Nome del file, formato del contenitore, righe del CSV. Sono le tre decisioni
// che si vedono solo *fuori* dall'app — quando il file è già sul disco — e
// nessuna delle tre tocca il DOM: stanno qui insieme perché siano testabili.

// In ordine di preferenza, e la prima scelta è **H.264 + AAC in mp4** per due
// motivi misurati, non per gusto:
//
// 1. macOS non sa leggere il WebM: niente anteprima nel Finder, niente
//    miniatura, niente QuickTime — serve per forza Chrome o VLC. Un mp4 lo apre
//    tutto, ed è la differenza fra un file che si condivide e uno che si spiega.
// 2. Il WebM di MediaRecorder è un flusso *live* e non dichiara la durata; il
//    suo mp4 sì. Cioè la barra di scorrimento funziona senza rimuxare niente.
//
// I codec vanno chiesti per NOME: con `video/mp4` liscio Chrome sceglie da sé, e
// nelle prove ha messo dentro ora H.264+Opus ora VP9 — che in un mp4 sono
// esattamente le combinazioni che QuickTime non apre. Il livello del profilo lo
// rinegozia il browser secondo la risoluzione.
//
// Si chiede **High** (`6400..`) prima di Main (`4D40..`) e baseline (`42E0..`).
// Baseline non ha né CABAC né la trasformata 8×8, che su bordi netti sono i due
// strumenti che servono di più — e il nostro contenuto è tutto bordi netti. Nella
// prova (x264 veryfast/zerolatency, che imita il vincolo realtime del browser, a
// pari bitrate) il salto è però modesto sulla luma, +0.08 dB di PSNR: se stai
// cercando la nitidezza è il BITRATE che la compra, non il profilo — vedi BPP
// più sotto. Dove High vince davvero è la crominanza, +1.17 dB, ed è esattamente
// il difetto per cui una traccia colorata da un pixel su fondo scuro sbava.
//
// Vale comunque la pena chiederlo perché non costa niente: il file esce anche un
// po' più piccolo, Chrome onora il profilo richiesto (verificato con ffprobe:
// nel file finisce davvero `profile=High`) e QuickTime legge High da anni. I tre
// restano tutti in lista, in quest'ordine, perché dove l'encoder è software
// (OpenH264 fa solo baseline) la costruzione del MediaRecorder fallisce e si
// deve poter scendere — vedi il ciclo di ripiego in recorder.js.
//
// WebM resta come ripiego dove registrare in mp4 non si può (Firefox, Chrome
// vecchi): meglio un file che si guarda con qualche attrezzo in più che nessun
// file. `video/mp4` liscio invece NON è nella lista, proprio perché imprevedibile.
export const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.640028,mp4a.40.2",
  "video/mp4;codecs=avc1.4D4028,mp4a.40.2",
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

// Torna TUTTI i supportati e non solo il primo, in ordine di preferenza, perché
// `isTypeSupported` risponde sul MIME e non sull'encoder che c'è davvero: un sì
// al profilo High diventa un'eccezione al `new MediaRecorder` là dove H.264 è
// software. Chi costruisce li prova in fila e scende, invece di rinunciare al
// primo no — la lista è quel ripiego.
//
// Il predicato è iniettabile perché MediaRecorder non esiste in node.
export function supportedMimes(supported, candidates = MIME_CANDIDATES) {
  return candidates.filter((t) => supported(t));
}

// ---- quanto bitrate ----
//
// Bit per pixel per fotogramma. 0.12 era il valore della prima stesura, scelto
// ragionando sulle tracce: grafica vettoriale su fondo scuro, dove i bitrate da
// fotocamera sono soldi buttati. Il ragionamento però vale per due strati su tre
// — lo **spettrogramma è rumore a tutti gli effetti**, e con lui nel fotogramma
// l'encoder ruba bit alle linee sottili. Il risultato si vede come alone
// granuloso attorno ai tratti, che è il difetto per cui questo numero è salito.
//
// 0.28 è quasi il doppio di quello che chiederebbe un video di ripresa, e non è
// spreco: l'encoder hardware di macOS lavora in modalità realtime, cioè con un
// solo passaggio e senza guardare avanti, e quel margine è ciò che gli evita di
// spendere tutto sul rumore dello spettro.
//
// Il numero è un PERMESSO di spendere, non un costo: in una prova col simulatore
// a 1240×380 il recorder ha chiesto 4 Mb/s e il file è uscito a 1.06 (ffprobe),
// perché con pannelli quasi fermi non c'era altro da codificare. Il conto pieno
// si paga solo quando lo spettro è davvero in movimento, che è esattamente
// quando serve. Il caso peggiore resta grosso — ordine dei 100 MB al minuto a
// piena risoluzione Retina — ed è accettabile perché queste sono clip da
// dimostrazione: per rianalizzare c'è il CSV.
const BPP = 0.28;

// Il tetto esiste perché il prodotto cresce col quadrato della finestra e a un
// certo punto non compra più niente di visibile; il pavimento perché a
// risoluzioni piccole la formula scenderebbe sotto la soglia in cui H.264
// comincia a fare blocchi anche su un fondo piatto.
const FLOOR = 4e6, CEIL = 32e6;

export function videoBitrate(w, h, fps, bpp = BPP) {
  return Math.round(Math.min(CEIL, Math.max(FLOOR, w * h * fps * bpp)));
}

// L'estensione la ricaviamo dal MIME negoziato e non da una costante: dare
// `.webm` a un file mp4 lo rende illeggibile a metà dei player.
export function extFor(mime) {
  const base = String(mime || "").split(";")[0].trim().toLowerCase();
  return base.startsWith("video/") ? base.slice(6) : "bin";
}

// Ora locale, non UTC né ISO: serve a ritrovare "quella prova di stamattina"
// nella cartella dei download, e i due punti dell'ISO su Windows non sono
// nemmeno un nome di file valido.
const p2 = (n) => String(n).padStart(2, "0");
export function stampName(base, ext, d = new Date()) {
  const s = [d.getFullYear(), p2(d.getMonth() + 1), p2(d.getDate())].join("") +
            "-" + [d.getHours(), d.getMinutes(), d.getSeconds()].map(p2).join("");
  return `${base}-${s}.${ext}`;
}

// I campioni EMG così come sono nello store: tempo del grafico in secondi (la
// base del device quando c'è un link, vedi T) e valore ADC grezzo. È l'unico
// output che rende una sessione RIANALIZZABILE — un video non lo è — e costa
// una funzione, perché i dati sono già timbrati e in ordine.
//
// Microsecondi di risoluzione sul tempo: il device timbra in µs, scriverne meno
// butterebbe via l'informazione per cui esiste il protocollo.
export function emgCsv(store) {
  const rows = ["t_s,valore"];
  for (let k = 0; k < store.n; k++) {
    const i = store.idx(k), v = store.v[i];
    rows.push(store.t[i].toFixed(6) + "," + (Number.isInteger(v) ? v : v.toFixed(3)));
  }
  return rows.join("\n") + "\n";
}

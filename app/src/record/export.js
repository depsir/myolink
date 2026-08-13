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
// esattamente le combinazioni che QuickTime non apre. Il livello del profilo
// (`42E01E` = baseline 3.0) lo rinegozia il browser secondo la risoluzione.
//
// WebM resta come ripiego dove registrare in mp4 non si può (Firefox, Chrome
// vecchi): meglio un file che si guarda con qualche attrezzo in più che nessun
// file. `video/mp4` liscio invece NON è nella lista, proprio perché imprevedibile.
export const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

// Il predicato è iniettabile perché MediaRecorder non esiste in node.
export function pickMime(supported, candidates = MIME_CANDIDATES) {
  return candidates.find((t) => supported(t)) ?? null;
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

// ============================== cosa esce dall'app ==============================
//
// Nome del file, formato del contenitore, righe del CSV. Sono le tre decisioni
// che si vedono solo *fuori* dall'app — quando il file è già sul disco — e
// nessuna delle tre tocca il DOM: stanno qui insieme perché siano testabili.

// In ordine di preferenza. VP9 comprime meglio a parità di bitrate su contenuto
// grafico (linee nette su fondo scuro, che è tutto quello che registriamo);
// Opus è l'unico codec audio che WebM ammette. `video/webm` senza codecs lascia
// scegliere al browser, e `video/mp4` è l'unica strada su Safari — dove non
// c'è né Web Serial né Web Bluetooth, ma il microfono da solo funziona.
export const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
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

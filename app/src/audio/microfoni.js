// ============================== quale microfono ==============================
//
// Nasce da una domanda di chi usa l'app: «quando chiede il permesso posso
// scegliere il microfono, ma poi non posso più».
//
// Ed è esattamente così. La scelta fatta nel prompt del browser viene ricordata
// **per quel sito**, e da lì in avanti si mette davanti al predefinito di
// sistema: `getUserMedia({audio: ...})` senza vincoli continua a restituire
// quello, e cambiare il microfono nelle impostazioni del sistema operativo non
// sposta niente. Per cambiarlo bisogna aprire il lucchetto nella barra degli
// indirizzi — un posto che chi canta non troverà mai.
//
// Quindi un default e un'opzione, la stessa forma che ha già la via del sensore:
// **il predefinito di sistema resta il predefinito**, e chi ha un'interfaccia
// audio attaccata lo dice una volta. Non una domanda all'accensione.
//
// Qui non c'è DOM: questo modulo sa quali ingressi esistono e quale vogliamo,
// `ui/microfoni.js` è chi lo mostra.

const KEY = "myolink.microfono";

// Chrome espone due voci che non sono dispositivi ma alias: `default` segue il
// predefinito di sistema, `communications` quello delle chiamate (Windows).
// Sono la stessa cosa che qui si chiama «predefinito del sistema», cioè nessun
// vincolo, e tenerle nella lista vorrebbe dire scrivere due volte la stessa voce
// con due nomi diversi. Via dalla lista, e in lettura valgono "".
const ALIAS = new Set(["", "default", "communications"]);

export const MIC = {
  scelto: "",   // la preferenza: "" = predefinito del sistema
  nome: "",     // col nome che aveva l'ultima volta che l'abbiamo visto
  aperto: "",   // quello che sta entrando DAVVERO, "" = predefinito
};

// Il nome accanto all'id, e non è una comodità: un `deviceId` è una stringa di
// 64 caratteri esadecimali, e quando quel dispositivo non è attaccato è tutto
// quello che resta. Senza il nome, una preferenza che punta a un mixer spento si
// può solo mostrare come «Predefinito» — cioè mentire — oppure dimenticare, che
// è la cosa che questo progetto ha già stabilito di non fare con le impostazioni.
// Con il nome, la tendina può dire «Scarlett Solo USB (non collegato)» e la
// preferenza sopravvive allo scollegamento, che è il senso di una preferenza.
function leggi() {
  // Come ovunque: una preferenza che non si riesce a ricordare (finestra privata,
  // dati del sito bloccati) non è un motivo per non far partire niente.
  let v = null;
  try { v = localStorage.getItem(KEY); } catch {}
  if (!v) return;
  let j = null;
  try { j = JSON.parse(v); } catch {}
  // Un id senza nome è la forma vecchia di questa chiave, e si legge ancora: un
  // aggiornamento non è un buon momento per far ricominciare da capo.
  // `typeof` e non solo la verità di `j`: un id tutto cifre sarebbe un numero
  // valido per JSON.parse, e diventerebbe una preferenza senza id.
  if (j && typeof j === "object") { MIC.scelto = j.id || ""; MIC.nome = j.nome || ""; }
  else MIC.scelto = v;
}
leggi();

export function scegliMic(id, nome = "") {
  MIC.scelto = id || "";
  MIC.nome = MIC.scelto ? nome : "";
  try {
    if (MIC.scelto) localStorage.setItem(KEY, JSON.stringify({ id: MIC.scelto, nome: MIC.nome }));
    else localStorage.removeItem(KEY);
  } catch {}
}

// Il frammento di vincolo per getUserMedia.
//
// **`exact` e non `ideal`**, ed è il punto in cui questa riga è già stata
// sbagliata una volta. `ideal` sembrava la scelta prudente — un'interfaccia
// staccata non deve impedire l'apertura — ma `ideal` è un desiderio, e il
// browser lo scavalca proprio con la cosa da cui questo comando esiste per
// scappare: il dispositivo che si è ricordato per questo sito. Il vincolo
// partiva, `getConstraints()` lo mostrava, e continuava a entrare il microfono
// di prima. Il banco di prova l'aveva già detto e l'avevo letto male: con
// `ideal` la traccia viva si dichiarava `deviceId: "default"` invece del
// dispositivo chiesto, e l'avevo preso per un limite del device finto di Chrome
// headless. Con `exact` la stessa lettura torna l'id giusto — era il vincolo a
// non essere applicato, non la misura a essere cieca.
//
// La prudenza non sta nel chiedere piano: sta nel ripiego esplicito che
// `audio.js` fa quando `exact` non si può soddisfare — riapre senza vincoli e lo
// dice, invece di aprire la cosa sbagliata in silenzio.
export function vincoloMic() {
  return MIC.scelto ? { deviceId: { exact: MIC.scelto } } : {};
}

// Dopo l'apertura: qual è il dispositivo vivo. È l'unica fonte onesta — la
// preferenza dice cosa abbiamo chiesto, questa dice cosa ci è stato dato.
export function micAperto(stream) {
  let id = "";
  try { id = stream?.getAudioTracks?.()[0]?.getSettings?.().deviceId || ""; } catch {}
  MIC.aperto = ALIAS.has(id) ? "" : id;
  avvisa();
  return MIC.aperto;
}

export function micChiuso() {
  MIC.aperto = "";
  avvisa();
}

// ---- la lista degli ingressi ----
//
// Torna [] quando non c'è niente da mostrare, e i due casi in cui succede sono
// uno solo per chi guarda: **senza permesso le etichette sono stringhe vuote**.
// Un menu di tre voci senza nome non è una scelta, è un indovinello, quindi
// finché non si è aperto il microfono almeno una volta la riga non esiste. È la
// stessa regola con cui la riga del collegamento sparisce dove c'è una via sola.
export async function elencoMic() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  let tutti;
  try { tutti = await navigator.mediaDevices.enumerateDevices(); } catch { return []; }
  const ing = tutti.filter((d) => d.kind === "audioinput" && !ALIAS.has(d.deviceId));
  if (!ing.length || ing.some((d) => !d.label)) return [];
  return ing.map((d) => ({ id: d.deviceId, nome: d.label }));
}

// ---- chi guarda ----
//
// Un canale solo — «qualcosa è cambiato negli ingressi audio» — per tre fatti che
// per chi guarda sono lo stesso: il microfono si è aperto (e da adesso le
// etichette hanno un nome), si è chiuso, o qualcuno ha attaccato una USB. Sta
// qui e non nella UI perché così `audio/audio.js` non deve importare niente da
// `ui/`: notifica questo modulo, che i due già condividono.
const subs = [];

export function onMicList(fn) {
  subs.push(fn);
  // `devicechange` si iscrive alla prima chiamata e non al caricamento del
  // modulo: i test girano in node, dove `navigator.mediaDevices` non c'è.
  if (subs.length === 1) navigator.mediaDevices?.addEventListener?.("devicechange", avvisa);
}

function avvisa() { for (const f of subs) f(); }

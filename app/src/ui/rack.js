// ============================== gli ingressi e la fase ==============================
//
// Due interruttori e un comando. Al posto di sei pulsanti — *Collega seriale*,
// *Collega BLE*, *Simulatore*, *Disconnetti*, *Microfono*, *Registra* — che erano
// sei perché sei sono le vie con cui il codice arriva a un flusso di dati, non
// perché siano sei le cose da decidere. Le cose da decidere sono tre: se entra il
// sensore, se entra il microfono, e se stai registrando.
//
// **Gli ingressi sono uno stato permanente, la registrazione è un'azione sopra di
// essi.** È la soluzione dei multitraccia e di OBS, ed è quella che risponde a
// «se stoppo il microfono cosa fa»: niente, spegne un ingresso. Mentre si
// registra ogni ingresso acceso porta il suo pallino rosso — il *record-enable* —
// e quello risponde a «cosa registra» nel punto esatto in cui nasce il dubbio.
//
// **Se registri, registri tutto quello che è acceso.** Non c'è niente da
// scegliere, quindi le tre caselle "cosa va nel video" non compaiono: restano in
// avanzato, dove chi le cerca sa cosa sono.
//
// **La fase la calcola questo modulo, non la possiede.** Chi la possiede è
// `core/fase.js`; qui si osserva ciò che già esiste (`R.on`, `R.blob`) e si
// traduce. L'unico stato aggiunto è `collega`, che dura quanto un'attesa: fra il
// clic e la risposta del browser non esiste nessun flag nel codice, e senza di
// lui l'interruttore resterebbe spento mentre il selettore dei dispositivi è già
// aperto.
//
// Niente polling di rete e niente timer proprio: `tickRack` gira dentro il ciclo
// di disegno, come le statistiche, e tocca il DOM solo quando qualcosa cambia.

import { S } from "../core/state.js";
import { F, setFase } from "../core/fase.js";
import { stop } from "../core/session.js";
import { setFailSink } from "../core/diagnostics.js";
import { connectSerial } from "../transport/serial.js";
import { connectBle } from "../transport/ble.js";
import { A, toggleAudio } from "../audio/audio.js";
import { R, discardRecording, saveRecording, toggleRecord } from "../record/recorder.js";
import { mmss } from "../core/marks.js";
import { alVivo, analizza, vaiPrimo } from "./marks.js";
import { $ } from "./dom.js";

const KEY = "myolink.trasporto";

const RK = {
  collega: false,         // fra il clic e la risposta del browser
  chiede: false,          // la scelta Bluetooth/cavo è aperta
  conferma: false,        // la domanda prima di perdere una presa non salvata
};

// ---- i trasporti che ESISTONO su questo browser ----
//
// Web Serial non c'è su Android e non c'è su Safari: lì la domanda non si pone e
// non si fa. Era il difetto peggiore della vecchia riga di comandi — *Collega
// seriale* primo e blu, cioè il primo tocco di un non tecnico da telefono era
// quello che non poteva funzionare.
function trasporti() {
  const out = [];
  if (navigator.bluetooth) out.push("ble");
  if ("serial" in navigator) out.push("serial");
  return out;
}

const ricorda = (k) => { try { localStorage.setItem(KEY, k); } catch {} };
const ricordato = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const scorda = () => { try { localStorage.removeItem(KEY); } catch {} };

export function setupRack() {
  $("swSens").onclick = sensore;
  $("swMic").onclick = () => { errore(null); toggleAudio(); };
  $("vuotoGo").onclick = sensore;

  $("btnPresa").onclick = () => { errore(null); toggleRecord(); };
  $("btnVivo").onclick = tornaAlVivo;

  $("scBle").onclick = () => vai("ble");
  $("scSer").onclick = () => vai("serial");
  $("scX").onclick = () => { RK.chiede = false; sync(); };

  $("cfSave").onclick = () => { saveRecording(); vivo(); };
  $("cfDrop").onclick = vivo;

  $("presaSave").onclick = () => saveRecording();
  // Eliminare è esplicito e non chiede due volte: qui il sì l'ha già detto chi
  // ha premuto. La domanda esiste nell'altra direzione — tornare al vivo senza
  // accorgersene — perché lì la perdita è un effetto collaterale, non lo scopo.
  $("presaDrop").onclick = () => { if (discardRecording()) vivo(); };

  // Gli errori dei permessi arrivano qui invece di finire solo in fondo al log:
  // il testo è quello di core/diagnostics.js, che era già scritto bene.
  setFailSink(errore);
  chiudiFuori($("menuBox"));
  finestra();
  sync();
}

// ---- quanto tempo si vede ----
//
// Le quattro scelte del menu scrivono lo STESSO campo `#win` che in avanzato è
// una casella numerica: un valore solo, due modi di toccarlo, e nessuno stato in
// più da tenere allineato. Il ciclo di disegno rilegge quel campo a ogni
// fotogramma, quindi non c'è niente da notificare a nessuno — basta scriverlo.
function finestra() {
  const seg = document.querySelectorAll("#segWin button");
  const pitta = () => {
    const w = +$("win").value || 5;
    for (const b of seg) b.setAttribute("aria-pressed", String(+b.dataset.w === w));
  };
  for (const b of seg) b.onclick = () => { $("win").value = b.dataset.w; pitta(); };
  // Se il valore lo cambia l'altro modo, il menu lo sa: è lo stesso campo, e due
  // comandi sulla stessa cosa che dicono numeri diversi sono un comando rotto.
  $("win").addEventListener("input", pitta);
  pitta();
}

// ---- il menu si chiude come si chiude qualunque cosa aperta ----
//
// Un `<details>` nativo si chiude solo ricliccando il suo riepilogo, e per un
// pannellino che copre il mezzo schermo sotto è la cosa sbagliata: «la i apre il
// tooltip ma se clicco fuori non si chiude, è scomodo». Un menu si chiude
// cliccando fuori e con Esc, e sono due righe.
//
// `pointerdown` e non `click`: il clic che chiude non deve anche arrivare al
// pulsante che sta sotto al pannellino — chiudere è già l'azione.
function chiudiFuori(d) {
  if (!d) return;
  document.addEventListener("pointerdown", (e) => {
    if (d.open && !d.contains(e.target)) d.open = false;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && d.open) d.open = false;
  });
}

// ---- l'interruttore del sensore ----

async function sensore() {
  errore(null);
  if (S.running) return stop("manuale");
  if (RK.collega) return;
  const t = trasporti();
  if (!t.length) {
    return errore("sensore", "questo browser non sa collegare il sensore.",
      "Servono Chrome o Edge: su computer vanno bene sia il Bluetooth sia il cavo, " +
      "su Android solo il Bluetooth. Su iPhone e su Safari non è disponibile.");
  }
  if (t.length === 1) return vai(t[0]);
  // Chiesto una volta sola: la risposta si ricorda, e si scorda da sé se quella
  // via fallisce — così nessuno resta chiuso fuori da una scelta di ieri.
  const r = ricordato();
  if (r && t.includes(r)) return vai(r);
  RK.chiede = true;
  sync();
}

async function vai(kind) {
  RK.chiede = false;
  RK.collega = true;
  sync();
  try {
    await (kind === "ble" ? connectBle() : connectSerial());
  } finally {
    RK.collega = false;
  }
  if (S.running) ricorda(kind); else scorda();
  sync();
}

// ---- il ritorno al vivo ----
//
// Si chiede, non si vieta. Spegnere il comando proteggerebbe dalla perdita e
// bloccherebbe anche il caso legittimo — la presa venuta male, che si vuole
// buttare — e un pulsante spento senza spiegazione è peggio di una domanda.
function tornaAlVivo() {
  if (R.blob && !R.saved) { RK.conferma = true; return sync(); }
  vivo();
}

function vivo() {
  RK.conferma = false;
  alVivo();
  setFase("vivo");
  sync();
}

// ---- l'errore sotto il comando che l'ha causato ----

function errore(what, msg, hint) {
  const box = $("rackErr");
  if (!box) return;
  if (!what) { box.className = "rkerr"; box.textContent = ""; return; }
  box.textContent = "";
  const b = document.createElement("b");
  b.textContent = what + ": ";
  box.append(b, msg || "");
  if (hint) {
    const p = document.createElement("div");
    p.textContent = hint;
    p.style.marginTop = "4px";
    box.appendChild(p);
  }
  const x = document.createElement("button");
  x.className = "x"; x.textContent = "×"; x.setAttribute("aria-label", "chiudi");
  x.onclick = () => errore(null);
  box.prepend(x);
  box.className = "rkerr on";
}

// ---- la sincronizzazione ----
//
// Una funzione sola che scrive lo schermo a partire dallo stato, chiamata sia
// dagli handler sia dal ciclo di disegno. Non c'è una seconda via che tocchi gli
// stessi elementi: due vie divergono, e il primo sintomo è un interruttore che
// resta indietro di un evento.

export function tickRack() {
  fasi();
  sync();
}

// La fase, calcolata da ciò che esiste. Tre righe, e sono la risposta alle
// cinque domande: `R.on` dice "sto registrando", e la fine di una registrazione
// con un file in memoria dice "adesso stai guardando una presa".
function fasi() {
  if (R.on) return setFase("registrando");
  if (F.now !== "registrando") return;
  if (!R.blob) return setFase("vivo");
  setFase("presa");
  // L'analisi parte da sé: premere un secondo pulsante per vedere cosa è appena
  // successo è il genere di passo che si dimentica di fare, e senza di lui la
  // fase sarebbe una schermata vuota.
  analizza();
  vaiPrimo();
  // E la scheda si apre ANCHE se l'analisi non ha trovato niente da analizzare:
  // una presa del solo microfono non ha campioni del sensore, ma esiste, pesa
  // dei megabyte e va salvata o buttata. Senza questa riga la fase «la presa»
  // sarebbe, proprio in quel caso, una schermata con un solo pulsante.
  $("pMarks").hidden = false;
}

function sync() {
  const sens = S.running || RK.collega, mic = A.on;
  const ing = sens && mic ? "tutto" : sens ? "sens" : mic ? "voce" : "niente";
  if (document.body.dataset.ing !== ing) document.body.dataset.ing = ing;
  if (document.body.dataset.fase !== F.now) document.body.dataset.fase = F.now;

  interruttore("swSens", sens);
  interruttore("swMic", mic);
  scrivi("sensSt", RK.collega ? "sto collegando…" : "");

  $("rack").classList.toggle("chiede", RK.chiede);
  $("rack").classList.toggle("conferma-on", RK.conferma);

  const rec = F.now === "registrando";
  const b = $("btnPresa");
  scrivi("btnPresa", rec ? "Ferma" : "Registra");
  b.disabled = ing === "niente";
  b.title = ing === "niente"
    ? "accendi almeno un ingresso: si registra quello che entra"
    : rec ? "chiude la presa e la tiene in memoria"
          : "registra tutto quello che è acceso: video, audio e dati";
  scrivi("recTime", rec ? mmss((performance.now() - R.t0) / 1000) : "");

  if (RK.conferma) {
    const t = $("cfTxt");
    t.textContent = "";
    const s = document.createElement("b");
    s.textContent = `La presa ${orario()} non è ancora salvata.`;
    t.append(s, " Tornando al vivo la perdi alla prossima registrazione.");
  }
  presa();
}

// La scheda della presa: cosa hai in mano, e le due cose che ci puoi fare.
// `R` aveva già tutto — il file, il nome, la durata, i CSV congelati allo stop —
// e non lo mostrava a nessuno: l'unica cosa che mancava era sapere se fosse
// stata salvata, che è la domanda con cui tutto questo è cominciato.
function presa() {
  if (!$("presaN")) return;
  scrivi("presaN", "Presa " + orario());
  scrivi("presaDur", R.blob ? mmss(R.secs) : "");
  const b = $("presaBadge");
  b.className = "badge " + (R.saved ? "si" : "no");
  scrivi("presaBadge", R.saved ? "salvata" : "non ancora salvata");
  b.title = R.saved
    ? "video e CSV sono nella cartella dei download."
    : "esiste solo in memoria: si perde alla prossima registrazione o ricaricando la pagina.";
  $("presaSave").disabled = !R.blob;
  $("presaSave").textContent = R.saved ? "Salva di nuovo" : "Salva";
  $("presaDrop").disabled = !R.blob;
}

// L'ora della presa dal nome del file, che è già timbrato: `myolink-20260911-162656`.
// Un secondo timbro preso qui darebbe un orario diverso da quello che l'utente
// si ritrova scritto sul file.
function orario() {
  const m = /-(\d{2})(\d{2})(\d{2})\./.exec(R.name || "");
  return m ? `delle ${m[1]}:${m[2]}` : "";
}

function interruttore(id, on) {
  const e = $(id);
  const v = String(!!on);
  if (e.getAttribute("aria-checked") !== v) e.setAttribute("aria-checked", v);
}

function scrivi(id, txt) {
  const e = $(id);
  if (e && e.textContent !== txt) e.textContent = txt;
}

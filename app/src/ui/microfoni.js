// ============================== la scelta del microfono ==============================
//
// Un `<select>` che esiste in DUE posti ed è lo stesso comando, come
// l'interruttore dei modi: nel menu della rotellina, che in avanzato non c'è, e
// accanto al pulsante *Microfono* della riga in alto, che nel semplice non c'è.
// Scriverli tutti e due da qui costa una `querySelectorAll` e toglie l'unico modo
// in cui i due potrebbero dire cose diverse.
//
// **Non è un interruttore a scatti come la via del sensore.** Lì le opzioni sono
// due, si leggono tutte, e stanno nello spazio di un toggle; qui sono N e hanno
// nomi lunghi — «Microfono MacBook Pro», «Scarlett Solo USB» — quindi una tendina.
//
// **La riga sparisce con meno di due ingressi**, la stessa regola di `#rigaVia`:
// una scelta con una voce sola non è una scelta, e su un telefono il menu si
// riempirebbe di roba che non si può toccare. E sparisce anche finché il permesso
// non è stato dato, perché prima di quello i dispositivi non hanno un nome — è
// `elencoMic()` a fondere i due casi in uno.
//
// **Mentre si registra non si tocca.** Cambiare dispositivo vuol dire riaprire il
// flusso, e la traccia del microfono è già dentro un file che si sta scrivendo:
// non è una cosa che va spiegata dopo, è una cosa che non deve poter succedere.

import { A, riapriAudio } from "../audio/audio.js";
import { MIC, elencoMic, onMicList, scegliMic } from "../audio/microfoni.js";
import { F, onFase } from "../core/fase.js";

const DEFAULT = "Predefinito del sistema";

// Il singolare e il plurale sono la stessa riga di codice: le tendine sono due,
// e una delle due è sempre in un modo che non si sta guardando.
const sel = () => document.querySelectorAll(".selmic");
const righe = () => document.querySelectorAll(".rigamic");

let lista = [];
let riapre = false;   // dura quanto la riapertura del flusso, vedi cambia()
let gen = 0;          // due `aggiorna()` in volo non devono scriversi addosso

export function setupMicUI() {
  for (const s of sel()) s.onchange = cambia;
  // Tre fatti, un canale solo: il microfono si è aperto (e da adesso le etichette
  // hanno un nome), si è chiuso, o è stata attaccata una USB.
  onMicList(aggiorna);
  // La fase spegne la tendina, e `onFase` chiama subito col valore corrente:
  // non esiste un istante in cui è viva mentre si registra.
  onFase(pitta);
  aggiorna();
}

async function aggiorna() {
  const mio = ++gen;
  const l = await elencoMic();
  if (mio !== gen) return;
  lista = l;
  pitta();
}

// ---- le voci della tendina ----
//
// Gli ingressi che ci sono, più — se la preferenza punta a un dispositivo che
// non c'è — **il fantasma di quel dispositivo, spento**.
//
// Qui prima la preferenza si dimenticava da sé: il mixer staccato spariva
// dall'elenco e la scelta veniva cancellata in silenzio. Era il rimedio
// sbagliato al problema giusto — una preferenza fuori elenco non si può mostrare
// senza mentire — e contraddiceva la regola che questo progetto aveva già
// scritto per la via del sensore: **un'impostazione che si cambia da sola è
// un'impostazione rotta**. Il fantasma la mostra e dice in che stato è, il mixer
// può tornare fra dieci minuti e ritrovare la sua riga, e l'unico modo di
// perdere la scelta torna a essere sceglierne un'altra.
//
// Ed è anche il motivo per cui la riga resta visibile quando il dispositivo
// scelto sparisce e ne resta uno solo: due voci, di cui una spenta, sono la
// spiegazione di cosa sta succedendo. Nasconderla lascerebbe l'app a suonare dal
// microfono sbagliato senza un posto dove dirlo.
function voci() {
  if (!MIC.scelto || lista.some((d) => d.id === MIC.scelto)) return lista;
  return [...lista, { id: MIC.scelto, nome: (MIC.nome || "il dispositivo scelto") + " (non collegato)", via: true }];
}

// Quale voce è selezionata: **la preferenza**, perché è la cosa che questo
// comando comanda.
//
// C'era scritto «quello che sta entrando davvero», che sembrava la versione
// onesta, e al banco di prova si è visto perché non lo è: `getSettings()` può
// rispondere con un alias (`default`) o con niente, e allora la tendina torna su
// «Predefinito» un istante dopo che hai scelto — cioè sembra rotta. Chi guarda
// non distingue «il browser non me l'ha detto» da «la tua scelta non è stata
// presa».
//
// L'eccezione è il ripiego: `audio.js` non è riuscito ad aprire il dispositivo
// scelto e ha riaperto il predefinito. Lì la tendina deve dire quello che si
// sente, non quello che si era chiesto — il perché l'ha già detto lui, sotto
// l'interruttore e nel registro.
//
// Il ripiego si riconosce in due modi, e servono tutti e due: il browser nomina
// un dispositivo diverso da quello chiesto, **oppure** non nomina niente ma la
// preferenza è il fantasma, cioè un dispositivo che non è nemmeno nell'elenco.
// Senza il secondo, un browser silenzioso lasciava scritto «Scarlett Solo USB
// (non collegato)» su una tendina da cui in quel momento stava entrando audio.
function attivo() {
  if (!A.on) return MIC.scelto;
  if (MIC.aperto) return MIC.aperto;
  return lista.some((d) => d.id === MIC.scelto) ? MIC.scelto : "";
}

function pitta() {
  const a = attivo();
  const vv = voci();
  for (const s of sel()) {
    if (!uguale(s, vv)) riempi(s, vv);
    // Un valore che non è fra le opzioni lascerebbe il `<select>` su quella prima:
    // "" è il predefinito, ed è anche il ripiego giusto quando il browser ci ha
    // dato qualcosa che non sappiamo nominare.
    const v = vv.some((d) => d.id === a) ? a : "";
    if (s.value !== v) s.value = v;
    s.disabled = riapre || F.now === "registrando";
    s.title = F.now === "registrando"
      ? "non si cambia mentre si registra: l'audio è già dentro il file"
      : "da quale ingresso entra la voce";
  }
  for (const r of righe()) r.hidden = vv.length < 2;
}

// Ridisegnare le opzioni a ogni notifica vorrebbe dire chiudere la tendina in
// mano a chi la sta scorrendo: `devicechange` arriva anche mentre è aperta.
function uguale(s, l) {
  if (s.options.length !== l.length + 1) return false;
  return l.every((d, i) => s.options[i + 1].value === d.id && s.options[i + 1].textContent === d.nome);
}

function riempi(s, vv) {
  s.textContent = "";
  s.append(opzione("", DEFAULT));
  for (const d of vv) s.append(opzione(d.id, d.nome, d.via));
}

function opzione(v, txt, spenta) {
  const o = document.createElement("option");
  o.value = v;
  o.textContent = txt;
  // Il fantasma si vede e non si sceglie: è già scelto, e sceglierlo di nuovo
  // non lo attaccherebbe.
  o.disabled = !!spenta;
  return o;
}

async function cambia(e) {
  // La cintura oltre alle bretelle: la tendina è già spenta in registrazione,
  // ma questa è la riga che rende vera l'affermazione, non il CSS.
  if (F.now === "registrando") return pitta();
  // Il nome viaggia con l'id: è quello che la tendina saprà mostrare il giorno
  // in cui quel dispositivo non sarà attaccato.
  const o = e.target.selectedOptions[0];
  scegliMic(e.target.value, o ? o.textContent : "");
  // L'altra tendina si allinea subito, prima di qualunque attesa: è lo stesso
  // comando, non due.
  pitta();
  if (!A.on) return;
  riapre = true;
  pitta();
  try { await riapriAudio(); } finally { riapre = false; }
  // `riapriAudio()` avvisa da sé aprendo e chiudendo, ma se l'apertura fallisce
  // (dispositivo sparito fra la lista e il clic) nessuno ridisegna: qui sì.
  aggiorna();
}

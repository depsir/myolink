// ============================== semplice o avanzato ==============================
//
// Una preferenza, non una fase: il modo dice QUANTO mostrare, la fase dice che
// cosa stai facendo. Tenerli separati è ciò che permette di cambiare modo in
// mezzo a una registrazione senza che succeda niente.
//
// **Il semplice è il default**, ed è una scelta del committente: chi apre l'app
// è uno studente di canto o chi gli insegna, non chi l'ha scritta. L'avanzato è
// a un tocco, e la scelta si ricorda — se qualcuno lavora in avanzato non deve
// ridirlo a ogni ricaricamento.
//
// Il modo NON è uno stato del quale il resto del codice deve sapere: quasi tutto
// lo decide il CSS su `body[data-modo]`. Le uniche due eccezioni sono il grafico
// del sensore (che in semplice disegna la scala della fatica invece dei count
// assoluti) e le statistiche, che in semplice non si calcolano affatto.

const KEY = "myolink.modo";
const KEY_C = "myolink.curve";       // la vecchia preferenza, letta una volta per non perderla
const KEY_T = "myolink.tracce";

export const MODO = { now: "semplice" };
export const semplice = () => MODO.now === "semplice";

// ---- le tre tracce del grafico del sensore ----
//
// Sono tre LETTURE dello stesso segnale sovrapposte, e quale serve dipende da
// cosa stai facendo: chi canta guarda la linea dello sforzo e basta, chi cerca
// un artefatto vuole la nuvola dei grezzi sotto. Quindi due memorie separate per
// modo, e non una preferenza sola che cambia significato quando cambi modo.
//
// Il grafico le chiede a ogni fotogramma: stanno qui e non in `draw/chart.js`
// perché sono una preferenza di quanto mostrare, cioè la stessa cosa che decide
// `MODO.now`. Il comando è la legenda sotto il grafico, in tutti e due i modi.
const DEF = {
  semplice: { raw: false, med: false, fat: true },
  avanzato: { raw: true, med: true, fat: true },
};
const TRK = { semplice: { ...DEF.semplice }, avanzato: { ...DEF.avanzato } };
export const tracce = () => TRK[MODO.now];

// L'interruttore fra i modi esiste in DUE posti e sono lo stesso comando: in
// alto a destra nell'header, che nel semplice non c'è più, e dentro il menu
// della rotellina nella rastrelliera, che in avanzato non c'è. Scriverli tutti e due da qui
// costa una `querySelectorAll` e toglie l'unico modo in cui i due potrebbero
// dire cose diverse.
const modi = () => document.querySelectorAll(".modo");

export function setupModo() {
  // Il localStorage può lanciare (finestra privata, cookie di terze parti
  // bloccati): una preferenza che non si riesce a ricordare non è un motivo per
  // non far partire l'app.
  let salvato = null;
  try { salvato = localStorage.getItem(KEY); } catch {}

  // Le tracce si ricordano, come il modo: chi accende i grezzi li vuole accesi
  // anche domani. Si legge chiave per chiave e non in blocco, così un JSON di
  // una versione precedente non spegne tutto il grafico.
  leggiTracce();

  applica(salvato === "avanzato" ? "avanzato" : "semplice");
  for (const b of modi()) b.onclick = () => applica(MODO.now === "semplice" ? "avanzato" : "semplice");

  for (const b of document.querySelectorAll(".leg-i")) {
    b.onclick = () => {
      const t = tracce();
      t[b.dataset.trk] = !t[b.dataset.trk];
      salvaTracce();
      pittaLegenda();
    };
  }
  pittaLegenda();
}

function leggiTracce() {
  let j = null, vecchia = null;
  try { j = JSON.parse(localStorage.getItem(KEY_T) || "null"); vecchia = localStorage.getItem(KEY_C); } catch {}
  if (j) {
    for (const m of ["semplice", "avanzato"])
      for (const k of ["raw", "med", "fat"])
        if (typeof j?.[m]?.[k] === "boolean") TRK[m][k] = j[m][k];
    return;
  }
  // Chi aveva acceso il vecchio comando «curve» se lo ritrova acceso: era una
  // casella sola per due tracce, e questo è l'unico posto in cui si traduce.
  if (vecchia === "1") { TRK.semplice.raw = true; TRK.semplice.med = true; }
}

function salvaTracce() { try { localStorage.setItem(KEY_T, JSON.stringify(TRK)); } catch {} }

// La legenda dice quello che il grafico sta disegnando, e cambia insieme al modo:
// sono due memorie, quindi passando di là le tre voci possono accendersi da sole.
function pittaLegenda() {
  const t = tracce();
  for (const b of document.querySelectorAll(".leg-i"))
    b.setAttribute("aria-pressed", String(!!t[b.dataset.trk]));
}

function applica(m) {
  MODO.now = m;
  document.body.dataset.modo = m;
  try { localStorage.setItem(KEY, m); } catch {}
  for (const b of modi()) {
    // L'etichetta dice DOVE PORTA, non dove sei: un interruttore etichettato col
    // proprio stato si legge al contrario metà delle volte.
    b.textContent = m === "semplice" ? "Avanzato" : "Semplice";
    b.setAttribute("aria-pressed", String(m === "avanzato"));
    b.title = m === "semplice"
      ? "mostra tutti i comandi, le statistiche e il registro"
      : "torna alla vista essenziale";
  }
  pittaLegenda();
}

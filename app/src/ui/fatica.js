// ============================== il semaforo della fatica ==============================
//
// Mentre canti, un colore. Non un numero da leggere — chi sta cantando non legge
// niente — ma un blocco verde/giallo/rosso abbastanza grande da prendersi con la
// coda dell'occhio, e sotto il numero per chi guarda da fuori (che è poi
// l'insegnante, la persona per cui esiste tutto il progetto).
//
// **È la stessa identica misura dei momenti salienti**, letta sulla coda del ring
// invece che sulla registrazione intera: `core/fatica.js`, finestra di 2 s, meno
// il riposo. Se le due divergessero, il semaforo direbbe una cosa e la lista dopo
// ne segnalerebbe un'altra — che è esattamente il difetto per cui la fase 6a ha
// dovuto mettere la mediana a 300 ms sul grafico.
//
// **Due secondi di ritardo, e si dicono.** Il numero a `t` descrive [t-2s, t]: dal
// vivo il colore arriva circa un secondo dopo il centro di ciò che descrive. Non
// è aggiustabile senza cambiare la misura, e una misura più corta seguirebbe ogni
// attacco di frase invece della fatica di un passaggio. Meglio un semaforo lento e
// vero che uno pronto e nervoso.
//
// **Lo zero non lo chiede a nessuno**: è il 5° percentile del livello sugli ultimi
// due minuti, che sui samples del 4 settembre coincide al decimo di count col
// silenzio registrato apposta (vedi `zeroVivo`). Serve però un po' di storia — i
// primi `ZERO_MIN` secondi il semaforo resta spento e lo scrive, perché con
// qualche secondo di solo canto il "riposo" sarebbe la frase più piana.

import { store } from "../core/state.js";
import { ROSSO, VERDE, ZERO_MIN, Z, faticaOra, zeroVivo, zona } from "../core/fatica.js";
import { $ } from "./dom.js";

// Lo stato dal vivo, letto anche dal grafico (che disegna la linea della fatica e
// i due confini): un solo posto dove sta il numero, come `CAL` per la calibrazione.
export const FT = {
  base: NaN,      // lo zero di questa sessione, in count
  val: NaN,       // la fatica adesso, in count sopra il riposo
  zona: null,     // "verde" | "giallo" | "rosso" | null
};

// Lo zero costa una mediana mobile su due minuti: una volta al secondo, non a
// ogni fotogramma. Il valore invece è due secondi di coda, e 5 Hz è la stessa
// cadenza delle statistiche — più veloce non si leggerebbe comunque.
const T_ZERO = 1000, T_VAL = 200;
let tZero = 0, tVal = 0, el = null;

export function setupFatica() {
  el = $("fatica");
  el.title = "la fatica: il livello sopra il riposo, letto su una finestra di 2 s. " +
             "Verde fino a +" + VERDE + ", rosso oltre +" + ROSSO + ". " +
             "Lo zero è il 5° percentile degli ultimi due minuti: non serve calibrare.";
}

// Quanto manca, arrotondato per eccesso. Il +1 è il tick con cui si aggiorna lo
// zero: senza, il conto arriverebbe a zero e resterebbe lì per un secondo.
function attesa() {
  const span = store.tLast() - store.t[store.idx(0)];
  return Math.max(1, Math.ceil(ZERO_MIN - span) + 1);
}

export function tickFatica() {
  if (!el) return;
  const now = performance.now();
  if (now - tZero >= T_ZERO) { tZero = now; FT.base = zeroVivo(store); }
  if (now - tVal < T_VAL) return;
  tVal = now;

  FT.val = faticaOra(store, FT.base);
  FT.zona = zona(FT.val);

  const z = FT.zona ? Z[FT.zona] : null;
  // Il testo dice sempre la zona A PAROLE oltre che col colore: un semaforo
  // verde/giallo/rosso è la peggiore delle combinazioni per chi non distingue i
  // rossi dai verdi, e qui la parola costa due centimetri di barra.
  //
  // E finché non c'è, dice quanto manca invece di un trattino: nei primi venti
  // secondi non è rotto, sta misurando il riposo — e un "—" muto sembra un
  // guasto. Non si chiama "calibrazione" di proposito: la calibrazione è
  // un'altra cosa, sta dietro un altro pulsante e non serve a questo.
  const txt = z ? `${z.label} ${FT.val >= 0 ? "+" : ""}${FT.val.toFixed(0)}`
                : store.n ? `riposo… ${attesa()} s` : "—";
  if (el.textContent !== txt) el.textContent = txt;
  el.dataset.zona = FT.zona || "";
  el.title = z
    ? `${z.help}\nzero della sessione: ${FT.base.toFixed(0)} count`
    : (!store.n ? "nessun campione: collega il sensore o premi Simulatore."
                : `sto misurando dov'è il tuo riposo: servono ${ZERO_MIN} secondi di ` +
                  "storia, altrimenti lo zero sarebbe la frase che canti più piano. " +
                  "Non è la calibrazione, e non c'è niente da fare: basta aspettare.");
}

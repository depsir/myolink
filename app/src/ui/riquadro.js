// ============================== il riquadro ==============================
//
// Quello che si guarda mentre si canta, e l'unica cosa che si guarda: una
// parola, un numero, la nota, e un indicatore che oscilla. Ha preso il posto del
// semaforo in barra — stessa misura, stesso `FT` — perché in barra era grande
// due centimetri e stava accanto a ventidue altri controlli.
//
// **La parola dice il significato, non il colore.** Non «Verde» / «Rosso»:
// ripetere a parole il colore che si vede già non aggiunge niente («scrivere la
// parola rosso non vuol dire un cazzo», ed è vero). Ma toglierla del tutto
// lascerebbe il colore da solo, che è la combinazione peggiore per chi i rossi
// dai verdi non li distingue: così la parola porta informazione E fa da
// ridondanza. *Sforzo normale* / *Stai spingendo* / *Stai spingendo troppo*.
//
// **L'indicatore oscilla, non si accumula.** La prima stesura ci metteva sotto
// il tempo passato per zona; chi l'ha guardata l'ha letta come un ago che va
// avanti e indietro, e quella lettura è più utile: nel riquadro dal vivo vanno
// cose dal vivo. Il riassunto — tempo per zona, media, mediana — sta nella
// scheda della presa e fra le misure avanzate, dove un riassunto ha senso.
//
// **I primi secondi si dicono, e non dietro la `i`.** È l'unica spiegazione che
// resta in vista: finché lo zero della sessione non c'è, il riquadro non può
// rispondere, e uno schermo muto sembra rotto. Sono cinque (`ZERO_MIN`), non più
// venti: l'attesa era diventata la prima cosa che si vedeva dell'app. Non si
// chiama «calibrazione»: la calibrazione è un'altra cosa, sta dietro un altro
// pulsante e non serve a questo.
//
// **Niente etichette sopra i numeri.** «ADESSO» sul valore e «NOTA» sulla nota
// sono state tolte: la prima diceva una cosa che un riquadro dal vivo dice già
// per definizione, la seconda nominava una cosa che si riconosce da sola. In
// revisione il tempo lo dice la striscia, che è dove lo si sta cercando.

import { store } from "../core/state.js";
import { ROSSO, SCALA, VERDE, ZERO_MIN } from "../core/fatica.js";
import { A } from "../audio/audio.js";
import { P, noteName } from "../audio/pitch.js";
import { pThr } from "../draw/pitch.js";
import { FT } from "./fatica.js";
import { cursore, hasPitch } from "./marks.js";
import { semplice } from "./modo.js";
import { $ } from "./dom.js";

const DICE = {
  verde: "Sforzo normale",
  giallo: "Stai spingendo",
  rosso: "Stai spingendo troppo",
};

const T_TICK = 200;           // 5 Hz: la stessa cadenza di FT, più veloce non si legge
let t0 = 0, el = null;

export function setupRiquadro() {
  el = $("riq");
  // Il titolo dell'indicatore, non una legenda a schermo: «la legenda del meter
  // non importa, il colore è sufficiente». Chi vuole i numeri li trova qui e
  // nelle misure avanzate.
  $("riqMeter").title =
    `la scala va da 0 a +${SCALA} count sopra il tuo riposo: il verde finisce a ` +
    `+${VERDE}, il rosso comincia a +${ROSSO}.`;
}

// Che cosa dice il riquadro, adesso. È una funzione a parte — e non il corpo di
// `tickRiquadro` — perché ADESSO LO LEGGONO IN DUE: il riquadro a schermo, che
// scrive queste stesse quattro cose nel DOM, e la banda del video, che le
// disegna in un canvas. Divergendo, il file mostrerebbe un numero e lo schermo
// un altro; consegnando invece le stringhe già fatte, la sola differenza fra i
// due resta come sono dipinte.
//
// `notaBox` è "c'è una sorgente di pitch", non "in questo decimo di secondo la
// stima è buona": col microfono aperto (o su una presa che ha il suo pitch) il
// posto della nota resta e si svuota nelle pause. Altrimenti il riquadro si
// allargherebbe e si stringerebbe a ogni frase, che è la cosa che si nota al
// posto della misura.
export function lettura() {
  // In riascolto si dice il valore SOTTO IL CURSORE e non l'ultimo arrivato:
  // altrimenti si mostrerebbe un istante diverso da quello che i grafici stanno
  // disegnando, ed è esattamente la contraddizione che rende inutile un riquadro
  // di riepilogo.
  const c = cursore();
  const val = c ? c.val : FT.val;
  const z = c ? c.zona : FT.zona;
  const nota = c ? c.m : (A.on && P.c >= pThr() ? P.m : NaN);
  return {
    z, val, nota,
    say: z ? DICE[z] : attesaTesto(),
    num: z ? (val >= 0 ? "+" : "") + val.toFixed(0) : store.n ? attesa() + " s" : "—",
    notaBox: A.on || hasPitch(),
    // La frazione dell'indicatore, 0…1, con l'ago appoggiato al bordo destro
    // quando la misura esce dalla scala: fuori scala non vuol dire "non so".
    f: Math.min(1, Math.max(0, (isFinite(val) ? val : 0) / SCALA)),
  };
}

export function tickRiquadro() {
  if (!el || !semplice()) return;
  const now = performance.now();
  if (now - t0 < T_TICK) return;
  t0 = now;

  const L = lettura();
  scrivi("riqSay", L.say);
  scrivi("riqVal", L.num);

  const nb = $("riqNotaBox");
  nb.hidden = !L.notaBox;
  nb.classList.toggle("vuota", !isFinite(L.nota));
  scrivi("riqNota", isFinite(L.nota) ? noteName(L.nota) : "–");

  if (el.dataset.z !== (L.z || "")) el.dataset.z = L.z || "";
  $("riqNow").style.left = (L.f * 100).toFixed(1) + "%";
}

function scrivi(id, txt) {
  const e = $(id);
  if (e && e.textContent !== txt) e.textContent = txt;
}

// Quanto manca allo zero della sessione, arrotondato per eccesso. Il +1 è il
// tick con cui lo zero si aggiorna: senza, il conto arriverebbe a zero e
// resterebbe lì per un secondo.
function attesa() {
  if (!store.n) return 0;
  const span = store.tLast() - store.t[store.idx(0)];
  return Math.max(1, Math.ceil(ZERO_MIN - span) + 1);
}

const attesaTesto = () =>
  store.n ? "Sto misurando il tuo riposo" : "Nessun dato dal sensore";

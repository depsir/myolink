// ============================== l'asse dei tempi ==============================
//
// Il reticolo verticale e le etichette sotto, per i pannelli che condividono
// l'asse X. Stava scritto due volte — una in `chart.js`, una in `pitch.js` — e
// la seconda copia aveva il reticolo ma non le etichette: «il pitch non ha range
// temporale». Uniformità, qui, vuol dire una funzione sola: se domani cambia il
// passo delle tacche o il modo di scrivere l'adesso, cambia in un posto e i due
// pannelli restano d'accordo per costruzione.
//
// Non importa i canvas: riceve un contesto, l'asse e la funzione X di chi
// chiama. È l'unico modo per cui può servire tre pannelli con tre margini
// verticali diversi senza saperne niente.

import { mmss } from "../core/marks.js";
import { range, reviewT } from "../ui/marks.js";
import { semplice } from "../ui/modo.js";

// Il passo delle tacche: quello che rende leggibili sia mezzo secondo sia un
// minuto di finestra, senza mai passare i dieci segni.
export const passoTempi = (W) => (W <= 2 ? 0.25 : W <= 6 ? 1 : W <= 20 ? 2 : 5);

export function reticoloTempi(cx, ax, X, top, gh) {
  const step = passoTempi(ax.W);
  cx.strokeStyle = "#1c222c"; cx.lineWidth = 1;
  for (let s = Math.ceil(ax.tLeft / step) * step; s <= ax.tNow; s += step) {
    const x = Math.round(X(s)) + .5;
    cx.beginPath(); cx.moveTo(x, top); cx.lineTo(x, top + gh); cx.stroke();
  }
}

// Le etichette sotto il grafico. In avanzato sono i secondi indietro sulle
// tacche; nel semplice due parole ai due estremi — quanto indietro si vede e
// dov'è l'adesso — che in riascolto diventano il tempo dentro la presa, cioè il
// modo più corto per dire che quello che stai guardando è registrato.
export function etichetteTempi(cx, ax, X, x0, x1, y) {
  cx.fillStyle = "#6e7681"; cx.font = "10px ui-monospace, monospace";
  cx.textBaseline = "top";
  if (semplice()) {
    const r = range(), rev = reviewT();
    cx.textAlign = "left";
    cx.fillText(rev !== null && r ? mmss(ax.tLeft - r.t0) : "−" + ax.W.toFixed(0) + " s", x0, y);
    cx.textAlign = "right";
    // Gli ESTREMI della finestra e non il cursore: il cursore sta in mezzo, ce
    // l'ha già la sua riga, e scriverlo a destra farebbe leggere l'intervallo
    // sbagliato.
    cx.fillText(rev !== null && r ? mmss(ax.tNow - r.t0) : "adesso", x1, y);
    return;
  }
  const step = passoTempi(ax.W);
  cx.textAlign = "center";
  for (let s = Math.ceil(ax.tLeft / step) * step; s <= ax.tNow; s += step) {
    const x = Math.round(X(s)) + .5;
    // l'etichetta è centrata sulla tacca: vicino al bordo destro finirebbe tagliata
    if (x < x1 - 16) cx.fillText((s - ax.tNow).toFixed(ax.W <= 2 ? 2 : 1) + "s", x, y);
  }
}

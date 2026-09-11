// ============================== canvas condivisi ==============================
//
// Riferimenti, dimensioni e margini dei tre pannelli. Non importa né lo stato né
// l'audio: chi disegna riceve l'asse dei tempi come parametro, e così questo
// modulo può essere importato anche dall'audio (che chiama resize) senza cicli.

import { $ } from "../ui/dom.js";

export const cv = $("chart"), ctx = cv.getContext("2d");
export const pitCv = $("pitchCv"), pctx = pitCv.getContext("2d");
export const specCv = $("spec"), sctx = specCv.getContext("2d");

// `let` esportate: in un modulo ES il binding è vivo, quindi chi disegna legge
// sempre la misura aggiornata dall'ultimo resize.
export let dpr = 1, cssW = 0, cssH = 0, pitW = 0, pitH = 0, specW = 0, specH = 0;

// l e r condivisi dai tre canvas: è quello che fa coincidere gli assi X. Il
// margine destro è largo quanto quello sinistro perché ci stanno le stesse
// etichette: sul bordo destro c'è l'ADESSO, ed è lì che si guarda dal vivo.
export const PAD = { l: 52, r: 40, t: 10, b: 22 };

// Su 390px di larghezza quei 92px di margini sono un quarto dello schermo. Le
// etichette che ci stanno dentro sono al massimo quattro cifre ("4095") o un nome
// di nota ("A#4"), e a 10px monospace ci stanno anche in meno. Stringerli dipende
// SOLO dalla larghezza, che i tre canvas hanno identica: l'allineamento degli
// assi dei tempi resta garantito per costruzione, non per disciplina.
function setPad(w) {
  const narrow = w > 0 && w < 520;
  PAD.l = narrow ? 34 : 52;
  PAD.r = narrow ? 30 : 40;
}
export const SPAD = { t: 10, b: 10 };
// b: ci stanno la striscia di clarity (solo in avanzato) e sotto le etichette
// dei tempi, che il pannello del pitch scrive come quello del sensore.
export const PPAD = { t: 10, b: 26 };

// Un pannello compresso o nascosto ha dimensione 0: il canvas la segue e chi
// disegna si limita a saltarlo.
function fit(c, cx) {
  const w = c.clientWidth, h = c.clientHeight;
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [w, h];
}

export function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  // Un pannello compresso o nascosto misura 0: la larghezza vera è quella del
  // più largo dei tre.
  setPad(Math.max(cv.clientWidth, pitCv.clientWidth, specCv.clientWidth));
  [cssW, cssH] = fit(cv, ctx);
  [pitW, pitH] = fit(pitCv, pctx);
  [specW, specH] = fit(specCv, sctx);
}

for (const c of [cv, pitCv, specCv]) new ResizeObserver(resize).observe(c);

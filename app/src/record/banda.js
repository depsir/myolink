// ============================== la banda dello sforzo ==============================
//
// Il riquadro — parola, numero, nota e indicatore — ridisegnato in un canvas per
// finire dentro il video. È l'unico strato della registrazione che non è un
// pannello della pagina: gli altri tre esistono già come canvas e la
// composizione li copia, questo va dipinto.
//
// **Perché sta nel file e non solo a schermo.** I tre grafici raccontano il
// tempo, e il valore istantaneo lo si deve leggere sull'asse. La banda lo dice
// in cifre: riguardando la presa si vede a colpo d'occhio quanto stavi
// spingendo *in quel fotogramma*, senza inseguire una curva. Sta in CIMA, dov'è
// a schermo, e quindi si toglie con una passata di crop da chi non la vuole —
// che è la ragione per cui è in cima e non in mezzo.
//
// **Dice esattamente quello che dice il riquadro.** Non ricalcola niente: chiama
// `lettura()` di `ui/riquadro.js`, cioè la stessa funzione che scrive nel DOM.
// Se divergessero, il video sarebbe la misura di un'altra cosa — e nessuno se ne
// accorgerebbe fino a mettere il file accanto allo schermo.
//
// **I colori li legge dal CSS.** Le tinte delle tre zone sono variabili in
// `:root` (`--zbg-verde` e compagnia) e da qui si leggono con
// `getComputedStyle`: una palette copiata a mano in un canvas è una palette che
// diverge dal foglio di stile alla prima ritoccata.

import { Z } from "../core/fatica.js";
import { noteName } from "../audio/pitch.js";
import { lettura } from "../ui/riquadro.js";
import { bandaMisure, FERMATE } from "./layout.js";

// La banda di QUESTA registrazione. Stato di modulo e non un oggetto per
// chiamata perché di registrazioni ne esiste una alla volta, come per `R`.
let B = null;

// I colori dal foglio di stile, letti una volta per registrazione: a ogni
// fotogramma sarebbe una `getComputedStyle` trenta volte al secondo per sei
// stringhe che non cambiano.
function palette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  const zona = (k) => ({ bg: v("--zbg-" + k), ln: v("--zln-" + k), col: Z[k].col });
  return {
    panel: v("--panel"), line: v("--line"), fg: v("--fg"), dim: v("--dim"), bg: v("--bg"),
    verde: zona("verde"), giallo: zona("giallo"), rosso: zona("rosso"),
  };
}

// Apre la banda per la registrazione che sta partendo, larga `wDev` pixel del
// dispositivo — cioè quanto i pannelli, così l'impilamento resta una colonna
// sola. Torna il canvas, che è quello che la composizione andrà a copiare.
export function apriBanda(wDev, dpr) {
  const M = bandaMisure(wDev / dpr);
  const cv = document.createElement("canvas");
  cv.width = wDev;
  cv.height = Math.round(M.h * dpr);
  // `alpha: false` come il canvas di composizione: il fondo è opaco per
  // costruzione e l'encoder non deve inventarsi cosa c'è dietro.
  const cx = cv.getContext("2d", { alpha: false });
  B = { cv, cx, M, dpr, pal: palette() };
  pittaBanda();                         // un primo fotogramma, non un rettangolo vuoto
  return cv;
}

export function chiudiBanda() { B = null; }

// Chiamata dalla composizione a ogni fotogramma, PRIMA di copiare gli strati.
export function pittaBanda() {
  if (!B) return;
  const { cx, M, dpr, pal } = B;
  const L = lettura();
  const zc = L.z ? pal[L.z] : null;

  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx.textBaseline = "middle";

  // Il fondo: la stessa sfumatura del riquadro, tinta della zona in alto e
  // pannello al 72%. Senza zona resta il pannello liscio — non un verde per
  // cortesia, che è la lettura sbagliata dei primi secondi.
  const g = cx.createLinearGradient(0, 0, 0, M.h);
  g.addColorStop(0, zc ? zc.bg : pal.panel);
  g.addColorStop(0.72, pal.panel);
  g.addColorStop(1, pal.panel);
  cx.fillStyle = g;
  cx.fillRect(0, 0, M.w, M.h);
  cx.strokeStyle = zc ? zc.ln : pal.line;
  cx.lineWidth = 1;
  cx.strokeRect(0.5, 0.5, M.w - 1, M.h - 1);

  // ---- la riga: parola, numero, nota ----
  const conNota = L.notaBox;
  const xNota = conNota ? M.w - M.padX - M.wNota / 2 : 0;
  const xSep = M.w - M.padX - M.wNota - M.sep;
  const xNum = conNota ? xSep - M.sep : M.w - M.padX;

  cx.textAlign = "left";
  cx.font = `600 ${M.fSay}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
  cx.fillStyle = zc ? zc.col : pal.dim;
  // La parola non deve mai passare sotto al numero: `maxWidth` la stringe invece
  // di sovrapporla. Succede solo su video molto stretti e con la frase lunga.
  cx.fillText(L.say, M.padX, M.yRow, Math.max(10, xNum - M.padX - M.sep));

  cx.textAlign = "right";
  cx.font = `500 ${L.z ? M.fNum : M.fAttesa}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  cx.fillStyle = zc ? zc.col : pal.dim;
  cx.fillText(L.num, xNum, M.yRow);

  if (conNota) {
    // La riga divisoria è quella del riquadro (`border-left` sulla nota): dice
    // che la nota è un'altra misura, non un'altra cifra dello stesso numero.
    cx.strokeStyle = pal.line;
    cx.beginPath();
    cx.moveTo(Math.round(xSep) + 0.5, M.padY);
    cx.lineTo(Math.round(xSep) + 0.5, M.padY + M.row);
    cx.stroke();
    // Nelle pause il posto resta e il segno sparisce, come a schermo: niente
    // trattino, che sembrerebbe una nota che non si riesce a stimare.
    if (isFinite(L.nota)) {
      cx.textAlign = "center";
      cx.font = `500 ${M.fNota}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      cx.fillStyle = pal.fg;
      cx.fillText(noteName(L.nota), xNota, M.yRow);
    }
  }

  // ---- l'indicatore ----
  // Finché la misura non c'è l'indicatore non si disegna affatto: un ago fermo a
  // sinistra si legge come «sforzo zero», che è la cosa che non sappiamo ancora.
  if (!zc) return;
  const x0 = M.padX, gw = M.w - 2 * M.padX;
  const yT = M.yMk + (M.mk - M.track) / 2;
  const pista = cx.createLinearGradient(x0, 0, x0 + gw, 0);
  // Le tre fasce a tinta piatta e non sfumate l'una nell'altra: sono tre zone
  // con un confine, non un passaggio graduale — il gradiente del CSS fa lo
  // stesso con le fermate ripetute.
  const fasce = [[0, "verde"], [FERMATE[0], "giallo"], [FERMATE[1], "rosso"]];
  for (let i = 0; i < fasce.length; i++) {
    const [p, k] = fasce[i];
    // "55" in coda: la pista è lo sfondo dell'ago, non un secondo semaforo, e
    // alla stessa saturazione dei testi si porterebbe via l'occhio.
    pista.addColorStop(p, Z[k].col + "55");
    const fine = i + 1 < fasce.length ? fasce[i + 1][0] : 1;
    pista.addColorStop(fine, Z[k].col + "55");
  }
  cx.fillStyle = pista;
  cx.beginPath();
  cx.roundRect(x0, yT, gw, M.track, M.track / 2);
  cx.fill();

  // L'ago, col suo alone scuro: senza, sulla fascia della sua stessa zona
  // sparirebbe proprio quando conta — cioè quando sei nel rosso.
  const xa = x0 + L.f * gw - M.ago / 2;
  cx.fillStyle = pal.bg;
  cx.fillRect(xa - 2, M.yMk - 2, M.ago + 4, M.mk + 4);
  cx.fillStyle = zc.col;
  cx.beginPath();
  cx.roundRect(xa, M.yMk, M.ago, M.mk, M.ago / 2);
  cx.fill();
}

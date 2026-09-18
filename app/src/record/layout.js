// ============================== impaginazione del video ==============================
//
// Dove finisce ogni pannello dentro il fotogramma registrato. È l'unica parte
// della registrazione che si può sbagliare in silenzio — un rettangolo storto si
// vede solo riguardando il file — quindi sta qui da sola, senza canvas né DOM, ed
// è coperta dai test.
//
// I tre canvas hanno per costruzione la STESSA larghezza (è quella che tiene
// allineati gli assi dei tempi), quindi impilarli è già l'impaginazione giusta:
// una colonna sola, nell'ordine in cui stanno a schermo.
//
// Il quarto strato — la banda dello sforzo — non è un canvas della pagina e va
// dipinto (vedi banda.js): le sue misure stanno qui in fondo, con le altre, per
// la stessa ragione delle prime.

import { ROSSO, SCALA, VERDE } from "../core/fatica.js";

// Un fotogramma di dimensione dispari è legale ma i codec a sottocampionamento
// 4:2:0 (VP8, VP9, H.264 — cioè tutto quello che possiamo negoziare) devono
// arrotondare il piano di crominanza, e alcuni encoder rifiutano l'ingresso. Il
// pixel in più è fondo, e non si vede.
const even = (x) => Math.max(0, Math.ceil(x / 2) * 2);

// `layers`: [{ key, w, h }] in ordine di impilamento, misure in pixel del
// dispositivo (le stesse di canvas.width/.height, non le CSS: si registra alla
// risoluzione a cui l'app disegna davvero).
//
// Uno strato con misura 0 è un pannello nascosto o compresso: non occupa spazio
// e non viene disegnato. Va scartato qui e non da chi disegna, perché una
// drawImage con sorgente larga 0 è un'eccezione, non un no-op.
export function composeLayout(layers, gap = 0) {
  const on = layers.filter((l) => l.w > 0 && l.h > 0);
  if (!on.length) return { w: 0, h: 0, rects: [] };

  const w = even(Math.max(...on.map((l) => l.w)));
  const rects = [];
  let y = 0;
  for (const l of on) {
    // Centrato: con canvas di uguale larghezza è sempre 0, ma se un giorno uno
    // strato fosse più stretto starebbe in mezzo invece che appiccicato a
    // sinistra, e l'asse dei tempi resterebbe leggibile.
    rects.push({ key: l.key, x: Math.round((w - l.w) / 2), y, w: l.w, h: l.h });
    y += l.h + gap;
  }
  return { w, h: even(y - gap), rects };
}

// ============================== la banda dello sforzo ==============================

const clamp = (lo, x, hi) => Math.max(lo, Math.min(hi, x));

// Tutte le misure della banda, in pixel CSS, ricavate dalla sola larghezza. Sta
// qui e non accanto a chi dipinge per la ragione di tutto il modulo: è la parte
// che si può sbagliare in silenzio, e una banda storta si vede solo riguardando
// il file.
//
// L'altezza cresce con la larghezza e non è fissa: la stessa banda finisce in un
// video da 2480 px di un desktop e in uno da 780 di un telefono, e un'altezza
// fissa sarebbe una fascia enorme nel secondo e un filo nel primo. I due limiti
// sono il punto sotto il quale il numero non si legge più e quello sopra il
// quale la banda comincia a mangiarsi i grafici.
export function bandaMisure(W) {
  const h = Math.round(clamp(64, W * 0.075, 104));
  const padY = Math.round(h * 0.13);
  const padX = Math.round(h * 0.2);
  const mk = Math.round(h * 0.16);              // l'ago: alto quanto il suo posto
  const gap = Math.round(h * 0.09);             // fra la riga dei testi e l'indicatore
  const row = h - 2 * padY - mk - gap;          // la riga dei tre testi
  const fNota = Math.round(row * 0.66);
  return {
    w: W, h, padX, padY, mk, gap, row,
    fSay: Math.round(row * 0.48),
    fNum: Math.round(row * 0.92),
    // Senza misura il numero è un conto alla rovescia in secondi, cioè un testo
    // e non una cifra da leggere di sfuggita: più piccolo, come nel riquadro.
    fAttesa: Math.round(row * 0.58),
    fNota,
    // Tre caratteri di monospazio ("A#4" è il caso peggiore) più un margine: il
    // posto della nota è FISSO, perché la nota manca a ogni respiro e una banda
    // che si allarga e si stringe a ogni frase è la cosa che si guarda al posto
    // della misura.
    wNota: Math.round(fNota * 1.8),
    sep: Math.round(h * 0.16),                  // aria attorno alla riga divisoria
    yRow: padY + row / 2,                       // il centro della riga dei testi
    yMk: h - padY - mk,                         // il bordo alto dell'ago
    track: Math.round(mk * 0.7),                // lo spessore della pista colorata
    ago: Math.max(3, Math.round(h * 0.045)),    // la larghezza dell'ago
  };
}

// Le fermate del gradiente della pista NON sono numeri: sono i due confini delle
// zone letti sulla scala, gli stessi che il CSS scrive come 33.3% e 61.1%. Da
// qui si ricavano, così spostare una soglia sposta anche la pista.
export const FERMATE = [VERDE / SCALA, ROSSO / SCALA];

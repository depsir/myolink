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

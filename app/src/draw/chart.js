// ============================== grafico del sensore ==============================

import { S, store } from "../core/state.js";
import { ACT_WIN, CAL, movMedian, norm } from "../core/calib.js";
import { ROSSO, VERDE, WIN as WIN_F, Z, colore, faticaSerie, zona } from "../core/fatica.js";
import { markKey, mmss } from "../core/marks.js";
import { marks, range, restBase, reviewT, selected } from "../ui/marks.js";
import { FT } from "../ui/fatica.js";
import { semplice, tracce } from "../ui/modo.js";
import { ctx, cssW, cssH, PAD } from "./canvas.js";
import { etichetteTempi, reticoloTempi } from "./tempo.js";
import { $ } from "../ui/dom.js";

// ---- la scala del modo semplice ----
//
// Zero = il tuo riposo, fondo scala +90 count. Il modo avanzato disegna i count
// ASSOLUTI dell'ADC — 0…1000 di serie — e su quella scala la grandezza che conta
// occupa l'8% dell'altezza: le due prese buone del 4 settembre stanno a +24 e
// l'errore confermato a +68, cioè quarantaquattro count su mille. Tecnicamente
// giusto e illeggibile.
//
// Il fondo scala è lo stesso dell'indicatore del riquadro, ed è il motivo per
// cui i due si leggono insieme: un picco a metà altezza qui è l'ago a metà
// barra lì. Sotto lo zero si tiene un po' di margine perché la linea ci va
// davvero — il riposo è un percentile basso, non un minimo.
const SEM_MIN = -15, SEM_MAX = 90;

export function drawChart(ax) {
  const { W, tNow, tLeft } = ax;
  // Lo zero della sessione serve prima di tutto il resto nel modo semplice,
  // perché è lui a decidere la scala: senza, non c'è niente da disegnare in
  // count sopra il riposo, e si aspetta invece di inventare uno zero.
  const fBase = isFinite(FT.base) ? FT.base : restBase();
  const sem = semplice() && isFinite(fBase);
  let yMin = +$("ymin").value, yMax = +$("ymax").value;
  if (sem) { yMin = fBase + SEM_MIN; yMax = fBase + SEM_MAX; }
  // L'inviluppo del MyoWare è filtrato in hardware e in modo causale: SEGUE il
  // muscolo. Qui la traccia si sposta indietro di quel ritardo per allinearla al
  // pitch — e solo qui: i campioni nello store, e quindi il CSV, restano dove li
  // ha timbrati il firmware, che è tutto il punto del protocollo.
  const eoff = (+$("eoff").value || 0) / 1000;
  const gw = cssW - PAD.l - PAD.r, gh = cssH - PAD.t - PAD.b;
  // Quali delle tre tracce disegnare. Sono tre letture diverse dello stesso
  // segnale, sovrapposte, e spesso se ne guarda una sola: la nuvola dei grezzi
  // copre le altre due quando si cerca un artefatto, e la linea colorata da sola
  // è la lettura che va nel video. Il registratore copia questo canvas, quindi il
  // video segue la legenda senza doverne sapere niente.
  //
  // Il default per modo sta in `ui/modo.js`: nel semplice la linea di serie è una
  // sola — chi canta non sta cercando un artefatto — in avanzato ci sono tutte e
  // tre. Il comando è la legenda sotto il grafico, che c'è in tutti e due i modi.
  const trk = tracce();
  const vRaw = trk.raw, vMed = trk.med, vFat = trk.fat;

  ctx.clearRect(0, 0, cssW, cssH);

  const X = (t) => PAD.l + ((t - tLeft) / W) * gw;
  const Y = (v) => PAD.t + gh - ((v - yMin) / (yMax - yMin || 1)) * gh;
  // Nel modo semplice la scala è fissa, quindi un valore fuori scala esiste: un
  // elettrodo che si stacca, o il simulatore. Senza limite la linea esce dal
  // canvas e il grafico sembra VUOTO proprio quando sta succedendo qualcosa —
  // il modo peggiore di non dire niente. Appoggiata al bordo si vede che è
  // oltre, e quanto lo dice il numero nel riquadro. In avanzato niente limite:
  // lì la scala la sceglie chi guarda, e tagliarla sarebbe mentire.
  const Yc = (v) => (sem ? Math.max(PAD.t, Math.min(PAD.t + gh, Y(v))) : Y(v));

  // ---- la griglia ----
  ctx.strokeStyle = "#1c222c"; ctx.fillStyle = "#6e7681";
  ctx.lineWidth = 1; ctx.font = "10px ui-monospace, monospace";
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  if (sem) {
    // Le tre zone come FONDO, e non come quattro righe equidistanti che nella
    // scala della fatica non vorrebbero dire niente. Campiture bassissime: sopra
    // ci passa una linea sola, quindi il fondo può permettersi di dire dove sei
    // senza contendersi lo spazio con nient'altro — che era invece il motivo per
    // cui in avanzato le campiture erano state tolte.
    for (const [a, b, col] of [[0, VERDE, Z.verde.col], [VERDE, ROSSO, Z.giallo.col], [ROSSO, SEM_MAX, Z.rosso.col]]) {
      const y0 = Y(fBase + b), y1 = Y(fBase + a);
      ctx.fillStyle = col + "16";
      ctx.fillRect(PAD.l, y0, gw, y1 - y0);
    }
    for (const v of [0, VERDE, ROSSO, SEM_MAX]) {
      const y = Math.round(Y(fBase + v)) + .5;
      ctx.strokeStyle = v === 0 ? "#2f3846" : "#1c222c";
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(cssW - PAD.r, y); ctx.stroke();
      ctx.fillStyle = "#6e7681"; ctx.textAlign = "right";
      // L'etichetta in cima rientra: a `PAD.t` metà del testo sarebbe fuori dal
      // canvas, e il fondo scala è proprio quello che si legge quando la linea
      // ci si appoggia contro.
      ctx.fillText(v ? "+" + v : "0", PAD.l - 6, Math.max(y, PAD.t + 6));
    }
  } else {
    for (let i = 0; i <= 4; i++) {
      const v = yMin + (yMax - yMin) * i / 4, y = Math.round(Y(v)) + .5;
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(cssW - PAD.r, y); ctx.stroke();
      ctx.textAlign = "right"; ctx.fillText(v.toFixed(0), PAD.l - 6, y);
      ctx.textAlign = "left"; ctx.fillText(v.toFixed(0), cssW - PAD.r + 6, y);
    }
  }
  // Il reticolo e le etichette sotto stanno in `draw/tempo.js`: li disegna
  // identici anche il pannello del pitch, che ha lo stesso asse X.
  reticoloTempi(ctx, ax, X, PAD.t, gh);
  etichetteTempi(ctx, ax, X, PAD.l, cssW - PAD.r, PAD.t + gh + 5);

  // ---- le tre zone della fatica, come fasce orizzontali ----
  //
  // Lo ZERO viene dalla sessione, non dalla calibrazione: il 5° percentile del
  // livello sugli ultimi due minuti (vedi core/fatica.js). Quando non c'è ancora
  // — i primi secondi, finché lo zero non c'è — non si disegna niente, perché una fascia gialla
  // messa nel posto sbagliato è peggio di nessuna fascia.
  //
  // Due RIGHE e non due campiture. Le campiture c'erano, e coloravano metà
  // grafico per dire una cosa che una riga dice meglio: dove passa il confine.
  // Con la traccia grezza, la mediana e la linea della fatica già sopra, il fondo
  // colorato era la quarta cosa a contendersi lo stesso spazio.
  // Spente insieme alla linea della fatica: sono la scala su cui si legge LEI —
  // dove passa il confine fra le zone — e da sole, senza la linea, misurano una
  // cosa che nel grafico non c'è più.
  // In semplice le due righe non servono: i confini sono già il fondo.
  if (vFat && !sem && isFinite(fBase)) {
    ctx.save();
    ctx.setLineDash([2, 4]);
    ctx.textBaseline = "bottom"; ctx.font = "10px ui-monospace, monospace";
    for (const [d, col] of [[VERDE, Z.giallo.col], [ROSSO, Z.rosso.col]]) {
      const y = Math.round(Y(fBase + d)) + .5;
      if (y < PAD.t || y > PAD.t + gh) continue;
      ctx.strokeStyle = col + "99"; ctx.fillStyle = col + "dd";
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(cssW - PAD.r, y); ctx.stroke();
      ctx.textAlign = "right"; ctx.fillText("+" + d, cssW - PAD.r - 4, y - 2);
    }
    ctx.restore();
  }

  // Le due righe della calibrazione: dov'è il riposo e dov'è l'appoggio di
  // riferimento. Sono quello che rende il grafico leggibile senza convertire a
  // mente — la distanza fra la traccia e la riga verde È l'attivazione.
  if (CAL.ready && !sem) {
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.textBaseline = "bottom";
    // La riga del riferimento solo se quella scala esiste: disegnarla dove
    // l'appoggio è dentro il rumore mostrerebbe una soglia che non significa niente.
    const rows = [[CAL.base, "#6e7681", "riposo"]];
    if (CAL.hasRif) rows.push([CAL.rif, "#3fb950", "rif"]);
    for (const [v, col, txt] of rows) {
      const y = Math.round(Y(v)) + .5;
      if (y < PAD.t || y > PAD.t + gh) continue;
      ctx.strokeStyle = col; ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(cssW - PAD.r, y); ctx.stroke();
      ctx.textAlign = "left"; ctx.fillText(txt, PAD.l + 4, y - 2);
    }
    ctx.restore();
  }

  // Le bande dei momenti salienti, sotto la traccia: sono contesto, non dati, e
  // devono restare dietro. Stanno nel tempo del grafico, quindi finiscono nel
  // video da sé — con un solo effetto da sapere: il rilevamento è a posteriori,
  // quindi le bande di una registrazione compaiono nella registrazione DOPO.
  const sel = selected();
  for (const m of marks()) {
    if (m.t1 < tLeft || m.t0 > tNow) continue;
    const col = Z[m.zona]?.col || "#6e7681";
    const x0 = Math.max(PAD.l, X(m.t0)), x1 = Math.min(cssW - PAD.r, X(m.t1));
    const on = markKey(m) === sel;
    // Alpha bassa e sommabile: venti bande su una finestra da cinque secondi
    // possono sovrapporsi, e il fondo non deve diventare il colore del tipo più
    // frequente. La riga in alto è quella che si vede, la campitura è contesto.
    ctx.fillStyle = col + (m.scelta === "drop" ? "08" : on ? "22" : "0e");
    ctx.fillRect(x0, PAD.t, Math.max(1.5, x1 - x0), gh);
    ctx.fillStyle = col + (m.scelta === "drop" ? "44" : on ? "ff" : "aa");
    ctx.fillRect(x0, PAD.t, Math.max(1.5, x1 - x0), 2);
    // L'etichetta solo sul selezionato: venti etichette su una finestra da cinque
    // secondi sarebbero una parete di testo sopra la traccia.
    if (on) {
      ctx.font = "10px ui-monospace, monospace";
      ctx.textAlign = "left"; ctx.textBaseline = "top";
      // Nel semplice senza il nome della zona: il colore della banda lo dice già,
      // ed è la stessa ragione per cui il riquadro non scrive «rosso».
      ctx.fillText(`${mmss(m.t - (range()?.t0 || 0))}  ${sem ? "" : m.zona + " "}+${m.val.toFixed(0)}`, x0 + 3, PAD.t + 4);
    }
  }

  // traccia, spezzata sui buchi > 1.8 periodi
  if (store.n > 1) {
    const from = store.firstAtOrAfter(tLeft);
    const maxGap = (S.dtUs / 1e6) * 1.8;
    // **Tutte le tracce dentro il rettangolo del grafico.** Non è una cautela:
    // la linea della fatica è disegnata a `t − WIN/2` (mezza finestra indietro,
    // perché il valore descrive il passato), e l'offset EMG ne aggiunge un
    // altro, quindi il primo campione utile cade un secondo A SINISTRA del bordo
    // sinistro — cioè fuori dall'asse Y, sopra le etichette dei count. Tagliare
    // il disegno è l'unico modo giusto: spostare la condizione d'ingresso
    // taglierebbe invece la LINEA, lasciando un secondo di buco dopo l'asse.
    ctx.save();
    ctx.beginPath(); ctx.rect(PAD.l, PAD.t, gw, gh); ctx.clip();

    // I campioni grezzi passano in secondo piano: sono la nuvola attorno alla
    // linea, non la linea. Vedi il blocco qui sotto.
    if (vRaw) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = "#4ea1ff"; ctx.lineWidth = 1.4;
      ctx.lineJoin = "round"; ctx.beginPath();
      let prevT = null;
      for (let k = from; k < store.n; k++) {
        const i = store.idx(k), t = store.t[i], x = X(t - eoff), y = Y(store.v[i]);
        if (prevT === null || t - prevT > maxGap) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        prevT = t;
      }
      ctx.stroke();
      ctx.restore();
    }

    // ---- la mediana a 300 ms: LA LINEA SU CUI LAVORANO I RILEVATORI ----
    //
    // Senza, il grafico mostra una cosa e la lista dei momenti ne segnala
    // un'altra. Il fenomeno che chi canta riconosce — "quando tiro la linea
    // oscilla di più" — ha un'ampiezza di pochi count, mentre il rumore per
    // campione ne ha quattro volte tanti: sui grezzi sta sotto la nuvola, e
    // quello che non si vede non si può giudicare. Su un vecchio plotter
    // dell'Arduino IDE si vedeva benissimo, ma solo perché quella traccia era
    // già lisciata da chi la stampava; la nostra no.
    //
    // È esattamente `movMedian(ts, vs, ACT_WIN)`, la stessa funzione che gira
    // dentro l'analisi — non un lisciamento "per far bello": se le due
    // divergessero, il grafico mentirebbe.
    //
    // La finestra si semina prima del bordo sinistro, altrimenti i primi istanti
    // visibili mostrerebbero una mediana parziale, cioè più bassa del vero. Il
    // margine è quello della misura più lenta delle due — la fatica, 2 s — e non
    // solo ACT_WIN: con il margine corto la linea colorata comincerebbe due
    // secondi dopo il bordo sinistro, a finestra piccola cioè quasi mai.
    //
    // La raccolta dei campioni seminati serve a entrambe le linee, quindi si fa
    // una volta sola — e non si fa affatto se sono spente tutt'e due.
    const ts = [], vs = [];
    if (vMed || vFat) {
      const seed = store.firstAtOrAfter(tLeft - ACT_WIN - WIN_F);
      for (let k = seed; k < store.n; k++) { const i = store.idx(k); ts.push(store.t[i]); vs.push(store.v[i]); }
    }
    if (vMed && ts.length > 2) {
      const lvl = movMedian(ts, vs, ACT_WIN);
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = "#e6edf3"; ctx.lineWidth = 1.5;
      ctx.lineJoin = "round"; ctx.beginPath();
      let pT = null;
      for (let k = 0; k < ts.length; k++) {
        if (ts[k] < tLeft) { pT = ts[k]; continue; }
        const x = X(ts[k] - eoff), y = Y(lvl[k]);
        if (pT === null || ts[k] - pT > maxGap) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        pT = ts[k];
      }
      ctx.stroke();
      ctx.restore();
    }

    // ---- la linea della fatica: la misura, col suo colore ----
    //
    // La mediana a 2 s della linea bianca, meno il riposo — cioè esattamente il
    // numero che finisce nel semaforo in barra e accanto a ogni momento della
    // lista. Disegnata sull'asse dei count come tutto il resto, così la distanza
    // fra lei e la riga del riposo È la fatica, senza convertire a mente.
    //
    // **Sta indietro di mezza finestra**, come i tratti in `tratti()`: il valore a
    // `t` descrive [t-2s, t], e disegnarlo a `t` lo metterebbe un secondo a destra
    // del passaggio che descrive — cioè disallineato dalla banda del momento, che
    // è già centrata. Dal vivo questo vuol dire che la linea finisce un secondo
    // prima del cursore, ed è giusto così: il futuro non lo sappiamo.
    //
    // Il colore cambia dove cambia la zona, e il cambio avviene sul segmento: si
    // chiude un tratto e se ne apre uno nuovo dal punto precedente, altrimenti
    // fra una zona e l'altra resterebbe un buco di un campione.
    if (vFat && isFinite(fBase) && ts.length > 2 && ts[ts.length - 1] - ts[0] > WIN_F) {
      const fat = faticaSerie(ts, vs, fBase);
      ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.lineCap = "round";
      let zPrev = null, pT = 0, pX = 0, pY = 0, aperto = false;
      const chiudi = () => { if (aperto) ctx.stroke(); aperto = false; };
      for (let k = 0; k < ts.length; k++) {
        const z = zona(fat[k]);
        if (z === null || ts[k] < tLeft - 1e-9) { chiudi(); zPrev = null; continue; }
        const x = X(ts[k] - eoff - WIN_F / 2), y = Yc(fBase + fat[k]);
        if (zPrev === null || ts[k] - pT > maxGap * 4) {
          chiudi(); ctx.strokeStyle = colore(fat[k]); ctx.beginPath(); ctx.moveTo(x, y); aperto = true;
        } else if (z !== zPrev) {
          chiudi(); ctx.strokeStyle = colore(fat[k]); ctx.beginPath(); ctx.moveTo(pX, pY); ctx.lineTo(x, y); aperto = true;
        } else ctx.lineTo(x, y);
        zPrev = z; pT = ts[k]; pX = x; pY = y;
      }
      chiudi();
      ctx.lineCap = "butt";
    }

    // cursore + ultimo valore
    const li = store.last(), lt = store.t[li];
    const lagMs = (tNow - lt) * 1000;
    if (S.running) S.maxLagMs = Math.max(S.maxLagMs, lagMs);
    // In revisione la riga verticale sta sul PUNTO CHE SI STA GUARDANDO, non sul
    // bordo destro della finestra: il bordo destro è l'adesso solo dal vivo, e
    // lasciarla lì mentre si riguarda una presa indicherebbe un istante che non
    // è quello di cui parlano il riquadro e la striscia.
    const rv = reviewT();
    const xc = Math.round(X(rv !== null ? rv : tNow)) + .5;
    ctx.strokeStyle = rv !== null ? "#8b949e" : "#30363d"; ctx.beginPath();
    ctx.moveTo(xc, PAD.t); ctx.lineTo(xc, PAD.t + gh); ctx.stroke();
    // Il pallino è il capolinea della traccia grezza, e sparisce con lei; il
    // numero qui sotto no — quello è la lettura, e si guarda anche a traccia
    // spenta. Il colore va rimesso apposta: se restasse quello lasciato
    // dall'ultimo disegno, con le tracce spente sarebbe il grigio del cursore.
    if (vRaw) {
      ctx.fillStyle = "#4ea1ff";
      ctx.beginPath(); ctx.arc(X(lt - eoff), Y(store.v[li]), 2.5, 0, 7); ctx.fill();
    }
    ctx.restore();
    // Il count grezzo dell'ultimo campione: in semplice non compare, perché
    // "512" senza la sua scala non è un'informazione — è un numero. Quello che
    // conta lì è il +4 sopra il riposo, ed è già grande nel riquadro.
    if (sem) return;
    ctx.fillStyle = "#4ea1ff";
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.font = "11px ui-monospace, monospace";
    // Il count grezzo resta, e accanto l'attivazione normalizzata: il primo dice
    // cosa ha letto l'ADC, la seconda cosa vuol dire.
    const a = norm(store.v[li], CAL, "rif");
    const sg = norm(store.v[li], CAL, "sigma");
    const tag = isFinite(a) ? "  " + a.toFixed(2) + " \u00d7rif"
              : isFinite(sg) ? "  " + sg.toFixed(1) + " \u03c3" : "";
    ctx.fillText(store.v[li].toFixed(0) + tag, PAD.l + 6, PAD.t + 4);
  }
}

// Y automatica sui dati in vista: usata dal pulsante "Auto Y".
export function autoY() {
  if (!store.n) return;
  const from = store.firstAtOrAfter(store.t[store.last()] - (+$("win").value || 5));
  let lo = Infinity, hi = -Infinity;
  for (let k = from; k < store.n; k++) { const v = store.v[store.idx(k)]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const m = Math.max(1, (hi - lo) * 0.15);
  $("ymin").value = Math.round(lo - m); $("ymax").value = Math.round(hi + m);
}

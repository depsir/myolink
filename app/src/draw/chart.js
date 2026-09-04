// ============================== grafico del sensore ==============================

import { S, store } from "../core/state.js";
import { ACT_WIN, CAL, movMedian, norm } from "../core/calib.js";
import { ROSSO, VERDE, WIN as WIN_F, Z, colore, faticaSerie, zona } from "../core/fatica.js";
import { markKey, mmss } from "../core/marks.js";
import { marks, range, restBase, selected } from "../ui/marks.js";
import { FT } from "../ui/fatica.js";
import { ctx, cssW, cssH, PAD } from "./canvas.js";
import { $ } from "../ui/dom.js";

export function drawChart(ax) {
  const { W, tNow, tLeft } = ax;
  const yMin = +$("ymin").value, yMax = +$("ymax").value;
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
  // video segue le caselle senza doverne sapere niente.
  // Il default è "accesa": senza DOM il grafico resta completo.
  const vis = (id) => $(id)?.checked ?? true;
  const vRaw = vis("trRaw"), vMed = vis("trMed"), vFat = vis("trFat");

  ctx.clearRect(0, 0, cssW, cssH);

  const X = (t) => PAD.l + ((t - tLeft) / W) * gw;
  const Y = (v) => PAD.t + gh - ((v - yMin) / (yMax - yMin || 1)) * gh;

  // griglia
  ctx.strokeStyle = "#1c222c"; ctx.fillStyle = "#6e7681";
  ctx.lineWidth = 1; ctx.font = "10px ui-monospace, monospace";
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i++) {
    const v = yMin + (yMax - yMin) * i / 4, y = Math.round(Y(v)) + .5;
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(cssW - PAD.r, y); ctx.stroke();
    ctx.textAlign = "right"; ctx.fillText(v.toFixed(0), PAD.l - 6, y);
    ctx.textAlign = "left"; ctx.fillText(v.toFixed(0), cssW - PAD.r + 6, y);
  }
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  const step = W <= 2 ? 0.25 : W <= 6 ? 1 : W <= 20 ? 2 : 5;
  for (let s = Math.ceil(tLeft / step) * step; s <= tNow; s += step) {
    const x = Math.round(X(s)) + .5;
    ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, PAD.t + gh); ctx.stroke();
    // l'etichetta è centrata sulla tacca: vicino al bordo destro finirebbe tagliata
    if (x < cssW - PAD.r - 16) ctx.fillText((s - tNow).toFixed(W <= 2 ? 2 : 1) + "s", x, PAD.t + gh + 5);
  }

  // ---- le tre zone della fatica, come fasce orizzontali ----
  //
  // Lo ZERO viene dalla sessione, non dalla calibrazione: il 5° percentile del
  // livello sugli ultimi due minuti (vedi core/fatica.js). Quando non c'è ancora
  // — i primi venti secondi — non si disegna niente, perché una fascia gialla
  // messa nel posto sbagliato è peggio di nessuna fascia.
  //
  // Due RIGHE e non due campiture. Le campiture c'erano, e coloravano metà
  // grafico per dire una cosa che una riga dice meglio: dove passa il confine.
  // Con la traccia grezza, la mediana e la linea della fatica già sopra, il fondo
  // colorato era la quarta cosa a contendersi lo stesso spazio.
  // Spente insieme alla linea della fatica: sono la scala su cui si legge LEI —
  // dove passa il confine fra le zone — e da sole, senza la linea, misurano una
  // cosa che nel grafico non c'è più.
  const fBase = isFinite(FT.base) ? FT.base : restBase();
  if (vFat && isFinite(fBase)) {
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
  if (CAL.ready) {
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
      ctx.fillText(`${mmss(m.t - (range()?.t0 || 0))}  ${m.zona} +${m.val.toFixed(0)}`, x0 + 3, PAD.t + 4);
    }
  }

  // traccia, spezzata sui buchi > 1.8 periodi
  if (store.n > 1) {
    const from = store.firstAtOrAfter(tLeft);
    const maxGap = (S.dtUs / 1e6) * 1.8;
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
        const x = X(ts[k] - eoff - WIN_F / 2), y = Y(fBase + fat[k]);
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
    ctx.strokeStyle = "#30363d"; ctx.beginPath();
    ctx.moveTo(Math.round(X(tNow)) + .5, PAD.t); ctx.lineTo(Math.round(X(tNow)) + .5, PAD.t + gh); ctx.stroke();
    // Il pallino è il capolinea della traccia grezza, e sparisce con lei; il
    // numero qui sotto no — quello è la lettura, e si guarda anche a traccia
    // spenta. Il colore va rimesso apposta: se restasse quello lasciato
    // dall'ultimo disegno, con le tracce spente sarebbe il grigio del cursore.
    if (vRaw) {
      ctx.fillStyle = "#4ea1ff";
      ctx.beginPath(); ctx.arc(X(lt - eoff), Y(store.v[li]), 2.5, 0, 7); ctx.fill();
    }
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

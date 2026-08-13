// ============================== grafico del sensore ==============================

import { S, store } from "../core/state.js";
import { ctx, cssW, cssH, PAD } from "./canvas.js";
import { $ } from "../ui/dom.js";

export function drawChart(ax) {
  const { W, tNow, tLeft } = ax;
  const yMin = +$("ymin").value, yMax = +$("ymax").value;
  const gw = cssW - PAD.l - PAD.r, gh = cssH - PAD.t - PAD.b;

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

  // traccia, spezzata sui buchi > 1.8 periodi
  if (store.n > 1) {
    const from = store.firstAtOrAfter(tLeft);
    const maxGap = (S.dtUs / 1e6) * 1.8;
    ctx.strokeStyle = "#4ea1ff"; ctx.lineWidth = 1.4;
    ctx.lineJoin = "round"; ctx.beginPath();
    let prevT = null;
    for (let k = from; k < store.n; k++) {
      const i = store.idx(k), t = store.t[i], x = X(t), y = Y(store.v[i]);
      if (prevT === null || t - prevT > maxGap) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      prevT = t;
    }
    ctx.stroke();

    // cursore + ultimo valore
    const li = store.last(), lt = store.t[li];
    const lagMs = (tNow - lt) * 1000;
    if (S.running) S.maxLagMs = Math.max(S.maxLagMs, lagMs);
    ctx.strokeStyle = "#30363d"; ctx.beginPath();
    ctx.moveTo(Math.round(X(tNow)) + .5, PAD.t); ctx.lineTo(Math.round(X(tNow)) + .5, PAD.t + gh); ctx.stroke();
    ctx.fillStyle = "#4ea1ff";
    ctx.beginPath(); ctx.arc(X(lt), Y(store.v[li]), 2.5, 0, 7); ctx.fill();
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillText(store.v[li].toFixed(0), PAD.l + 6, PAD.t + 4);
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

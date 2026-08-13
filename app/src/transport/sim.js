// ============================== trasporto: simulatore ==============================
//
// Genera pacchetti localmente con perdite e stalli artificiali: serve per
// provare la UI e verificare che il grafico regga a buchi e jitter.
//
// Modella il BLE fedelmente: i pacchetti possono essere PERSI o RITARDATI, mai
// riordinati (il link layer BLE garantisce l'ordine). Lo stallo è quindi una
// coda FIFO che si blocca e poi si svuota tutta insieme.

import { ingest } from "../core/ingest.js";
import { startSession, onStop } from "../core/session.js";
import { $ } from "../ui/dom.js";

let demoTimer = null;

export function connectDemo() {
  startSession("demo", "simulatore");
  const dt = Math.round(1e6 / (+$("rate").value || 20));
  let k = 0, seq = 0, stallUntil = 0;
  const t0 = performance.now();
  const queue = [];

  demoTimer = setInterval(() => {
    const now = performance.now();
    const nowUs = Math.round((now - t0) * 1000);

    while (k * dt < nowUs) {
      const ts = (k * dt) / 1e6;
      const env = 1200 + 900 * Math.sin(ts * 1.1) * Math.max(0, Math.sin(ts * 0.31)) + 60 * Math.random();
      const p = { flags: 1, seq: seq++, t0_us: (k * dt) >>> 0, dt_us: dt, values: Int16Array.of(Math.round(env)) };
      k++;
      if (Math.random() < 0.01) continue;              // 1% di notify scartate
      queue.push(p);
      if (Math.random() < 0.004) stallUntil = now + 40 + 120 * Math.random();  // stallo radio
    }

    if (now < stallUntil) return;
    while (queue.length) ingest(queue.shift(), now);
  }, 4);
}

onStop(() => { if (demoTimer) { clearInterval(demoTimer); demoTimer = null; } });

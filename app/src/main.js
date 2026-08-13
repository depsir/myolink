// ============================== avvio ==============================
//
// Qui sta solo il collegamento fra DOM e moduli, più il ciclo di disegno. Il
// ciclo vive qui e non in draw/canvas.js perché altrimenti canvas.js dovrebbe
// importare i tre disegnatori, che a loro volta importano canvas.js.

import "./style.css";

import { S, store, spec, pitch, clock, T } from "./core/state.js";
import { stop, sendCommand } from "./core/session.js";
import { logEnvironment } from "./core/diagnostics.js";
import { connectSerial } from "./transport/serial.js";
import { connectBle } from "./transport/ble.js";
import { connectDemo } from "./transport/sim.js";
import { A, applyFft, toggleAudio } from "./audio/audio.js";
import { P } from "./audio/pitch.js";
import { PAD, resize, cssW, cssH, pitW, pitH, specW, specH } from "./draw/canvas.js";
import { drawChart, autoY } from "./draw/chart.js";
import { drawPitch, resetPitchRange } from "./draw/pitch.js";
import { drawSpec } from "./draw/spec.js";
import { setupPanels } from "./ui/panels.js";
import { setupStats, updateStats } from "./ui/stats.js";
import { $, log } from "./ui/dom.js";

// Il cursore avanza col clock dell'host mappato sull'asse del grafico: se i dati
// si fermano, il cursore va avanti e il buco si VEDE. Con tutto spento la vista
// si congela sull'ultimo dato, qualunque dei due flussi sia arrivato per ultimo.
function timeAxis() {
  const W = Math.max(0.5, +$("win").value || 5);
  let tNow;
  if (S.running || A.on) tNow = T.now();
  else if (store.n || spec.n) tNow = Math.max(store.tLast(), spec.tLast());
  else tNow = 0;
  return { W, tNow, tLeft: tNow - W };
}

function draw() {
  requestAnimationFrame(draw);
  const ax = timeAxis();
  if (cssW && cssH) drawChart(ax);
  if (pitW && pitH) drawPitch(ax);
  if (specW && specH) drawSpec(ax);
  updateStats();
}

setupPanels();
setupStats();

$("btnSerial").onclick = connectSerial;
$("btnBle").onclick = connectBle;
$("btnDemo").onclick = connectDemo;
$("btnStop").onclick = () => stop("manuale");
$("btnAudio").onclick = toggleAudio;
$("fft").onchange = applyFft;
$("pauto").onchange = () => {
  const auto = $("pauto").checked;
  $("plo").disabled = $("phi").disabled = auto;
  if (auto) resetPitchRange();
};
$("btnRate").onclick = () => {
  const hz = +$("rate").value;
  if (hz > 0) sendCommand("P" + Math.round(1e6 / hz));
};
$("btnAuto").onclick = autoY;

// ---- schermo stretto: due interruttori e una nota che si può chiudere ----
// Le classi le interpreta solo il CSS dentro la media query: su desktop questi
// handler restano collegati a elementi che non sono visibili.
$("btnCfg").onclick = () =>
  $("btnCfg").setAttribute("aria-expanded", $("hdr").classList.toggle("open"));
$("btnRotate").onclick = () => document.body.classList.add("norotate");
// Su desktop la nota resta aperta com'era; su un telefono sarebbe mezzo schermo
// di testo sotto ai grafici, quindi parte chiusa.
$("hintBox").open = window.innerWidth > 720;

// Con un modulo ES le variabili di primo livello non sono più globali, e le
// verifiche del banco di prova (Chrome headless via CDP, vedi README) leggono lo
// stato interno per controllare timestamp, colonne e stime. Questo è l'unico
// punto d'accesso: esplicito, così si sa che esiste ed è quello.
window.MyoLink = { S, T, store, spec, pitch, clock, A, P, PAD };

resize();
requestAnimationFrame(draw);
log('pronto — "Simulatore" per provare senza hardware');
logEnvironment();

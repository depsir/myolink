// ============================== avvio ==============================
//
// Qui sta solo il collegamento fra DOM e moduli, più il ciclo di disegno. Il
// ciclo vive qui e non in draw/canvas.js perché altrimenti canvas.js dovrebbe
// importare i tre disegnatori, che a loro volta importano canvas.js.

import "./style.css";

import { S, store, spec, pitch, clock, T } from "./core/state.js";
import { CAL } from "./core/calib.js";
import { stop, sendCommand } from "./core/session.js";
import { logEnvironment } from "./core/diagnostics.js";
import { connectSerial } from "./transport/serial.js";
import { connectBle } from "./transport/ble.js";
import { connectDemo } from "./transport/sim.js";
import { A, applyFft, toggleAudio } from "./audio/audio.js";
import { TP } from "./audio/tape.js";
import { P } from "./audio/pitch.js";
import { PAD, resize, cssW, cssH, pitW, pitH, specW, specH } from "./draw/canvas.js";
import { drawChart, autoY } from "./draw/chart.js";
import { drawPitch, resetPitchRange } from "./draw/pitch.js";
import { drawSpec } from "./draw/spec.js";
import { R, toggleRecord, drawComposite, exportCsv, saveRecording } from "./record/recorder.js";
import { setupPanels } from "./ui/panels.js";
import { setupStats, updateStats } from "./ui/stats.js";
import { lastCal, setupCalib } from "./ui/calib.js";
import { drawStrip, marks, range as marksRange, reviewT, setupMarks } from "./ui/marks.js";
import { FT, setupFatica, tickFatica } from "./ui/fatica.js";
import { F } from "./core/fase.js";
import { MODO, setupModo, tracce } from "./ui/modo.js";
import { setupRack, tickRack } from "./ui/rack.js";
import { setupRiquadro, tickRiquadro } from "./ui/riquadro.js";
import { $, log } from "./ui/dom.js";

// Il cursore avanza col clock dell'host mappato sull'asse del grafico: se i dati
// si fermano, il cursore va avanti e il buco si VEDE. Con tutto spento la vista
// si congela sull'ultimo dato, qualunque dei due flussi sia arrivato per ultimo.
function timeAxis() {
  const W = Math.max(0.5, +$("win").value || 5);
  let tNow;
  // Il cursore di revisione vince su tutto, anche col sensore collegato: guardare
  // un momento e vedersi trascinare via dal vivo un secondo dopo sarebbe
  // inutilizzabile. Si esce con "dal vivo", che è un pulsante e non un timeout.
  // Il momento sta al CENTRO della finestra e non sul bordo destro: dal vivo il
  // bordo destro è l'adesso, in revisione l'interessante è cosa c'era attorno.
  const rev = reviewT();
  if (rev !== null) tNow = rev + W / 2;
  else if (S.running || A.on) tNow = T.now();
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
  drawStrip(ax);
  // Il semaforo prima della composizione, perché sta in barra e non nei canvas:
  // si limita da sé a 5 Hz (lo zero a 1 Hz), quindi chiamarlo a ogni fotogramma
  // non costa niente.
  tickFatica();
  // Il riquadro e la rastrelliera degli ingressi: entrambi si limitano da sé a
  // 5 Hz e toccano il DOM solo quando il testo cambia, quindi stanno nel ciclo
  // come le statistiche invece di avere due timer propri. Uno stato che si
  // aggiorna da un timer suo è uno stato che, prima o poi, mostra un istante
  // diverso da quello che i grafici stanno disegnando.
  tickRack();
  tickRiquadro();
  // Dopo i tre pannelli: il canvas di composizione copia fotogrammi già finiti.
  if (R.on) drawComposite();
  updateStats();
}

// Il modo PRIMA di tutto il resto: decide quali pannelli hanno dimensione, e
// quindi cosa misura il primo `resize()`.
setupModo();

setupPanels();
setupStats();
setupCalib();
setupMarks();
setupFatica();
setupRiquadro();
setupRack();

$("btnSerial").onclick = connectSerial;
$("btnBle").onclick = connectBle;
$("btnDemo").onclick = connectDemo;
$("btnStop").onclick = () => stop("manuale");
$("btnAudio").onclick = toggleAudio;
$("btnRec").onclick = toggleRecord;
$("btnSave").onclick = saveRecording;
$("btnCsv").onclick = exportCsv;
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
// `CAL` con un getter e non per valore: la calibrazione si sostituisce in blocco,
// e un valore copiato qui resterebbe quello di prima della prima calibrazione.
// `CAL` e `calBuilt` con un getter e non per valore: si sostituiscono in blocco, e
// un valore copiato qui resterebbe quello di prima della prima calibrazione.
// `calBuilt` è l'ultima costruita anche se rifiutata — `CAL` solo quella attiva.
window.MyoLink = {
  S, T, store, spec, pitch, clock, A, P, R, PAD, TP,
  // La fase e il modo: dal banco di prova sono ciò che dice quale schermata si
  // sta guardando, e senza di loro un controllo su "il comando giusto è in
  // vista" dovrebbe dedurlo dal CSS.
  F, MODO,
  // Quali delle tre letture del grafico del sensore sono accese: dal banco di
  // prova è il modo di controllare che la legenda e il disegno dicano la stessa
  // cosa, senza andare a leggere il localStorage.
  get tracce() { return tracce(); },
  get CAL() { return CAL; },
  // Il semaforo della fatica dal vivo: zero, numero e zona. Dal banco di prova è
  // il solo modo di controllare che il colore corrisponda alla misura.
  FT,
  get calBuilt() { return lastCal(); },
  // I momenti salienti come li vede l'utente: è la lista dopo le due manopole,
  // non i candidati. È il punto da leggere dal banco di prova.
  get marks() { return marks(); },
  get marksRange() { return marksRange(); },
  // Il tempo su cui sono puntati i pannelli: null dal vivo, il cursore in
  // revisione, e la posizione della riproduzione mentre si riascolta. Dal banco è
  // il solo modo di vedere che l'audio sta davvero muovendo i grafici.
  get reviewT() { return reviewT(); },
};

resize();
requestAnimationFrame(draw);
log('pronto — "Simulatore" per provare senza hardware');
logEnvironment();

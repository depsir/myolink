// ============================== trasporto: seriale ==============================

import { CobsDecoder } from "../core/proto.js";
import { onPacketBytes } from "../core/ingest.js";
import { S } from "../core/state.js";
import { startSession, stop, onStop, onSend } from "../core/session.js";
import { logFail, SERIAL_HINT } from "../core/diagnostics.js";
import { log } from "../ui/dom.js";

let serialPort = null, serialReader = null;

export async function connectSerial() {
  if (!("serial" in navigator)) return log("Web Serial non disponibile. Serve Chrome/Edge su desktop, e un contesto sicuro: https oppure http://localhost.");
  try {
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: 115200 });   // su USB CDC il baud è ignorato
    try { await serialPort.setSignals({ dataTerminalReady: true }); } catch {}
    startSession("serial", "seriale");

    const cobs = new CobsDecoder(onPacketBytes);
    serialReader = serialPort.readable.getReader();
    (async () => {
      try {
        while (S.running) {
          const { value, done } = await serialReader.read();
          if (done) break;
          if (value) cobs.feed(value);
        }
      } catch (e) { if (S.running) log("errore lettura seriale: " + e.message); }
      if (S.running) stop("porta chiusa");
    })();
  } catch (e) { logFail("seriale", e, SERIAL_HINT); }
}

async function closeSerial() {
  try { await serialReader?.cancel(); } catch {}
  try { serialReader?.releaseLock(); } catch {}
  try { await serialPort?.close(); } catch {}
  serialReader = serialPort = null;
}

async function sendSerial(text) {
  if (!serialPort?.writable) return;
  const w = serialPort.writable.getWriter();
  try { await w.write(new TextEncoder().encode(text + "\n")); } finally { w.releaseLock(); }
}

onStop(closeSerial);
onSend("serial", sendSerial);

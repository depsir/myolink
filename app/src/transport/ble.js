// ============================== trasporto: BLE ==============================

import { onPacketBytes } from "../core/ingest.js";
import { S } from "../core/state.js";
import { startSession, stop, onStop, onSend } from "../core/session.js";
import { logFail, BLE_HINT } from "../core/diagnostics.js";
import { log } from "../ui/dom.js";

const NUS = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

let bleDevice = null, bleRx = null;

export async function connectBle() {
  if (!navigator.bluetooth) {
    log("Web Bluetooth non disponibile. Serve Chrome/Edge su desktop o Android, e un contesto sicuro: https oppure http://localhost.");
    return log("   → " + BLE_HINT.SecurityError);
  }
  try {
    bleDevice = await navigator.bluetooth.requestDevice({
      filters: [{ services: [NUS] }, { namePrefix: "MyoLink" }],
      optionalServices: [NUS],
    });
    const server = await bleDevice.gatt.connect();
    const svc = await server.getPrimaryService(NUS);
    const tx = await svc.getCharacteristic(NUS_TX);
    try { bleRx = await svc.getCharacteristic(NUS_RX); } catch { bleRx = null; }

    startSession("ble", "BLE — " + (bleDevice.name || "?"));
    bleDevice.addEventListener("gattserverdisconnected", () => { if (S.running) stop("device disconnesso"); });
    tx.addEventListener("characteristicvaluechanged", (ev) => {
      const dv = ev.target.value;
      onPacketBytes(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength));
    });
    await tx.startNotifications();
  } catch (e) { logFail("BLE", e, BLE_HINT); }
}

async function closeBle() {
  try { bleDevice?.gatt?.disconnect(); } catch {}
  bleDevice = bleRx = null;
}

async function sendBle(text) {
  if (!bleRx) return;
  try { await bleRx.writeValue(new TextEncoder().encode(text)); } catch (e) { log("write BLE: " + e.message); }
}

onStop(closeBle);
onSend("ble", sendBle);

// ============================== sessione ==============================
//
// I trasporti si registrano qui invece di essere importati: così le dipendenze
// vanno in una direzione sola (trasporto → sessione) e non si crea un ciclo fra
// stop() e le sue closeXxx().

import { S, resetStats } from "./state.js";
import { $, log } from "../ui/dom.js";

const closers = [];
export function onStop(fn) { closers.push(fn); }

const senders = new Map();
export function onSend(kind, fn) { senders.set(kind, fn); }

export function startSession(kind, label) {
  S.transport = kind; S.running = true;
  resetStats();
  $("dot").className = "dot on";
  $("status").lastChild.textContent = label;
  for (const id of ["btnSerial", "btnBle", "btnDemo"]) $(id).disabled = true;
  $("btnStop").disabled = false;
  log("connesso: " + label);
}

export async function stop(reason) {
  S.running = false;
  for (const close of closers) await close();
  S.transport = null;
  $("dot").className = "dot" + (reason && reason !== "manuale" ? " err" : "");
  $("status").lastChild.textContent = "disconnesso" + (reason ? " (" + reason + ")" : "");
  for (const id of ["btnSerial", "btnBle", "btnDemo"]) $(id).disabled = false;
  $("btnStop").disabled = true;
  log("disconnesso" + (reason ? " (" + reason + ")" : "") +
      (S.samples ? " — i dati letti restano in memoria" : ""));
}

export async function sendCommand(text) {
  const send = senders.get(S.transport);
  if (!send) return log("nessun device collegato");
  await send(text);
  log("-> " + text);
}

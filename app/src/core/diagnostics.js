// ============================== diagnostica dei permessi ==============================

import { log } from "../ui/dom.js";

// I fallimenti di getUserMedia() e requestDevice() arrivano come DOMException il
// cui `message`, in Chromium, è spesso vuoto o generico: l'informazione sta in
// `name`. Loggare solo il message rende un "non parte" da telefono indiagnosticabile.
export function errText(e) {
  const n = e?.name || "errore";
  return e?.message ? n + ": " + e.message : n;
}

// Da `name` a un'istruzione. Nessuno di questi casi è aggirabile da JavaScript:
// l'unica cosa utile che l'app può fare è dire dove guardare.
export const MIC_HINT = {
  NotAllowedError:
    "permesso negato. Guarda in quest'ordine: 1) il browser ha il microfono fra le autorizzazioni di sistema " +
    "(su Android: Impostazioni → App → il browser → Autorizzazioni); 2) il sito non è bloccato (lucchetto " +
    "nella barra indirizzi → Autorizzazioni). Se il prompt non compare proprio, di solito manca il permesso " +
    "di sistema — non quello del sito.",
  NotFoundError: "nessun ingresso audio: il sistema non espone microfoni.",
  NotReadableError: "microfono occupato da un'altra app, o non leggibile dal sistema.",
  OverconstrainedError: "il dispositivo non accetta i vincoli richiesti (mono, senza filtri vocali).",
  SecurityError: "contesto non sicuro: servono https oppure http://localhost.",
  AbortError: "acquisizione interrotta dal sistema.",
};

export const BLE_HINT = {
  NotFoundError: "nessun device scelto: hai chiuso il selettore, oppure nessun MyoLink era in vista.",
  SecurityError: "Web Bluetooth bloccato dal browser. Alcuni browser (Brave fra questi) lo tengono " +
    "disabilitato di default: cercalo nelle impostazioni, dev'essere attivato a mano.",
  NotAllowedError: "permesso negato. Su Android il browser può richiedere anche i Servizi di localizzazione " +
    "attivi per poter scansionare, e il permesso Bluetooth fra le autorizzazioni di sistema dell'app.",
  NetworkError: "connessione GATT fallita: il device si è allontanato, o è già connesso a qualcos'altro.",
};

export const SERIAL_HINT = {
  NotFoundError: "nessuna porta scelta: hai chiuso il selettore.",
  NetworkError: "porta non apribile: di solito è già aperta da un altro programma — il monitor seriale " +
    "dell'IDE Arduino è il sospetto numero uno.",
  InvalidStateError: "porta già aperta da questa pagina.",
  SecurityError: "contesto non sicuro: servono https oppure http://localhost.",
};

// ---- dove va a finire un errore ----
//
// Nel log ci va sempre: è la storia della sessione, e da lì si diagnostica un
// "non parte" raccontato al telefono. Ma il log, nel modo semplice, non c'è —
// e anche quando c'è sta in fondo alla pagina, lontano dal pulsante che ha
// appena fallito. Chi ha premuto "Sensore" e non è successo niente deve
// leggere il perché SOTTO quel pulsante, non a due schermate di distanza.
//
// Queste istruzioni erano già scritte bene (i tre dizionari qui sopra): l'unica
// cosa che mancava era una via per farle arrivare anche a chi le guarda.
let sink = null;
export function setFailSink(fn) { sink = fn; }

// Un fallimento senza eccezione: il permesso già negato, per esempio, non lancia
// niente — il prompt semplicemente non compare. È lo stesso evento per chi
// guarda, quindi passa dalla stessa porta.
export function segnala(what, msg, hint) { sink?.(what, msg, hint || ""); }

export function logFail(what, e, hints) {
  log(what + ": " + errText(e));
  const h = hints[e?.name];
  if (h) log("   → " + h);
  segnala(what, errText(e), h);
}

// Non tutti i browser espongono questo nome nella Permissions API; l'assenza non
// è un errore, è solo un'informazione che non abbiamo.
export async function micPermission() {
  try { return (await navigator.permissions.query({ name: "microphone" })).state; }
  catch { return null; }
}

// Un report di "non parte" parte già con i fatti: quali API ci sono e in che
// stato. Costa una riga di log e fa risparmiare un giro di domande.
export async function logEnvironment() {
  const yn = (b) => (b ? "sì" : "no");
  log(
    "ambiente: contesto sicuro " + yn(window.isSecureContext) +
    " · Web Serial " + yn("serial" in navigator) +
    " · Web Bluetooth " + yn(!!navigator.bluetooth) +
    " · getUserMedia " + yn(!!navigator.mediaDevices?.getUserMedia) +
    " · permesso microfono: " + ((await micPermission()) || "sconosciuto")
  );
}

// Accesso al DOM e log. Tenuto minimo e senza stato di modulo, così chi lo
// importa non si porta dietro dipendenze.

export function $(id) { return document.getElementById(id); }

// L'elemento si cerca alla prima chiamata, non al caricamento del modulo: così
// il resto del codice resta importabile anche senza DOM (i test girano in node).
let logEl;
export function log(msg) {
  if (logEl === undefined) logEl = typeof document === "undefined" ? null : $("log");
  if (!logEl) return;
  const t = new Date().toLocaleTimeString("it");
  logEl.textContent += (logEl.textContent ? "\n" : "") + t + "  " + msg;
  logEl.scrollTop = logEl.scrollHeight;
}

// Accesso al DOM e log. Tenuto minimo e senza stato di modulo, così chi lo
// importa non si porta dietro dipendenze.

export function $(id) { return document.getElementById(id); }

// Un'etichetta di pulsante in due lunghezze: su 390px il testo lungo manda la
// riga dei pulsanti a capo. Le due varianti stanno entrambe nel DOM e a scegliere
// è il CSS, così nessuno qui deve sapere quanto è largo lo schermo.
export function setLabel(el, long, short) {
  el.textContent = "";
  for (const [cls, txt] of [["lg", long], ["sm", short]]) {
    const s = document.createElement("span");
    s.className = cls;
    s.textContent = txt;
    el.appendChild(s);
  }
}

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

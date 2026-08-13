// ============================== pannelli ==============================
//
// Piega, apre il cassetto dei controlli, ridimensiona. L'altezza sta sul .body e
// il canvas la riempie; la LARGHEZZA non si tocca mai, è quella che tiene
// allineati gli assi dei tempi.

export function setupPanels() {
  for (const p of document.querySelectorAll(".panel")) {
    const body = p.querySelector(".body"), grip = p.querySelector(".grip");
    p.querySelector(".fold").onclick = () => p.classList.toggle("folded");

    // Il cassetto dei controlli: la classe la interpreta solo il CSS a schermo
    // stretto, dove i controlli sono nascosti. Su desktop sono sempre in barra e
    // il pulsante che chiama questo handler non è nemmeno visibile.
    const tools = p.querySelector(".tools");
    tools.onclick = () => tools.setAttribute("aria-expanded", p.classList.toggle("open"));

    grip.addEventListener("pointerdown", (e) => {
      grip.setPointerCapture(e.pointerId);
      const y0 = e.clientY, h0 = body.clientHeight;
      const move = (ev) => { body.style.height = Math.max(70, Math.min(1400, h0 + ev.clientY - y0)) + "px"; };
      // Col dito il puntatore può essere revocato dal sistema (una gesture, una
      // chiamata in arrivo): senza `pointercancel` il ridimensionamento
      // resterebbe attaccato al dito anche dopo che il dito non c'è più.
      const end = () => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", end);
        grip.removeEventListener("pointercancel", end);
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", end);
      grip.addEventListener("pointercancel", end);
      e.preventDefault();
    });
  }
}

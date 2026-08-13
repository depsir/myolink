// ============================== pannelli ==============================
//
// Piega e ridimensiona. L'altezza sta sul .body e il canvas la riempie; la
// LARGHEZZA non si tocca mai, è quella che tiene allineati gli assi dei tempi.

export function setupPanels() {
  for (const p of document.querySelectorAll(".panel")) {
    const body = p.querySelector(".body"), grip = p.querySelector(".grip");
    p.querySelector(".fold").onclick = () => p.classList.toggle("folded");
    grip.addEventListener("pointerdown", (e) => {
      grip.setPointerCapture(e.pointerId);
      const y0 = e.clientY, h0 = body.clientHeight;
      const move = (ev) => { body.style.height = Math.max(70, Math.min(1400, h0 + ev.clientY - y0)) + "px"; };
      const up = () => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
      e.preventDefault();
    });
  }
}

// ============================== stima del clock ==============================
//
// Il device manda micros() a 32 bit (wrappa ogni ~71.6 min) riferiti al suo
// cristallo; l'host ha performance.now(). Facciamo una regressione lineare
// host = a*device + b con dimenticanza esponenziale:
//   - 'a' misura lo skew fra i due cristalli (ppm)
//   - 'b' l'offset (include la latenza media di trasporto)
// Serve per far avanzare il cursore del grafico in tempo reale e per allineare
// i campioni al timestamp dell'audio.

export class ClockFit {
  constructor(forget = 0.999) { this.f = forget; this.reset(); }
  reset() {
    this.w = this.sx = this.sy = this.sxx = this.sxy = 0;
    this.x0 = null; this.y0 = 0;
    this.a = 1; this.b = 0;
    this.resid = 0; this.residVar = 0;
  }
  // xs = tempo device in secondi, ys = tempo host in secondi
  add(xs, ys) {
    if (this.x0 === null) { this.x0 = xs; this.y0 = ys; }
    const x = xs - this.x0, y = ys - this.y0;
    const f = this.f;
    this.w = this.w * f + 1;
    this.sx = this.sx * f + x; this.sy = this.sy * f + y;
    this.sxx = this.sxx * f + x * x; this.sxy = this.sxy * f + x * y;
    const den = this.w * this.sxx - this.sx * this.sx;
    if (this.w > 8 && den > 1e-12) {
      this.a = (this.w * this.sxy - this.sx * this.sy) / den;
      this.b = (this.sy - this.a * this.sx) / this.w;
    } else {
      this.a = 1; this.b = (this.sy - this.sx) / Math.max(1, this.w);
    }
    const r = y - (this.a * x + this.b);          // ritardo istantaneo residuo
    this.resid = r;
    this.residVar = this.residVar * 0.99 + r * r * 0.01;
  }
  hostToDevice(ys) {
    if (this.x0 === null) return 0;
    return (((ys - this.y0) - this.b) / this.a) + this.x0;
  }
  get skewPpm() { return (this.a - 1) * 1e6; }
  get jitterMs() { return Math.sqrt(this.residVar) * 1000; }
}

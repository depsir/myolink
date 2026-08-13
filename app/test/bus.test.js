import { beforeEach, describe, expect, it, vi } from "vitest";

// Web Audio finto: al bus interessano solo tre cose — che il contesto venga
// creato e chiuso, che la destinazione produca una traccia, e chi è collegato a
// chi. Nessuna di queste richiede un browser.
class FakeSource {
  constructor(stream) { this.stream = stream; this.to = null; this.off = 0; }
  connect(t) { this.to = t; }
  disconnect() { this.off++; this.to = null; }
}

class FakeCtx {
  constructor() {
    this.closed = false;
    this.resumed = 0;
    this.sources = [];
    // currentTime resta a 0 finché non parte: è così che il bus capisce se il
    // dispositivo audio sta davvero macinando campioni.
    this.currentTime = 0;
    FakeCtx.made.push(this);
  }
  resume() { this.resumed++; if (!FakeCtx.stuck) this.currentTime = 0.01; return Promise.resolve(); }
  close() { this.closed = true; }
  createMediaStreamSource(stream) {
    if (this.closed) throw new Error("contesto chiuso");
    const s = new FakeSource(stream);
    this.sources.push(s);
    return s;
  }
}
FakeCtx.made = [];

class FakeDst {
  constructor(ctx, opts) {
    this.ctx = ctx;
    this.opts = opts;
    // La traccia è UNA e sempre la stessa, come in un MediaStream vero: il bus
    // conta sul fatto che riaprirlo torni l'oggetto già in registrazione.
    const track = { kind: "audio", readyState: "live" };
    this.stream = { getAudioTracks: () => [track] };
    FakeDst.made.push(this);
  }
}
FakeDst.made = [];

// La sorgente di silenzio: senza qualcosa collegato, in Chrome la destinazione
// non produce campioni e la traccia esce senza dati.
class FakeConstant {
  constructor(ctx, opts) {
    this.ctx = ctx;
    this.opts = opts;
    this.to = null;
    this.started = 0;
    this.stopped = 0;
    FakeConstant.made.push(this);
  }
  connect(t) { this.to = t; }
  start() { this.started++; }
  stop() { this.stopped++; }
}
FakeConstant.made = [];

const micStream = (readyState = "live") => ({ getAudioTracks: () => [{ kind: "audio", readyState }] });

let bus;

beforeEach(async () => {
  FakeCtx.made = [];
  FakeDst.made = [];
  FakeConstant.made = [];
  FakeCtx.stuck = false;
  globalThis.AudioContext = FakeCtx;
  globalThis.MediaStreamAudioDestinationNode = FakeDst;
  globalThis.ConstantSourceNode = FakeConstant;
  // Lo stato del bus è di modulo: ogni test se lo ricarica pulito.
  vi.resetModules();
  bus = await import("../src/audio/bus.js");
});

const ctx = () => FakeCtx.made.at(-1);
const dstOf = (c) => c.sources.at(-1)?.to;

describe("openBus", () => {
  it("apre una traccia audio anche senza microfono: è quella che finisce nel file", async () => {
    const t = await bus.openBus();
    expect(t).toMatchObject({ kind: "audio" });
    expect(bus.busLive()).toBe(false);      // traccia sì, ma silenzio
    expect(ctx().resumed).toBe(1);          // un contesto sospeso non produce campioni
  });

  it("mono, perché il microfono lo è e l'AAC non deve codificarlo due volte", async () => {
    await bus.openBus();
    expect(FakeDst.made.length).toBe(1);
    expect(FakeDst.made[0].opts).toEqual({ channelCount: 1 });
    expect(FakeDst.made[0].ctx).toBe(ctx());
  });

  it("microfono già aperto: se lo aggancia da sé", async () => {
    const s = micStream();
    bus.micAttach(s);
    await bus.openBus();
    expect(bus.busLive()).toBe(true);
    expect(ctx().sources.at(-1).stream).toBe(s);
  });

  it("chiamata due volte torna la traccia che sta già registrando, non una nuova", async () => {
    const a = await bus.openBus();
    const b = await bus.openBus();
    expect(b).toBe(a);
    expect(FakeCtx.made.length).toBe(1);
  });

  it("senza Web Audio: null, e chi chiama registra un video muto", async () => {
    delete globalThis.AudioContext;
    expect(await bus.openBus()).toBe(null);
    expect(bus.busLive()).toBe(false);
  });

  // Il silenzio deve essere un segnale, non l'assenza di segnale: senza questa
  // sorgente la traccia esce priva di dati e Chrome la ribasa a zero.
  it("collega una sorgente muta e la avvia: il silenzio va prodotto, non sottinteso", async () => {
    await bus.openBus();
    expect(FakeConstant.made.length).toBe(1);
    const hum = FakeConstant.made[0];
    expect(hum.opts).toEqual({ offset: 0 });
    expect(hum.to).toBe(FakeDst.made[0]);
    expect(hum.started).toBe(1);
  });

  it("la sorgente muta si ferma con il bus, non prima", async () => {
    await bus.openBus();
    bus.micAttach(micStream());
    bus.micDetach();
    expect(FakeConstant.made[0].stopped).toBe(0);   // microfono via, silenzio no
    bus.closeBus();
    expect(FakeConstant.made[0].stopped).toBe(1);
  });

  it("senza ConstantSourceNode si registra comunque, invece di non registrare", async () => {
    delete globalThis.ConstantSourceNode;
    const t = await bus.openBus();
    expect(t).toMatchObject({ kind: "audio" });
    bus.micAttach(micStream());
    expect(bus.busLive()).toBe(true);
  });

  // Il punto della sincronia: se il recorder parte prima che il bus emetta,
  // Chrome ribasa l'audio a zero e il file esce con l'audio in anticipo.
  it("non torna finché il contesto non macina davvero: è quello che tiene la sincronia", async () => {
    FakeCtx.stuck = true;                       // il dispositivo audio non parte
    vi.useFakeTimers();
    try {
      let done = false;
      const p = bus.openBus().then((t) => { done = true; return t; });
      await vi.advanceTimersByTimeAsync(500);
      expect(done).toBe(false);                 // ancora sospeso: si aspetta
      ctx().currentTime = 0.01;                 // il dispositivo parte adesso
      await vi.advanceTimersByTimeAsync(100);
      expect(await p).toMatchObject({ kind: "audio" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("contesto che non parte mai: dopo il tetto si registra comunque, senza restare appesi", async () => {
    FakeCtx.stuck = true;
    vi.useFakeTimers();
    try {
      const p = bus.openBus();
      await vi.advanceTimersByTimeAsync(5000);
      expect(await p).toMatchObject({ kind: "audio" });   // meglio audio sfasato che nessun video
    } finally {
      vi.useRealTimers();
    }
  });

  it("costruzione fallita: niente contesto orfano lasciato aperto", async () => {
    globalThis.MediaStreamAudioDestinationNode = class { constructor() { throw new Error("nope"); } };
    expect(await bus.openBus()).toBe(null);
    expect(ctx().closed).toBe(true);
  });
});

describe("microfono acceso a registrazione avviata", () => {
  it("è il caso del bug: Registra e poi Microfono deve sentirsi", async () => {
    await bus.openBus();
    expect(bus.busLive()).toBe(false);
    const s = micStream();
    bus.micAttach(s);
    expect(bus.busLive()).toBe(true);
    expect(dstOf(ctx())).toBeInstanceOf(FakeDst);   // il microfono entra nel bus, non nell'aria
    expect(ctx().sources.at(-1).stream).toBe(s);
  });

  it("aperto e chiuso più volte: un solo nodo per volta, agganciato ogni volta", async () => {
    await bus.openBus();
    bus.micAttach(micStream());
    bus.micDetach();
    const s2 = micStream();
    bus.micAttach(s2);
    expect(bus.busLive()).toBe(true);
    expect(ctx().sources.length).toBe(2);
    expect(ctx().sources[0].off).toBe(1);
    expect(ctx().sources[1].stream).toBe(s2);
  });

  it("traccia già finita (dispositivo staccato): non si aggancia, e non finge di esserci", async () => {
    await bus.openBus();
    bus.micAttach(micStream("ended"));
    expect(bus.busLive()).toBe(false);
    expect(ctx().sources.length).toBe(0);
  });

  it("senza registrazione in corso il microfono si ricorda, ma non c'è nulla da agganciare", async () => {
    bus.micAttach(micStream());
    expect(bus.busLive()).toBe(false);
    expect(FakeCtx.made.length).toBe(0);           // il bus non apre contesti da solo
  });
});

describe("microfono spento a registrazione avviata", () => {
  it("torna silenzio: la traccia resta, il file non si tronca", async () => {
    const t = await bus.openBus();
    bus.micAttach(micStream());
    bus.micDetach();
    expect(bus.busLive()).toBe(false);
    expect(ctx().closed).toBe(false);
    expect(ctx().sources.at(-1).off).toBe(1);
    expect(await bus.openBus()).toBe(t);                 // la registrazione continua sulla stessa traccia
  });
});

describe("closeBus", () => {
  it("chiude il contesto e stacca il microfono dal grafo", async () => {
    await bus.openBus();
    bus.micAttach(micStream());
    const c = ctx();
    bus.closeBus();
    expect(c.closed).toBe(true);
    expect(bus.busLive()).toBe(false);
    expect(c.sources.at(-1).off).toBe(1);
  });

  it("il microfono resta aperto fra due registrazioni, e la seconda se lo ritrova", async () => {
    const s = micStream();
    bus.micAttach(s);
    await bus.openBus();
    bus.closeBus();

    await bus.openBus();                                 // seconda registrazione
    expect(FakeCtx.made.length).toBe(2);           // contesto nuovo, non quello chiuso
    expect(bus.busLive()).toBe(true);
    expect(ctx().sources.at(-1).stream).toBe(s);
  });

  it("chiamata a bus già chiuso: no-op, non un errore", async () => {
    bus.closeBus();
    expect(() => bus.closeBus()).not.toThrow();
    expect(FakeCtx.made.length).toBe(0);
  });
});

// ============================== banco di prova dei momenti ==============================
//
// Guida l'app vera in Chrome headless via CDP e controlla i momenti salienti da
// capo a fondo: iniezione di un brano finto negli store, il semaforo dal vivo,
// "Momenti", la revisione, la curatela, la striscia col nastro delle zone,
// l'intervallo registrato.
//
// Niente Playwright e niente Puppeteer: node ha `WebSocket` e `fetch` built-in, e
// Chrome si pilota con quelli. Uso:
//
//   node app/tools/bench-momenti.mjs            # tutto verde o elenco dei fallimenti
//   node app/tools/bench-momenti.mjs --keep     # lascia la schermata in /tmp
//
// Perché esiste: i test unitari coprono i numeri, ma quello che il coach vede è
// fatto di un colore e di una lista. Le promesse verificate qui sono
// sull'INTERFACCIA, e nessun test unitario può accorgersi se si rompono:
//
//  - il semaforo dal vivo dice la STESSA cosa che dice la misura (se divergessero,
//    il colore mentirebbe mentre si canta, che è il peggior modo di sbagliare);
//  - il numero è in lista accanto a ogni momento — la fase 6 esiste anche per
//    questo, e riportarlo dentro sarebbe una regressione invisibile;
//  - la curatela sopravvive a un ricalcolo;
//  - il nastro delle zone si disegna davvero.
//
// Trappole già pagate, da non ripagare: Chrome può partire prima di vite (si
// rinavvia sempre, invece di sperare), vite 8 ascolta su `localhost` e NON su
// 127.0.0.1 (il curl fallisce ma la pagina c'è), e un throw a metà lascerebbe
// Chrome vivo a rispondere col DOM vecchio al giro dopo — da cui il kill in
// `process.on("exit")`.

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";

const PORT = 5199, CDP = 9344;
const APP = dirname(dirname(new URL(import.meta.url).pathname));   // .../app
const OUT = mkdtempSync(join(tmpdir(), "myolink-momenti-"));
const kids = [];
process.on("exit", () => kids.forEach((k) => { try { k.kill("SIGKILL"); } catch {} }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.error("FAIL " + m); process.exitCode = 1; };
const ok = (m) => console.log("  ok  " + m);

const vite = spawn(APP + "/node_modules/.bin/vite", ["--port", String(PORT), "--strictPort"],
  { cwd: APP, stdio: "ignore" });
kids.push(vite);
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(`http://localhost:${PORT}/`); if (r.ok) break; } catch { await sleep(250); }
}

const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${OUT}/chrome`,
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
  "--autoplay-policy=no-user-gesture-required", "--window-size=1280,1100",
  // `--headless=new` nasconde la finestra, non l'audio: il test del riascolto
  // manda in riproduzione quello che ha appena registrato, e quello che ha
  // registrato sono i click a fondo scala del microfono finto di Chrome. Senza
  // questo flag il banco fa quattro beep dalle casse a ogni giro. Muta l'USCITA,
  // non la cattura: la riproduzione parte lo stesso e il cursore la segue, che è
  // quello che il test controlla.
  "--mute-audio",
  `http://localhost:${PORT}/`,
], { stdio: "ignore" });
kids.push(chrome);

let ws = null;
for (let i = 0; i < 80; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
    const page = list.find((t) => t.type === "page" && t.url.includes(String(PORT)));
    if (page?.webSocketDebuggerUrl) { ws = page.webSocketDebuggerUrl; break; }
  } catch {}
  await sleep(250);
}
if (!ws) { fail("nessun target CDP"); process.exit(1); }

const sock = new WebSocket(ws);
await new Promise((r) => (sock.onopen = r));
let id = 0;
const pend = new Map();
const errs = [];
sock.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") {
    errs.push(m.params.exceptionDetails?.exception?.description || JSON.stringify(m.params));
  }
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    errs.push("console: " + m.params.args.map((a) => a.value ?? a.description).join(" "));
  }
};
const send = (method, params = {}) => new Promise((r) => {
  const n = ++id; pend.set(n, r); sock.send(JSON.stringify({ id: n, method, params }));
});
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "throw");
  return r.result?.result?.value;
};
await send("Runtime.enable");
await send("Page.enable");
// Chrome può essere partito prima di vite: si ricarica sempre, invece di sperare.
await send("Page.navigate", { url: `http://localhost:${PORT}/` });
await sleep(2000);

const title = await ev("document.title");
if (!/MyoLink/i.test(title || "")) { fail("pagina sbagliata: " + title); process.exit(1); }
ok("pagina: " + title);

// ---- prima dei venti secondi: il semaforo dice quanto manca, non "—" ----
//
// Con poca storia lo zero sarebbe la frase cantata più piano, quindi non si
// risponde. Il rischio è che una pastiglia muta sembri un guasto: qui si
// controlla che dica invece quanto manca.
await ev(`(() => { const M = window.MyoLink;
  for (let i = 0; i < 12 * 100; i++) M.store.push(i / 100, 250 + 20 * Math.random());
  M.S.dtUs = 10000; })()`);
await sleep(1400);
const attesa = await ev(`({ txt: document.getElementById("fatica").textContent,
  zona: document.getElementById("fatica").dataset.zona, base: window.MyoLink.FT.base })`);
if (!/riposo…\s*\d+\s*s/.test(attesa.txt) || attesa.zona) {
  fail("con 12 s di storia il semaforo dovrebbe dire quanto manca: " + JSON.stringify(attesa));
} else ok(`prima dei 20 s il semaforo dice “${attesa.txt}” invece di un trattino muto`);
await ev(`window.MyoLink.store.clear()`);

// ---- iniezione di un brano finto negli store, come farebbe il trasporto ----
const inject = `(() => {
  const M = window.MyoLink, HZ = 200, SECS = 180, BASE = 250;
  let x = 7 >>> 0;
  const r = () => ((x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
  // Frasi da 4 s ogni 6, appoggio +12 (dentro il verde, come il canto normale sui
  // dati veri) e tre passaggi tirati a +60, lunghi più della finestra di lettura.
  // Gli ultimi secondi devono essere di pausa: è la coda che legge il semaforo.
  const tirati = [36.8, 90.8, 150.8];
  const sung = (t) => { const p = t % 6; return p > 0.6 && p < 4.6; };
  for (let i = 0; i < SECS * HZ; i++) {
    const t = i / HZ;
    let v = BASE + 4 * Math.sin(2 * Math.PI * t / 4) + 6 * (r() - 0.5) + 6 * (t / SECS);
    if (sung(t)) v += tirati.some((p) => t > p && t < p + 3.5) ? 60 : 12;
    M.store.push(t, v);
  }
  for (let i = 0; i < SECS * 50; i++) {
    const t = i / 50;
    M.pitch.push(t, sung(t) ? 60 + 3 * Math.sin(t) : 0, sung(t) ? 0.93 : 0.2);
  }
  M.S.dtUs = 5000;
  return { emg: M.store.n, pitch: M.pitch.n };
})()`;
console.log("inject:", JSON.stringify(await ev(inject)));

// ---- il semaforo dal vivo ----
//
// Legge la coda dello store, quindi ha bisogno che sia passato il secondo con cui
// si aggiorna lo zero. La promessa è che il colore in barra e il numero della
// misura siano LA STESSA COSA: se divergessero, il semaforo mentirebbe mentre si
// canta, che è il modo peggiore di sbagliare.
await sleep(1500);
const sem = await ev(`({
  txt: document.getElementById("fatica").textContent,
  zona: document.getElementById("fatica").dataset.zona,
  FT: window.MyoLink.FT,
  stat: [...document.querySelectorAll("#stats .stat")].map(d => d.textContent).find(t => /fatica/.test(t)),
})`);
console.log(JSON.stringify(sem));
if (!sem.zona) fail("il semaforo non si è acceso: " + JSON.stringify(sem));
else ok(`semaforo: “${sem.txt}” (zero della sessione ${sem.FT.base.toFixed(0)} count)`);
if (!sem.txt.includes(sem.zona)) fail("il colore non è accompagnato dalla parola: " + sem.txt);
else ok("il colore non è mai solo: c'è anche la parola");
// L'ultimo campione cade in una pausa fra due frasi: il semaforo dev'essere verde.
if (sem.zona !== "verde") fail("in pausa il semaforo dovrebbe essere verde, è " + sem.zona);
else ok("in pausa il semaforo è verde");
if (Math.abs(sem.FT.base - 250) > 4) fail("lo zero trovato da solo è " + sem.FT.base);
else ok(`lo zero se l'è trovato da solo, senza calibrazione: ${sem.FT.base.toFixed(1)} (vero 250)`);
if (!/fatica/.test(sem.stat || "")) fail("la riga “fatica” manca dalle statistiche");
else ok("statistiche: " + sem.stat);

// ---- "Momenti" ----
await ev(`document.getElementById("btnMarks").click()`);
await sleep(400);
const st = await ev(`({
  hidden: document.getElementById("pMarks").hidden,
  n: window.MyoLink.marks.length,
  info: document.getElementById("mkInfo").textContent,
  righe: document.querySelectorAll("#mkList .mk").length,
  zone: window.MyoLink.marks.map(m => m.zona),
  val: window.MyoLink.marks.map(m => Math.round(m.val)),
  numeri: [...document.querySelectorAll("#mkList .mkV")].map(e => e.textContent),
  tempi: window.MyoLink.marks.map(m => Math.round(m.t)),
  log: document.getElementById("log").textContent.split("\\n").filter(l => /moment|riposo|zone/.test(l)),
})`);
console.log(JSON.stringify(st, null, 1));
if (st.hidden) fail("il pannello dei momenti è rimasto nascosto");
else ok("pannello visibile");
// Tre passaggi tirati iniettati, tre momenti: nessun punto di riempimento, che
// era il difetto della 5b (venti comunque, qualunque cosa ci fosse).
if (st.n !== 3) fail("attesi i 3 passaggi tirati, trovati " + st.n + ": " + JSON.stringify(st.tempi));
else ok("3 momenti, uno per passaggio tirato: " + st.tempi.join(", ") + " s");
if (st.righe !== st.n) fail("righe in lista: " + st.righe);
else ok(st.righe + " righe in lista");
if (!st.zone.every((z) => z === "rosso")) fail("zone attese tutte rosse: " + st.zone.join(","));
else ok("tutti e tre in zona rossa: " + st.val.map((v) => "+" + v).join(" "));
// Il numero A SCHERMO, che è la decisione ribaltata della fase 6b: la 5b lo
// calcolava e lo nascondeva di proposito.
if (!st.numeri.length || !st.numeri.every((t) => /^\+\d+$/.test(t))) {
  fail("il numero non è in lista: " + JSON.stringify(st.numeri));
} else ok("il numero è accanto a ogni momento: " + st.numeri.join(" "));
if (!st.log.some((l) => /zone: verde/.test(l))) fail("il referto non dice il tempo in zona: " + st.log.join(" | "));
else ok("referto: " + st.log.find((l) => /zone: verde/.test(l)).trim());

// ---- revisione: clic su una riga, poi n/p ----
await ev(`document.querySelectorAll("#mkList .mk")[1].click()`);
await sleep(200);
const rev = await ev(`({
  info: document.getElementById("mkInfo").textContent,
  live: document.getElementById("mkLive").hidden,
  sel: document.querySelectorAll("#mkList .mk.sel").length,
})`);
if (!/revisione/.test(rev.info) || rev.live) fail("il cursore di revisione non si è acceso: " + JSON.stringify(rev));
else ok("revisione attiva: " + rev.info);
if (rev.sel !== 1) fail("righe selezionate: " + rev.sel); else ok("una riga selezionata");

const t1 = await ev(`document.getElementById("mkInfo").textContent`);
await ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }))`);
await sleep(200);
const t2 = await ev(`document.getElementById("mkInfo").textContent`);
if (t1 === t2) fail("il tasto n non ha spostato la selezione");
else ok(`n: ${t1.split("·").pop().trim()} → ${t2.split("·").pop().trim()}`);
await ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }))`);
await sleep(200);
const t3 = await ev(`document.getElementById("mkInfo").textContent`);
if (t3 !== t1) fail("p non è tornato indietro: " + t3); else ok("p torna al punto prima");

// ---- curatela ----
await ev(`document.querySelectorAll("#mkList .mk")[0].querySelector(".mkDrop").click()`);
await ev(`document.querySelectorAll("#mkList .mk")[1].querySelector(".mkKeep").click()`);
await sleep(200);
const cur = await ev(`({
  drop: document.querySelectorAll("#mkList .mk.drop").length,
  keep: document.querySelectorAll("#mkList .mk.keep").length,
  info: document.getElementById("mkInfo").textContent,
})`);
if (cur.drop !== 1 || cur.keep !== 1) fail("curatela: " + JSON.stringify(cur));
else ok("tieni/scarta: " + cur.info);
// e sopravvive a un ricalcolo: la chiave di un momento è il suo tempo, e
// l'analisi produce oggetti nuovi ogni volta.
await ev(`document.getElementById("btnMarks").click()`);
await sleep(400);
const cur2 = await ev(`({ drop: document.querySelectorAll("#mkList .mk.drop").length,
  keep: document.querySelectorAll("#mkList .mk.keep").length })`);
if (cur2.drop !== 1 || cur2.keep !== 1) fail("la curatela non è sopravvissuta al ricalcolo: " + JSON.stringify(cur2));
else ok("la curatela sopravvive al ricalcolo");

// ---- clic sulla striscia: naviga anche fuori dai punti ----
await ev(`(() => { const c = document.getElementById("strip"), b = c.getBoundingClientRect();
  c.dispatchEvent(new MouseEvent("click", { clientX: b.left + b.width * 0.72, clientY: b.top + 10, bubbles: true })); })()`);
await sleep(200);
const strip = await ev(`document.getElementById("mkInfo").textContent`);
if (!/revisione/.test(strip)) fail("il clic sulla striscia non ha spostato il cursore");
else ok("clic sulla striscia: " + strip.split("·").pop().trim());

// ---- la striscia disegna davvero qualcosa ----
const painted = await ev(`(() => {
  const c = document.getElementById("strip");
  const cx = c.getContext("2d");
  const d = cx.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
  return { w: c.width, h: c.height, pixel: n };
})()`);
if (painted.pixel < 2000) fail("la striscia è quasi vuota: " + JSON.stringify(painted));
else ok(`striscia disegnata: ${painted.pixel} pixel su ${painted.w}×${painted.h}`);

// ---- il nastro delle zone: la fatica srotolata su tutta la registrazione ----
//
// È la risposta a "come è andata" in un colpo d'occhio, e ha preso il posto delle
// tre corsie della 5b. Si controlla contando i pixel rossi e verdi nella riga del
// nastro: se il rosso sparisse, il nastro direbbe che è andato tutto bene.
const ribbon = await ev(`(() => {
  const c = document.getElementById("strip"), cx = c.getContext("2d");
  // La riga del nastro sta sotto l'inviluppo e sopra le tacche dei minuti: si
  // guarda una fascia larga invece di indovinare una riga, così il controllo
  // regge un cambio di altezza della striscia o di dpr.
  const d = cx.getImageData(0, Math.round(c.height * 0.7), c.width, Math.round(c.height * 0.2)).data;
  let rosso = 0, verde = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 180 && d[i + 1] < 120) rosso++;
    else if (d[i + 1] > 60 && d[i] < 90) verde++;
  }
  return { rosso, verde };
})()`);
if (!(ribbon.rosso > 3 && ribbon.verde > 50)) fail("il nastro delle zone non c'è: " + JSON.stringify(ribbon));
else ok(`nastro delle zone: ${ribbon.verde} colonne verdi e ${ribbon.rosso} rosse`);

// ---- "dal vivo" ----
await ev(`document.getElementById("mkLive").click()`);
await sleep(200);
const live = await ev(`({ info: document.getElementById("mkInfo").textContent,
  live: document.getElementById("mkLive").hidden })`);
if (/revisione/.test(live.info) || !live.live) fail("dal vivo non ha spento la revisione");
else ok("“dal vivo” torna a seguire l'adesso");

// ---- il nastro dell'audio: riascoltare senza aver registrato ----
await ev(`document.getElementById("btnAudio").click()`);
// getUserMedia in headless può volerci più di 2.5 s: si aspetta con un polling.
let mic = false;
for (let i = 0; i < 40; i++) {
  if (await ev(`window.MyoLink.A.on`)) { mic = true; break; }
  await sleep(250);
}
if (!mic) fail("il microfono finto non si è aperto"); else ok("microfono aperto");
await sleep(2500);                       // qualche blocco di nastro
const tape = await ev(`(() => { const s = window.MyoLink.TP.tape?.span();
  return s ? { t0: s.t0, t1: s.t1, rate: window.MyoLink.TP.tape.rate } : null; })()`);
if (!tape || tape.t1 - tape.t0 < 1) fail("il nastro non ha registrato niente: " + JSON.stringify(tape));
else ok(`nastro: ${(tape.t1 - tape.t0).toFixed(1)} s a ${tape.rate / 1000} kHz`);

// Il cursore si mette DENTRO il nastro cliccando la striscia, che è il percorso vero.
await ev(`(() => {
  const M = window.MyoLink, s = M.TP.tape.span();
  const c = document.getElementById("strip"), b = c.getBoundingClientRect();
  const PAD = M.PAD, gw = b.width - PAD.l - PAD.r;
  // La striscia copre l'intervallo analizzato: la frazione si ricava da quello.
  const t = s.t0 + 0.4;
  const f = (t - M.marksRange.t0) / (M.marksRange.t1 - M.marksRange.t0);
  c.dispatchEvent(new MouseEvent("click", { clientX: b.left + PAD.l + f * gw, clientY: b.top + 10, bubbles: true }));
})()`);
await sleep(200);
const canPlay = await ev(`!document.getElementById("mkPlay").disabled`);
if (!canPlay) fail("il pulsante ascolta è disabilitato col nastro pieno");
else ok("pulsante ascolta attivo");

await ev(`document.getElementById("mkPlay").click()`);
await sleep(300);
const p1 = await ev(`({ playing: window.MyoLink.TP.playing, t: window.MyoLink.reviewT,
  label: document.getElementById("mkPlay").textContent })`);
if (!p1.playing) fail("la riproduzione non è partita");
else ok("riproduzione partita da " + (p1.t ?? 0).toFixed(2) + " s, pulsante: " + p1.label.trim());
await sleep(900);
const p2 = await ev(`({ playing: window.MyoLink.TP.playing, t: window.MyoLink.reviewT })`);
const adv = (p2.t ?? 0) - (p1.t ?? 0);
if (!(adv > 0.5 && adv < 1.5)) fail(`il cursore non segue l'audio: avanzato di ${adv}`);
else ok(`il cursore segue l'audio: +${adv.toFixed(2)} s in 0.9 s (i tre pannelli scorrono con lui)`);
// Durante il riascolto la cattura non deve scrivere negli store.
const grew = await ev(`(() => { const n = window.MyoLink.pitch.n;
  return new Promise(r => setTimeout(() => r(window.MyoLink.pitch.n - n), 500)); })()`);
if (grew !== 0) fail("mentre si riascolta il pitch continua a scrivere: " + grew + " stime");
else ok("mentre si riascolta la cattura non scrive negli store");

await ev(`document.getElementById("mkPlay").click()`);
await sleep(200);
const p3 = await ev(`({ playing: window.MyoLink.TP.playing,
  label: document.getElementById("mkPlay").textContent,
  info: document.getElementById("mkInfo").textContent })`);
if (p3.playing) fail("la riproduzione non si è fermata");
else ok("stop: " + p3.label.trim() + " · " + p3.info.split("·").pop().trim());

// ---- l'intervallo: quando c'è una registrazione si guarda SOLO quella ----
await ev(`(() => { const M = window.MyoLink;
  M.R.t0 = M.T.epochMs + 30000; M.R.t1 = M.T.epochMs + 120000; })()`);
await ev(`document.getElementById("btnMarks").click()`);
await sleep(400);
const rng = await ev(`({
  log: document.getElementById("log").textContent.split(String.fromCharCode(10)).slice(-6).join(" | "),
  fuori: window.MyoLink.marks.filter(m => m.t < 29.5 || m.t > 120.5).length,
  n: window.MyoLink.marks.length,
  primo: document.querySelectorAll("#mkList .mk b")[0]?.textContent,
})`);
if (!/momenti: registrazione — 1:30/.test(rng.log)) fail("l'intervallo della registrazione non è quello: " + rng.log);
else ok("analizzata solo la registrazione (1:30)");
if (rng.fuori) fail(rng.fuori + " punti fuori dall'intervallo registrato");
else ok(`tutti i ${rng.n} punti dentro la registrazione`);
if (!/^0:/.test(rng.primo || "")) fail("i tempi in lista non partono dall'inizio del video: " + rng.primo);
else ok("i tempi in lista sono relativi all'inizio del video (" + rng.primo + ")");

// ---- Stop NON scarica: il file resta in memoria e lo scarica un pulsante ----
await ev(`document.getElementById("btnRec").click()`);
await sleep(3000);
await ev(`document.getElementById("btnRec").click()`);
await sleep(1200);
const rec = await ev(`({
  blob: !!window.MyoLink.R.blob,
  size: window.MyoLink.R.blob?.size || 0,
  btn: !document.getElementById("btnSave").hidden,
  label: document.getElementById("btnSave").textContent,
  log: document.getElementById("log").textContent.split(String.fromCharCode(10)).slice(-4).join(" | "),
})`);
if (!rec.blob || !rec.btn) fail("dopo lo stop non c'è il file in memoria col suo pulsante: " + JSON.stringify(rec));
else ok(`Stop tiene il file (${(rec.size / 1e6).toFixed(1)} MB) e mostra “${rec.label.trim()}”`);
if (!/registrazione pronta/.test(rec.log)) fail("il log non dice che è pronta: " + rec.log);
else ok("il log spiega che si analizza e si salva a parte");

// ---- e i DATI della registrazione, che è la domanda vera: "questo CSV è del video?" ----
//
// Lo stop congela i campioni dell'INTERVALLO registrato, non tutta la memoria.
// Qui in memoria ci sono 180 s di brano finto e la registrazione dura 3 s: se il
// taglio non ci fosse, le righe sarebbero cinquanta volte tante. Si controllano i
// due bordi leggendo il blob davvero, perché è quello che finisce sul disco.
const dati = await ev(`(async () => {
  const { R, T, store } = window.MyoLink;
  const g0 = T.fromHost(R.t0), g1 = T.fromHost(R.t1);
  const emg = R.data.find((f) => f.name.endsWith(".csv") && !f.name.endsWith(".pitch.csv"));
  const rows = emg ? (await emg.blob.text()).trim().split(String.fromCharCode(10)) : [];
  const ts = rows.slice(1).map((r) => +r.split(",")[0]);
  return {
    file: R.data.map((f) => f.name), n: R.data.map((f) => f.n), video: R.name,
    testata: rows[0], righe: ts.length, memoria: store.n,
    durata: +(g1 - g0).toFixed(2),
    fuori: ts.filter((t) => t < g0 - 1e-9 || t > g1 + 1e-9).length,
    coperto: ts.length ? +(ts[ts.length - 1] - ts[0]).toFixed(2) : 0,
  };
})()`);
console.log(JSON.stringify(dati, null, 1));
if (dati.file.length !== 2) fail("attesi due CSV (EMG e pitch), trovati: " + JSON.stringify(dati.file));
else ok(`la registrazione porta i suoi dati: ${dati.n[0].toLocaleString("it")} campioni + ${dati.n[1]} stime di pitch`);
const base = dati.video.replace(/\.\w+$/, "");
if (!dati.file.every((f) => f.startsWith(base + "."))) fail("nomi non condivisi: " + dati.video + " vs " + dati.file.join(", "));
else ok("video e CSV hanno lo stesso nome: " + base + ".{mp4,csv,pitch.csv}");
if (dati.testata !== "t_s,valore") fail("intestazione del CSV: " + dati.testata);
if (dati.fuori) fail(dati.fuori + " righe fuori dall'intervallo registrato");
else ok(`nessuna riga fuori dall'intervallo (${dati.durata} s)`);
// A 200 Hz tre secondi sono ~600 righe; la memoria ne ha 36.000. Il margine è
// larghissimo di proposito: qui si verifica che il taglio ci sia, non il conteggio.
if (dati.righe < 100 || dati.righe > dati.memoria / 5) {
  fail(`righe sospette: ${dati.righe} su ${dati.memoria} in memoria`);
} else ok(`tagliato sul video: ${dati.righe} righe su ${dati.memoria} in memoria`);
if (dati.coperto < dati.durata - 0.5) fail(`i dati coprono solo ${dati.coperto} s dei ${dati.durata} registrati`);
else ok(`i dati coprono la registrazione intera (${dati.coperto} s)`);

// ---- schermata ----
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(OUT + "/marks.png", Buffer.from(shot.result.data, "base64"));
ok("schermata in " + OUT + "/marks.png");

if (errs.length) { fail("eccezioni in pagina:\n   " + errs.join("\n   ")); }
else ok("nessuna eccezione");
console.log(process.exitCode ? "\n=== CI SONO FALLIMENTI ===" : "\n=== tutto verde ===");
process.exit(process.exitCode || 0);

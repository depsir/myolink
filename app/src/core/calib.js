// ============================== calibrazione ==============================
//
// Il count ADC del MyoWare non ha unità. Dipende da impedenza cutanea, posizione
// degli elettrodi, guadagno e tessuto: `> 800` significa cose diverse su due
// persone, e su due sessioni della stessa persona. Qui si misurano gli estremi
// una volta, e da lì in avanti il segnale si legge NORMALIZZATO — che è la sola
// forma in cui una soglia si possa configurare, riusare e confrontare.
//
// **Il sensore sta sull'addome laterale** (obliquo esterno), cioè su un muscolo
// del *sostegno del fiato*, non della tensione laringea. Tre conseguenze che si
// vedono tutte nel codice qui sotto:
//
//  1. Il massimo anatomico (MVC: flessione del tronco contro resistenza) è
//     scomodo e poco ripetibile. Al suo posto un massimo FUNZIONALE — la "sgh"
//     sostenuta fino a svuotarsi — che sta già nel gesto del cantante ed è
//     ripetibile. Per questo si misura il plateau su tre prove e si prende la
//     mediana, non il massimo assoluto di una volta.
//  2. Il riposo NON è piatto: la parete addominale ha il ciclo respiratorio
//     dentro. La base è quindi una MEDIANA (una contrazione involontaria a metà
//     misura non deve spostare lo zero) e il rumore si misura sulle DIFFERENZE
//     fra campioni consecutivi, non sui valori — vedi noiseSigma: il respiro è
//     segnale, e una σ che se lo mangia gonfia tutte le soglie costruite su di
//     essa.
//  3. Il denominatore utile non è il massimo ma il RIFERIMENTO, cioè il livello
//     di appoggio di una frase comoda: "il 180% del tuo appoggio normale" vuol
//     dire qualcosa, "il 25% di un'espirazione massimale" no. Si tengono
//     entrambi perché rispondono a due domande diverse e costano lo stesso.
//
// Il quarto blocco, gli accenti "HA!", non serve a normalizzare: serve a
// misurare la FORMA di un'attivazione volontaria e pulita — quanto sale, quanto
// dura. È il riferimento contro cui la fase 5b potrà dire che un'altra
// attivazione non è pulita, invece di usare numeri assoluti presi da un paper.
//
// Questo modulo non tocca il DOM e non importa niente: è tutto misurabile dai
// test, che è l'unico modo di accorgersi di una statistica sbagliata. Un
// percentile storto qui non si vede — si propaga.

// ---- il protocollo ----
//
// Sta qui e non nella UI perché l'analisi dipende da queste durate e da queste
// ripetizioni: separarle vorrebbe dire poterle cambiare in un posto solo.

export const BLOCKS = [
  {
    key: "rest", label: "Riposo", secs: 10, reps: 1,
    hint: "Comodo, respira tranquillo: non parlare, non muoverti, non tenere " +
          "la pancia. Dieci secondi di niente SONO il dato — da qui escono la " +
          "linea di base e il rumore.",
  },
  {
    key: "max", label: "Massimo TENUTO — \"sssh\" continua, 4 s", secs: 4, reps: 3,
    hint: 'Espira tutto sulla "sssh" forzando in modo CONTINUO per tutti e quattro ' +
          "i secondi, fino a svuotarti. Non un colpo: un tenuto — il colpo secco " +
          "va nel blocco dopo. Tre prove con una pausa in mezzo: si tiene la " +
          "mediana, così una prova venuta male non decide la scala.",
  },
  {
    key: "ha", label: 'Accenti SECCHI — "SH!" (o "HA!")', secs: 10, reps: 1,
    hint: 'Cinque colpi staccati, con una pausa netta fra uno e l\'altro. Qui ' +
          "serve l'opposto: che partano e finiscano di colpo. Da qui escono la " +
          "forma di un'attivazione pulita e il tetto ISTANTANEO, che è più alto " +
          "del tenuto — un colpo balistico arriva più su di quanto si riesca a " +
          "tenere.",
  },
  {
    key: "rif", label: "Riferimento", secs: 8, reps: 1,
    hint: "Canta una frase comoda a mezzo volume, come la canteresti " +
          "normalmente. È il livello con cui si confronta tutto il resto.",
  },
];

export const HA_ATTESI = 5;             // quanti accenti chiede il blocco "ha"
// Quantizzazione 1 count, e l'ADC dell'ESP32-S3 ne aggiunge un paio di suo:
// sotto questa soglia il rumore misurato è plausibilmente quello del convertitore
// e non quello del sensore, e allora alzare il guadagno serve davvero.
const ADC_NOISE_COUNTS = 8;
export const ADC_FULL = 4095;           // ADC a 12 bit dell'ESP32
// La finestra su cui si LEGGE un'attivazione. 300 ms e non 200 per una ragione
// misurata su una registrazione vera: vedi movMedian.
export const ACT_WIN = 0.3;

// ---- statistiche robuste ----

export function median(a) {
  if (!a.length) return NaN;
  const s = Float64Array.from(a).sort();
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

// Interpolato fra i due campioni adiacenti: su un blocco da 80 campioni il
// percentile "al campione più vicino" salta di più dell'1% per volta.
export function quantile(a, q) {
  if (!a.length) return NaN;
  const s = Float64Array.from(a).sort();
  const i = (s.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

// Rumore a breve termine: la MAD delle differenze fra campioni consecutivi,
// riscalata come σ di una gaussiana e divisa per √2, perché la differenza di due
// campioni indipendenti ha varianza doppia.
//
// Sulle DIFFERENZE e non sui valori, e non è un dettaglio: misurata sui valori,
// la σ del riposo si mangia sia l'ondulazione respiratoria — che sull'addome è
// segnale, non rumore — sia una eventuale deriva del contatto. La seconda è il
// caso brutto: la deriva gonfia la σ abbastanza da NASCONDERE SE STESSA, e il
// controllo "il gel non ha fatto contatto" non scatta più. Trovato dai test, non
// ragionandoci: il blocco di riposo con 80 count di deriva passava per pulito.
//
// Sulle differenze resta invece robusta a quello che deve: un artefatto isolato
// produce due differenze enormi su centinaia, e la mediana non le vede.
export const MAD_SIGMA = 1.4826;
export function noiseSigma(a) {
  if (a.length < 2) return NaN;
  const d = new Float64Array(a.length - 1);
  for (let i = 1; i < a.length; i++) d[i - 1] = Math.abs(a[i] - a[i - 1]);
  return MAD_SIGMA * median(d) / Math.SQRT2;
}

// Media mobile a finestra TEMPORALE, non a numero di campioni: un pacchetto
// perso lascia un buco, e una finestra a indici lo conterebbe come tempo.
// Escono solo le finestre PIENE — le prime, parziali, direbbero un livello più
// basso del vero e finirebbero dentro il percentile abbassandolo.
export function movingMean(ts, vs, winS) {
  const out = [];
  let lo = 0, sum = 0;
  for (let i = 0; i < vs.length; i++) {
    sum += vs[i];
    while (ts[i] - ts[lo] > winS) { sum -= vs[lo]; lo++; }
    if (ts[i] - ts[0] >= winS) out.push(sum / (i - lo + 1));
  }
  return out;
}

// Livello di un blocco: percentile `q` delle medie mobili a `winS`.
//
// Con q = 0.9 è il PLATEAU di una contrazione massimale. Il massimo assoluto
// sarebbe un artefatto (un campione), la media secca lo sottostima perché
// include la salita e la discesa.
//
// Con q = 0.5 e un pavimento è il livello tipico di una frase cantata:
// l'inspirazione e il silenzio prima dell'attacco stanno sotto il pavimento e
// non entrano nella mediana, che altrimenti tirerebbero giù di molto.
export function level(ts, vs, { winS = 1, q = 0.9, floor = -Infinity } = {}) {
  if (!vs.length) return NaN;
  // Blocco più corto della finestra: nessuna media mobile è piena, e il
  // percentile dei campioni grezzi è meglio di un NaN.
  let m = movingMean(ts, vs, winS);
  if (!m.length) m = Array.from(vs);
  const keep = m.filter((x) => x > floor);
  return quantile(keep.length ? keep : m, q);
}

// Medie su finestre NON sovrapposte. Serve per stimare il rumore del LIVELLO, e
// le finestre devono essere disgiunte: due medie mobili adiacenti condividono
// tutti i campioni tranne uno, quindi la loro differenza vale (v[i]−v[i−N])/N e
// una σ stimata su quelle sarebbe sbagliata di √N — cioè di 6 volte a 200 Hz.
export function blockMeans(ts, vs, winS) {
  const out = [];
  let t0 = ts[0], sum = 0, n = 0;
  for (let i = 0; i < vs.length; i++) {
    if (ts[i] - t0 >= winS) { if (n) out.push(sum / n); t0 = ts[i]; sum = 0; n = 0; }
    sum += vs[i]; n++;
  }
  if (n) out.push(sum / n);
  return out;
}

// Mediana mobile a finestra temporale.
//
// I livelli si leggono su una MEDIANA e non su una media, e la differenza è
// grossa: misurata su 30 s di riposo vero a 200 Hz, la σ della lettura a 300 ms
// scende da 4.73 a 1.92 count, cioè 2.5 volte. Il motivo è che il disturbo del
// riposo non è rumore bianco ma **bozzi stretti** — una decina di ms l'uno — e
// una media li spalma sulla finestra mentre una mediana li butta via. Con la
// media, allargare la finestra non serviva a niente: a 300 ms la σ della media
// era addirittura PEGGIO che per campione.
//
// Il livello di un tenuto invece passa intatto (+46 count grezzo, +46 filtrato):
// la mediana toglie i bozzi, non il piano. Ed è per questo che gli accenti si
// cercano sempre sui campioni grezzi, dove la loro forma è integra — un colpo
// dura 130-240 ms, cioè quanto la finestra, e filtrarlo lo dimezzerebbe.
export function movMedian(ts, vs, winS) {
  const out = [], win = [];      // `win` ordinato, per prendere la mediana in O(1)
  let lo = 0;
  const put = (x) => { const i = bisect(win, x); win.splice(i, 0, x); };
  const drop = (x) => { const i = bisect(win, x); if (win[i - 1] === x) win.splice(i - 1, 1); };
  for (let i = 0; i < vs.length; i++) {
    put(vs[i]);
    while (ts[i] - ts[lo] > winS) drop(vs[lo++]);
    const h = win.length >> 1;
    out.push(win.length % 2 ? win[h] : (win[h - 1] + win[h]) / 2);
  }
  return out;
}
function bisect(a, x) {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= x) lo = m + 1; else hi = m; }
  return lo;
}

// Rumore del LIVELLO: la σ robusta delle medie su finestre disgiunte.
//
// È questa e non `noiseSigma` la grandezza con cui confrontare un'attivazione, e
// la distinzione l'ha fatta emergere una sessione vera. `noiseSigma` misura
// quanto è DENTELLATA la traccia; una soglia però non si mette mai su un singolo
// campione, si mette sulla media a 200 ms — che quel dentellìo lo media via.
// Con un inviluppo oscillante i due numeri differiscono di un fattore grosso, il
// denominatore dell'SNR risultava enormemente sovrastimato, e il grafico
// mostrava differenze evidenti mentre l'SNR diceva 2.
//
// Resta cieca alla deriva, che era il motivo per cui si guardano le differenze:
// qui si guardano le differenze fra medie consecutive.
export function levelSigma(ts, vs, winS = ACT_WIN) {
  // Sulla stessa grandezza su cui si mettono le soglie, filtro compreso: misurare
  // il rumore su una media e poi leggere su una mediana vorrebbe dire tarare le
  // soglie con il σ di un'altra quantità.
  const b = blockMeans(ts, movMedian(ts, vs, winS), winS);
  return b.length > 2 ? noiseSigma(b) : noiseSigma(vs);
}

export function restStats(ts, vs) {
  const base = median(vs);
  // Due rumori, e servono a due cose diverse: `noise` è per campione e regola le
  // soglie di rilevamento degli accenti, che lavorano sui campioni grezzi;
  // `noiseLvl` è il rumore di una lettura a 200 ms e regola l'SNR e i margini,
  // che sono domande sui livelli.
  const noise = noiseSigma(vs);
  const noiseLvl = levelSigma(ts, vs);
  // Deriva: mediana della seconda metà meno quella della prima. Un gel che non
  // ha ancora fatto contatto si vede esattamente così. Mediane e non medie,
  // perché un movimento in mezzo non deve diventare "deriva".
  const h = vs.length >> 1;
  const drift = h ? median(vs.slice(h)) - median(vs.slice(0, h)) : 0;
  return { base, noise, noiseLvl, drift, n: vs.length,
           span: vs.length ? ts[vs.length - 1] - ts[0] : 0 };
}

// ---- la forma di un'attivazione pulita ----
//
// Isteresi: si entra al 35% dell'ampiezza del blocco e si esce al 18%. Con una
// soglia sola, il rumore sul fronte di discesa spezzerebbe un accento in tre.
// Il pavimento a 4σ serve al caso in cui nel blocco non si è fatto niente:
// senza, l'ampiezza sarebbe rumore e uscirebbero "accenti" dal nulla.
const HA_IN = 0.35, HA_OUT = 0.18, HA_MIN_S = 0.04;

export function bursts(ts, vs, { base, noise }) {
  const amp = quantile(vs, 0.999) - base;
  const thrIn = Math.max(base + HA_IN * amp, base + 4 * noise);
  const thrOut = Math.max(base + HA_OUT * amp, base + 2 * noise);
  const out = [];
  for (let i = 0; i < vs.length; i++) {
    if (vs[i] < thrIn) continue;
    // L'inizio vero è dove ha superato la soglia BASSA, non quella di scatto:
    // altrimenti la salita si misurerebbe da metà fronte, cioè più corta.
    let k0 = i;
    while (k0 > 0 && vs[k0 - 1] >= thrOut) k0--;
    let k = i, kPk = i;
    while (k < vs.length && vs[k] >= thrOut) { if (vs[k] > vs[kPk]) kPk = k; k++; }
    const durata = ts[Math.min(k, vs.length - 1)] - ts[k0];
    if (durata >= HA_MIN_S) {
      out.push({ t: ts[k0], picco: vs[kPk], salita: ts[kPk] - ts[k0], durata });
    }
    i = k;                        // il prossimo accento comincia dopo la discesa
  }
  return out;
}

export function burstShape(list) {
  if (!list.length) return null;
  return {
    n: list.length,
    picco: median(list.map((b) => b.picco)),
    salita: median(list.map((b) => b.salita)),
    durata: median(list.map((b) => b.durata)),
  };
}

// ---- assemblaggio ----
//
// `blocks` è { key: [{ts, vs}, ...] }: una voce per ripetizione, sempre un
// array anche dove reps è 1, così rifare una singola prova è sostituire un
// elemento e non un caso a parte.

export function buildCal(blocks, { hz = 0, t = 0, adcFull = ADC_FULL } = {}) {
  const rest = blocks.rest?.[0];
  const ha = blocks.ha?.[0];
  const rif = blocks.rif?.[0];
  const maxes = (blocks.max || []).map((b) => level(b.ts, b.vs, { winS: 1, q: 0.9 }));
  // La stessa registrazione letta con una finestra corta. Serve a distinguere un
  // TENUTO da un COLPO, che è l'errore per cui questo blocco fallisce in modo
  // incomprensibile: su un plateau le due finestre dicono quasi lo stesso, su un
  // colpo da 200 ms la finestra da 1 s lo diluisce di cinque volte e il
  // "massimo" scende vicino al rumore. Senza questo confronto il sintomo è "il
  // riferimento è più alto del massimo", che non dice cosa hai sbagliato.
  const spikes = (blocks.max || []).map((b) => level(b.ts, b.vs, { winS: 0.2, q: 0.95 }));
  if (!rest?.vs.length || !rif?.vs.length || !maxes.length) return { ready: false };

  const r = restStats(rest.ts, rest.vs);
  const cal = {
    t, hz, adcFull,
    base: r.base, noise: r.noise, noiseLvl: r.noiseLvl, drift: r.drift, restSpan: r.span,
    max: median(maxes),
    maxShort: median(spikes),
    prove: maxes,
    // Il pavimento a 3σ è quello che rende questo numero il livello di APPOGGIO
    // e non "la media del blocco, respiri compresi".
    rif: level(rif.ts, rif.vs, { winS: 0.5, q: 0.5, floor: r.base + 3 * r.noise }),
    burst: ha ? burstShape(bursts(ha.ts, ha.vs, r)) : null,
    // Il tetto BALISTICO. Su una registrazione vera stava 17.5 volte sopra il
    // tenuto (+808 count contro +46), e SNR 420 contro 24: è lui a rispondere
    // alla domanda "il sensore vede questo muscolo?". Il tenuto resta il
    // denominatore di %max, perché è il massimo *sostenibile* ed è quello che ha
    // senso confrontare con una frase cantata, che è sostenuta.
    peak: NaN,
    clipped: countClipped(blocks, adcFull),
  };
  // Tre livelli invece di due, e la differenza è di sostanza.
  //
  // `measured`: i quattro blocchi c'erano, quindi i numeri esistono e il verdetto
  //   può dire QUALE non torna.
  // `ready`: il RIPOSO è buono, cioè base e rumore sono misurati. Basta questo per
  //   leggere il segnale: "quanto è alta questa attivazione rispetto al tuo riposo"
  //   non ha bisogno di nessun tetto.
  // `hasMax` / `hasRif`: quei due denominatori stanno abbastanza sopra il riposo
  //   da valere come scala.
  //
  // Prima `ready` pretendeva tutti e tre, e sulla prima persona vera questo
  // spegneva tutto per una ragione che non è un difetto: l'appoggio di una frase
  // CANTATA comoda, sull'obliquo esterno, sta pochi count sopra il riposo. È
  // un'informazione sul canto, non un montaggio sbagliato, e non deve impedire
  // di leggere il segnale.
  cal.peak = cal.burst ? cal.burst.picco : NaN;
  cal.measured = true;
  cal.bursty = cal.maxShort - cal.base >
               Math.max(5 * cal.noise, 1.8 * Math.max(0, cal.max - cal.base));
  // I margini si misurano in σ del LIVELLO: la domanda è se quel livello si
  // distingue dal riposo, non se un singolo campione lo fa.
  cal.ready = [cal.base, cal.noise, cal.noiseLvl].every(isFinite) && cal.noiseLvl > 0;
  cal.hasMax = cal.ready && cal.max - cal.base > MIN_MAX_SIGMA * cal.noiseLvl;
  cal.hasRif = cal.ready && cal.rif - cal.base > MIN_RIF_SIGMA * cal.noiseLvl;
  return cal;
}

// Il massimo funzionale sta molto sopra il riposo per costruzione; il
// riferimento, che è un appoggio leggero, può stare legittimamente vicino, e
// chiedergli 5σ boccerebbe calibrazioni buone.
const MIN_MAX_SIGMA = 5, MIN_RIF_SIGMA = 3;

// Il fondo scala si controlla su TUTTI i blocchi e non solo sul massimo: un
// accento può tagliare anche dove la "sgh" sostenuta non arriva.
function countClipped(blocks, adcFull) {
  let n = 0;
  for (const list of Object.values(blocks || {})) {
    for (const b of list || []) {
      for (let i = 0; i < b.vs.length; i++) if (b.vs[i] >= adcFull - 1) n++;
    }
  }
  return n;
}

// Una riga per blocco, da mostrare accanto al blocco stesso mentre la procedura
// è aperta. È la risposta a "quale dei quattro è quello strano": con i numeri
// solo nel referto finale, un blocco venuto male si scopre alla fine e non si sa
// quale rifare.
//
// `rest` serve a due dei quattro (gli accenti e il riferimento si misurano
// rispetto al riposo) e può non esserci ancora: in quel caso quelli tacciono
// invece di stampare numeri senza riferimento.
export function blockSummary(key, segs, rest = null) {
  if (!segs?.length) return "";
  const n0 = (x) => (isFinite(x) ? x.toFixed(0) : "—");
  if (key === "rest") {
    const r = restStats(segs[0].ts, segs[0].vs);
    return `riposo ${n0(r.base)} ±${r.noise.toFixed(1)}`;
  }
  if (key === "max") {
    return "tenuto " + segs.map((b) => n0(level(b.ts, b.vs, { winS: 1, q: 0.9 }))).join(" / ");
  }
  if (key === "ha") {
    if (!rest) return "";
    const sh = burstShape(bursts(segs[0].ts, segs[0].vs, rest));
    return sh
      ? `${sh.n} accent${sh.n === 1 ? "o" : "i"} · picco ${n0(sh.picco)}` +
        ` · salita ${(sh.salita * 1000).toFixed(0)} ms`
      : "nessun accento riconosciuto";
  }
  if (key === "rif") {
    const floor = rest ? rest.base + 3 * rest.noise : -Infinity;
    return "appoggio " + n0(level(segs[0].ts, segs[0].vs, { winS: 0.5, q: 0.5, floor }));
  }
  return "";
}

// ---- lettura del segnale ----

// Il tetto più alto dei due, che è quello che dice se il sensore sente il muscolo.
export const ceiling = (cal) => (isFinite(cal.peak) ? Math.max(cal.peak, cal.max) : cal.max);
export const snr = (cal) => (ceiling(cal) - cal.base) / (cal.noiseLvl || 1e-9);

// Quanta parte del disturbo SOPRAVVIVE al filtro. Vicino a 1 (o sopra) vuol dire
// che è troppo lento perché una mediana a 300 ms lo tolga: è il contatto che vaga
// o un riferimento incerto, e quello non lo aggiusta né il guadagno né la
// finestra. Sostituisce un confronto con √N che non è più valido — la riduzione
// di una MEDIANA non è quella di una media, quindi √N sarebbe il riferimento
// sbagliato.
export const slowness = (cal) => (cal.noiseLvl || 0) / (cal.noise || 1e-9);

// `unit`: "rif" = multipli dell'appoggio di riferimento (1 = il tuo normale),
// "max" = frazione del massimo funzionale (1 = il tetto). Clampato a 0 in basso
// perché sotto il riposo non c'è "attivazione negativa": c'è rumore.
export function norm(v, cal = CAL, unit = "rif") {
  if (!cal?.ready) return NaN;
  // "sigma" c'è sempre appena il riposo è misurato, ed è l'unica scala che non
  // chiede nessun gesto: quante σ del riposo sopra il riposo.
  if (unit === "sigma") return Math.max(0, (v - cal.base) / cal.noiseLvl);
  if (unit === "rif" && !cal.hasRif) return NaN;
  if (unit === "max" && !cal.hasMax) return NaN;
  const den = (unit === "max" ? cal.max : unit === "peak" ? cal.peak : cal.rif) - cal.base;
  return den > 0 ? Math.max(0, (v - cal.base) / den) : NaN;
}

// La lettura corrente: MEDIANA degli ultimi `winS` secondi, non media — per la
// stessa ragione per cui `levelSigma` filtra con la mediana. Il valore istantaneo
// balla troppo per essere letto, e una media si porta dentro i bozzi.
export function medianSince(ring, winS) {
  if (!ring.n) return NaN;
  const a = [];
  for (let k = ring.firstAtOrAfter(ring.tLast() - winS); k < ring.n; k++) a.push(ring.v[ring.idx(k)]);
  return a.length ? median(a) : NaN;
}

// Estrae una finestra dal ring in array semplici: quello che le funzioni qui
// sopra sanno leggere, e quello che i test sanno costruire a mano.
export function sliceRing(ring, tFrom, tTo) {
  const ts = [], vs = [];
  for (let k = ring.firstAtOrAfter(tFrom); k < ring.n; k++) {
    const i = ring.idx(k);
    if (ring.t[i] > tTo) break;
    ts.push(ring.t[i]); vs.push(ring.v[i]);
  }
  return { ts, vs };
}

// ---- il verdetto ----
//
// È il prodotto vero della calibrazione: risponde a "come sta reagendo il
// sensore su QUESTA persona", che è la domanda per cui esiste tutta la fase.
// Emesso insieme ai numeri, non dedotto dopo guardandoli.

export function verdict(cal = CAL, { hzNow = 0 } = {}) {
  if (!cal?.measured) {
    return [{ level: "bad", msg: "calibrazione incompleta: mancano dei blocchi." }];
  }
  const out = [];
  const s = snr(cal);
  const esc = ceiling(cal) - cal.base;          // headroom: il piu' alto dei due tetti
  const escT = cal.max - cal.base;              // il tenuto, che e' la parte utile al canto
  if (s < 10) {
    out.push({ level: "bad", msg:
      `SNR ${s.toFixed(0)}: fra riposo e massimo non c'è abbastanza segnale. ` +
      "Elettrodi mal posizionati, o storti rispetto alle fibre dell'obliquo " +
      "esterno — che sono diagonali, verso il basso e l'avanti." });
  } else if (s < 20) {
    out.push({ level: "warn", msg: `SNR ${s.toFixed(0)}: si lavora, ma un montaggio buono sta sopra 20.` });
  } else {
    out.push({ level: "ok", msg: `SNR ${s.toFixed(0)}: il sensore distingue bene la contrazione dal rumore.` });
  }

  // Il tenuto è la parte che serve al canto, che è sostenuto: se sta in pochi
  // count mentre in cima c'è ancora spazio, il guadagno è basso.
  //
  // Ma la promessa "così l'SNR sale" vale SOLO se il rumore misurato è vicino al
  // pavimento del convertitore: alzando il guadagno crescono insieme segnale e
  // rumore del sensore, e solo la quantizzazione (1 count) e il rumore dell'ADC
  // restano dov'erano. Sopra quel pavimento il guadagno compra risoluzione e non
  // rapporto, e il limite è altrove — elettrodi, contatto, riferimento.
  if (escT > 0 && escT < 0.05 * cal.adcFull && esc < 0.5 * cal.adcFull) {
    const floorish = cal.noise < ADC_NOISE_COUNTS;
    out.push({ level: "warn", msg:
      `il tenuto sta in ${escT.toFixed(0)} count, il ${(100 * escT / cal.adcFull).toFixed(1)}% ` +
      `della scala, e in cima ce n'è ancora (il picco arriva al ${(100 * esc / cal.adcFull).toFixed(0)}%): ` +
      (floorish
        ? "se il trimmer del guadagno non è al massimo, alzalo — l'SNR sale con lui, " +
          "perché il rumore misurato è vicino al pavimento del convertitore, che non " +
          "cresce col segnale. Se è già al massimo, il resto lo fa la posizione degli " +
          "elettrodi, e un tenuto piccolo può anche essere semplicemente com'è."
        : "alzare il guadagno recupera risoluzione ma probabilmente non SNR — il rumore " +
          "misurato sta molto sopra il pavimento del convertitore, quindi cresce col " +
          "segnale e il limite è a monte: elettrodi, contatto, riferimento.") });
  }
  // Due tetti molto diversi non sono un errore: un colpo balistico arriva dove un
  // tenuto non arriva. Va detto però che %max, costruito sul tenuto, è una scala
  // debole quando il tenuto è debole.
  if (cal.hasMax && isFinite(cal.peak) && cal.peak - cal.base > 6 * Math.max(1, escT)) {
    out.push({ level: "warn", msg:
      `l'accento arriva ${((cal.peak - cal.base) / Math.max(1, escT)).toFixed(0)} volte più su ` +
      "del tenuto: normale per un gesto balistico, ma vuol dire che %max — che si " +
      "costruisce sul tenuto — è una scala debole. Usa " +
      (cal.hasRif ? "×rif." : "σ del riposo, che non dipende da nessun tetto.") });
  }
  // Il disturbo che il filtro non riesce a togliere è l'unico che conta davvero.
  if (slowness(cal) > 0.8) {
    out.push({ level: "warn", msg:
      `il disturbo del riposo è troppo lento perché la mediana lo tolga ` +
      `(±${cal.noiseLvl.toFixed(1)} sulla lettura contro ±${cal.noise.toFixed(1)} per ` +
      "campione): è il contatto che vaga o un riferimento incerto. Non lo aggiusta " +
      "né il guadagno né allargare la finestra — controlla l'elettrodo di riferimento." });
  }

  if (cal.bursty) {
    out.push({ level: "bad", msg:
      "il blocco del massimo contiene un COLPO, non un tenuto: a finestra corta " +
      `misura ${(cal.maxShort - cal.base).toFixed(0)} count sopra il riposo, a ` +
      `finestra da 1 s solo ${Math.max(0, cal.max - cal.base).toFixed(0)}. Rifallo ` +
      "forzando in modo continuo per tutti e quattro i secondi — il colpo secco " +
      "serve, ma nel blocco degli accenti." });
  }
  if (!cal.ready) {
    out.push({ level: "bad", msg:
      "il blocco del riposo non dà una base e un rumore utilizzabili: senza quelli " +
      "non si legge niente, ed è il primo da rifare." });
  }
  // Un denominatore debole NON è un errore, e chiamarlo tale era il difetto: dire
  // "massimo o riferimento" senza dire quale, e spegnere tutto per entrambi. Un
  // tenuto volontario sull'obliquo può essere piccolo, e l'appoggio di una frase
  // comoda lo è quasi sempre.
  const need = (x, k) => `${(x - cal.base).toFixed(0)} count sopra il riposo ` +
                         `(ne servono ${(k * cal.noiseLvl).toFixed(0)})`;
  if (cal.ready && !cal.hasMax) {
    out.push({ level: "warn", msg:
      `il tenuto sta ${need(cal.max, MIN_MAX_SIGMA)}: la scala %max resta spenta. ` +
      "Non è un difetto del sensore — una contrazione volontaria tenuta sull'obliquo " +
      "può essere davvero piccola." });
  }
  if (cal.ready && !cal.hasRif) {
    out.push({ level: "warn", msg:
      `l'appoggio della frase cantata sta ${need(cal.rif, MIN_RIF_SIGMA)}: la scala ×rif ` +
      "resta spenta. Sull'addome il canto comodo attiva poco, ed è un'informazione " +
      "sul canto, non un errore di misura." });
  }
  if (cal.clipped) {
    out.push({ level: "bad", msg:
      `${cal.clipped} campioni a fondo scala: guadagno troppo alto. I picchi ` +
      "sono tagliati, quindi il massimo è sottostimato e con lui tutte le soglie." });
  }
  if (Math.abs(cal.drift) > 3 * cal.noise) {
    out.push({ level: "warn", msg:
      `la linea di riposo è scivolata di ${cal.drift.toFixed(0)} count in ` +
      `${cal.restSpan.toFixed(0)} s: il gel non ha ancora fatto contatto. Rifai il riposo fra un minuto.` });
  }
  if (cal.base > 0.4 * cal.adcFull) {
    out.push({ level: "warn", msg:
      `riposo a ${cal.base.toFixed(0)} su ${cal.adcFull} di fondo scala: contatto scadente o offset saturo.` });
  }
  // Le tre prove del massimo devono concordare: se non concordano, la mediana
  // le nasconde ed è proprio il caso in cui va detto invece di nascosto.
  const lo = Math.min(...cal.prove), hi = Math.max(...cal.prove);
  if (cal.prove.length > 1 && hi - cal.base > 1.5 * (lo - cal.base)) {
    out.push({ level: "warn", msg:
      `le tre prove del massimo non concordano (${cal.prove.map((v) => v.toFixed(0)).join(" / ")}): ` +
      "la mediana tiene, ma il tetto è incerto." });
  }
  if (cal.hasMax && cal.hasRif && cal.rif >= cal.max) {
    out.push({ level: "warn", msg:
      `il riferimento (${cal.rif.toFixed(0)}) è più alto del tenuto (${cal.max.toFixed(0)}): ` +
      "il massimo non era massimale, e la scala %max non vuol dire niente. ×rif resta valida." });
  }
  // I livelli sono percentili di valori e non dipendono dalla cadenza; la forma
  // dell'accento sì, perché salita e durata si misurano in campioni.
  if (hzNow && cal.hz && Math.abs(hzNow - cal.hz) / cal.hz > 0.1) {
    out.push({ level: "warn", msg:
      `calibrata a ${cal.hz.toFixed(0)} Hz, ora si campiona a ${hzNow.toFixed(0)}: i livelli ` +
      "restano validi, la forma dell'accento no — rifai il blocco degli accenti." });
  }
  if (!cal.burst || cal.burst.n < 3) {
    out.push({ level: "warn", msg:
      `accenti riconosciuti: ${cal.burst?.n || 0} su ${HA_ATTESI}. La forma di ` +
      "riferimento è debole: rifai il blocco con accenti più staccati." });
  }
  return out;
}

const RANK = { ok: 0, warn: 1, bad: 2 };
export const worst = (v) => v.reduce((a, x) => (RANK[x.level] > RANK[a] ? x.level : a), "ok");

// ---- persistenza ----
//
// La calibrazione muore quando si spostano gli elettrodi, cioè a ogni sessione.
// Si salva comunque — riaprire la pagina non deve costare dieci minuti — ma
// TIMBRATA, e l'età si dice ogni volta invece di lasciarla scoprire.

// v3: `noiseLvl` ora si misura sulla mediana e non sulla media, e c'è `peak`.
// L'SNR di una calibrazione più vecchia starebbe su un'altra scala: meglio
// rifarla che leggerla male.
export const CAL_KEY = "myolink.cal.v3";
export const CAL_STALE_H = 4;

export const calAgeH = (cal, nowMs) => (nowMs - (cal?.t || 0)) / 3.6e6;

export function parseCal(text) {
  try {
    const o = JSON.parse(text);
    return o && o.ready && isFinite(o.base) && isFinite(o.noiseLvl) ? o : null;
  } catch { return null; }
}

// `let` e non `const`: la calibrazione si sostituisce in blocco, e in un modulo
// ES il binding esportato è vivo — chi legge `CAL` vede sempre quella corrente
// (la stessa ragione per cui draw/canvas.js esporta le misure con `let`).
export let CAL = { ready: false };
export function useCal(c) { CAL = c && c.ready ? c : { ready: false }; return CAL; }

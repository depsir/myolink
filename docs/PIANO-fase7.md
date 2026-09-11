# Fase 7 — Due modi, due fasi

> Piano nuovo, scritto l'**11 settembre 2026**, dopo la fase 6, e **fatto lo
> stesso giorno**. `docs/PIANO.md` e `docs/PIANO-fase6.md` restano com'erano:
> questo non li supera, ci si appoggia. La 6 ha risolto **cosa misurare**; questa
> risolve **come si guarda**.

**Il prototipo navigabile è il riferimento di disegno**, e va aperto prima di
leggere il resto:
<https://claude.ai/code/artifact/c07b0b07-1ec3-47d7-98fd-3842cdb93ae8>

Gira su tre assi indipendenti (ingressi × fase × modo) e disegna **dati veri**,
estratti da `docs/samples/myolink-20260904-162656.csv` con gli stessi moduli
dell'app. Non è un mockup di forme: i numeri che mostra sono i numeri di quella
presa.

---

## Da cosa è nato

L'app era arrivata a **29 pulsanti, 21 campi, 24 tessere di statistiche**, tutti
visibili al primo caricamento, e nessuno che dicesse quale fosse il passo
successivo. Il committente ha chiesto una modalità semplice usabile da un non
tecnico, anche da telefono, tenendo tutto quello che c'è dietro un interruttore.

Il difetto vero però non era la quantità. È emerso dalla sua frase più utile:

> «non si capisce perché quando abilito il simulatore e o il microfono vedo cose e
> poi quando registro cosa registra e se stoppo il microfono cosa fa, e se stoppo
> la registrazione se continuo a vedere il live, insomma non si capisce e non si
> capisce poi dove vanno a finire le cose registrate, se le ho scaricate o no»

Sono cinque domande, e sono una per **flag indipendente**: `S.running` (il link),
`A.on` (il microfono), `R.on` (la registrazione), `MK.cursor` (la revisione).
Quattro interruttori che nessuno schermo dichiara, e nessuna relazione scritta fra
loro. La UI non era troppo densa: era **senza modello**.

---

## Il modello

Tre regole, e sono quelle che il prototipo dimostra.

**1. Gli ingressi sono uno stato permanente; la registrazione è un'azione sopra di
essi.** È la soluzione di OBS, di un multitraccia, dell'app fotocamera. A schermo:
due interruttori — *Sensore* e *Microfono* — e accanto il comando. Nessuna
etichetta di stato: la dice l'interruttore. Il testo torna solo per ciò che
l'interruttore non sa dire («sto collegando…», un errore).

**2. Se registri, registri tutto quello che è acceso.** Non c'è niente da
scegliere, e le tre caselle «cosa va nel video» spariscono dal modo semplice.
Mentre registra, **ogni ingresso incluso porta il suo pallino rosso**: è il
*record-enable* dei multitraccia, e risponde a «cosa registra» nel posto dove
nasce il dubbio.

**3. Fermare non è tornare indietro: è cambiare compito.** Qui c'era un errore
mio, dichiarato e corretto a metà strada. Avevo sostenuto che «il vivo non è una
modalità» e che registrare *aggiunge* senza cambiare schermata — vero *mentre*
registri, falso appena fermi. Da lì in poi non stai più guardando te stesso, stai
guardando una registrazione, e tenere le due cose insieme produce esattamente ciò
che il committente segnalava: *Registra* in alto e *Salva/Elimina* in basso, due
set di comandi che si contendono lo schermo, e i grafici che scorrono mentre provi
a leggere una presa ferma.

Quindi **due fasi, non cinque stati**:

| fase | cosa si vede | il comando |
|---|---|---|
| **dal vivo** | ingressi, riquadro, grafici che scorrono | *Registra* |
| **registrando** | identico, più il tempo e i pallini rossi | *Ferma* |
| **la presa** | tutto fermo sulla registrazione: la scheda sale in cima, la striscia è la navigazione, i grafici portano i tempi della presa | *← Torna al vivo* |

*Registra* **non esiste** mentre guardi una presa; *Salva/Elimina* non esistono
dal vivo. Non si sovrappongono più perché non convivono. E «registra di nuovo»
smette di essere un caso a sé: per rifarlo torni al vivo, ed è lì che l'app chiede
se salvare quella che stai per perdere.

---

## Le decisioni di disegno, e perché

**Un solo colore saturo a riposo: il semaforo.** Oggi due pulsanti blu si
contendono l'attenzione con lui. Quando tutto è colorato, niente lo è.

**La parola dice il significato, non il colore.** Non «Verde» / «Rosso» —
ripetere il colore è inutile, come ha osservato il committente — ma *Sforzo
normale* / *Stai spingendo* / *Stai spingendo troppo*. Toglierla del tutto
avrebbe lasciato il colore da solo, che è la combinazione peggiore per chi i rossi
dai verdi non li distingue (vedi 6f); così invece la parola porta informazione
**e** fa da ridondanza.

**Il meter al posto della barra cumulata.** La prima stesura metteva sotto il
numero il tempo passato per zona. Il committente l'ha letta come un indicatore che
oscilla, e quella lettura è più utile: **nel riquadro dal vivo vanno cose dal
vivo**, e il riassunto (tempo per zona, media e mediana) va nella scheda della
presa e fra le misure avanzate, dove un riassunto ha senso.

**Le spiegazioni stanno dietro una `i`,** non sotto ogni titolo. Con **una
eccezione che non va nascosta**: nei primi venti secondi il semaforo non può
rispondere («sto misurando il tuo riposo, mancano 17 s»). Dietro la `i`, uno
schermo muto sembra rotto.

**«Bluetooth» o «col cavo», non «BLE» o «seriale».** La domanda si pone una volta
sola e solo se il browser può fare tutti e due; sul telefono Web Serial non esiste
e non si chiede niente. Oggi invece *Collega seriale* è il primo pulsante, è blu, e
su Android il primo tocco di un non tecnico è quello sbagliato.

**Un pannello senza la sua sorgente non c'è.** La regola iniziale («l'impaginazione
non balla») è stata corretta dal committente e aveva ragione lui: se sei *tu* a
spegnere l'interruttore, il pannello vuoto è spazio morto, non chiarezza. Col solo
microfono restano la nota e basta — via anche il riquadro dello sforzo.

**I grafici restano separati.** Provata una versione a due corsie in una cornice
sola: «sono troppo diversi, si fa casino». Resta però aperta, e vale la pena
provarla sul campo, la **nota colorata**: una traccia sola, la nota tinta di quanto
ti sta costando.

### La nota colorata e il ritardo — la domanda tecnica che ne è uscita

> «ho paura che se coloriamo la nota poi sembra che si perda il momento giusto»

Il timore è fondato ma il problema è **asimmetrico**, e questo è il risultato che
vale la pena tenere scritto. Lo sforzo a `t` descrive `[t−2s, t]`, e l'app **già
oggi lo attribuisce al centro della finestra** (`ts[i] − WIN/2` dentro `tratti()`,
`core/fatica.js`). Quindi:

- **in riascolto il colore è esatto e gratuito**: la presa è finita, il valore
  centrato su ogni nota esiste già;
- **dal vivo quel secondo non c'è ancora**: colorare la nota che si sta cantando
  adesso significherebbe darle un colore non ancora misurato.

La soluzione è dire la verità: **dal vivo si colora fino a un secondo fa, e
l'ultimo secondo resta neutro**, con una fascia grigia che lo marca. È lo stesso
accorgimento che la linea della fatica usa già (6f). Nel prototipo si vede
confrontando *vivo · rosso* con *la presa*.

**Lo sforzo medio è ambiguo e restano entrambi.** Sulla presa del 4 settembre la
media è **+12** e la mediana **+4**: la differenza sono tutti quei 5,4 secondi di
rosso. Uno solo in vista dal vivo vorrebbe dire scegliere per l'utente quale dei
due significati conti; stanno tutti e due fra le misure avanzate.

---

## Il gap: cosa c'è già, e cosa manca davvero

Questa è la parte che cambia l'ordine dei lavori. **La metà del prototipo esiste
già nel codice e non è mai stata mostrata.**

### C'è, e va solo portato a schermo

| cosa | dove | stato |
|---|---|---|
| il tempo per zona | `tempiInZona()`, `core/fatica.js:197` | calcolato, **mostrato a nessuno** |
| la presa come oggetto | `R.blob / R.name / R.secs / R.data`, `record/recorder.js:46` | c'è tutto, anche i CSV congelati allo stop |
| «perdi la presa non salvata» | `record/recorder.js:84` | **è già una riga di log**: va promossa a domanda |
| la navigazione del riascolto | `MK.cursor`, `reviewT()`, `goto()`, `step()`, `toggleListen()`, `onStripClick()` in `ui/marks.js` | **completa**: manca solo che diventi una fase |
| serie, tratti, zone, colori | `core/fatica.js` | tutto pronto per riquadro e grafici |
| pannelli che spariscono senza rompere niente | `draw/canvas.js:38`, `record/layout.js:24` | un pannello nascosto misura 0 e viene saltato per costruzione |

### Mancava del tutto (adesso c'è)

1. **La fase.** Non esiste: `S.running`, `A.on`, `R.on` e `MK.cursor` sono quattro
   flag scollegati. Serve uno stato di fase esplicito a cui comandi e pannelli si
   agganciano — ed è la radice di tutte e cinque le domande del committente.
2. **La scala della fatica nel grafico.** `draw/chart.js` disegna 0–1000 count
   assoluti; serve l'asse «sopra il riposo» con le fasce come fondo. Sui dati veri
   la grandezza che conta è ±80 su un fondo scala di 1000: l'8% dell'altezza.
3. **Il flag «salvata».** `saveRecording()` scarica e non registra che è successo.
4. **Semplice/avanzato.** Nessun interruttore, nessuna memoria della scelta.
5. **Gli ingressi come due interruttori**, con la scelta cavo/Bluetooth chiesta una
   volta sola.

---

## Le fasi di lavoro — tutte fatte

Ognuna è verificabile da sola in hot reload, e nessuna toglie niente al modo
avanzato. L'ordine ha messo per prime la 7a e la 7c–7e, che sono il modello di
stato: tutto il resto è vestizione.

| | fase | cosa | dove |
|---|---|---|---|
| **7a** | **La fase come stato** | Un modulo che possiede `fase = vivo \| registrando \| presa`, derivata da ciò che già esiste, e a cui si agganciano comandi e pannelli tramite `body[data-fase]`. Niente DOM dentro: chi vuole vederla si iscrive. | `app/src/core/fase.js` |
| **7b** | **L'interruttore semplice/avanzato** | `body[data-modo]`, ricordato in `localStorage`. Il semplice è il default. | `app/src/ui/modo.js` |
| **7c** | **Gli ingressi** | Due interruttori al posto di sei pulsanti; la scelta Bluetooth/cavo chiesta una volta sola e ricordata (e **scordata da sé se quella via fallisce**, così nessuno resta chiuso fuori da una scelta di ieri); i trasporti che il browser non ha non compaiono; gli errori di `core/diagnostics.js` sotto il comando che li ha causati. Simulatore e Calibra sono in avanzato. | `app/src/ui/rack.js`, `core/diagnostics.js` |
| **7d** | **Il riquadro** | Parola di significato, numero, nota, indicatore. In riascolto legge il **valore sotto il cursore**, non l'ultimo arrivato. Il messaggio d'attesa dei primi venti secondi è fuori dalla `i`. | `app/src/ui/riquadro.js` |
| **7e** | **La fase «la presa»** | La scheda con salvata/non salvata, la striscia come navigazione, i grafici fermi coi tempi della presa, *Torna al vivo* con la domanda. Riusa `ui/marks.js` quasi per intero: l'analisi parte da sé allo stop. | `app/src/ui/marks.js`, `record/recorder.js` |
| **7f** | **Il grafico in scala di fatica** | Zero = riposo, fondo scala +90, le tre zone come campitura, la sola linea dello sforzo. L'asse dei tempi porta due parole (`−5 s` / `adesso`) invece di sette numeri negativi. | `app/src/draw/chart.js` |
| **7g** | **Mobile** | Griglia esplicita per gli ingressi (due interruttori e la `i` sulla prima riga, il comando di fase sulla seconda), altezze in `svh`, via la nota «ruota il telefono». Verificato a 390×844 con l'emulazione: documento largo 390, nessuno scorrimento orizzontale. | `app/src/style.css` |
| **7h** | **Avanzato riordinato** | Le tessere in tre famiglie (collegamento / audio / misura), più riposo, media e mediana dello sforzo; il cassetto ⚙ in quattro gruppi con un nome ciascuno (vista / taratura / video / strumenti) e su una riga sua. | `app/src/ui/stats.js`, `index.html` |

### Com'è andata: le cose decise costruendo

Sei, e nessuna era nel piano.

**Il nastro delle zone era spostato di un secondo.** `envelope()` metteva la
fatica nella colonna di `ts[i]`, mentre le tacche dei momenti disegnate sopra lo
stesso nastro usano il centro della finestra: due grandezze allineate sulla
stessa striscia e sfalsate di un secondo. Adesso anche il nastro passa da
`ts[i] − WIN/2`. È il genere di errore che il prototipo non poteva mostrare,
perché lì i dati erano già allineati a mano.

**Il cursore del grafico stava sul bordo destro anche in revisione.** `drawChart`
disegnava la riga verticale a `tNow`, che dal vivo è l'adesso ma in riascolto è
il bordo della finestra: indicava un istante diverso da quello di cui parlavano
il riquadro e la striscia. Corretto in tutti e due i modi, non solo nel semplice.

**Una linea fuori scala spariva.** Con la scala fissa del modo semplice un valore
oltre +90 usciva dal canvas e il grafico sembrava VUOTO proprio mentre stava
succedendo qualcosa. Adesso la linea si appoggia al bordo: si vede che è oltre, e
di quanto lo dice il numero nel riquadro. In avanzato nessun limite, perché lì la
scala la sceglie chi guarda.

**Una presa del solo microfono non ha campioni del sensore**, quindi l'analisi
non parte — e la fase «la presa» restava una schermata con un solo pulsante,
mentre in memoria c'erano dei megabyte da salvare o buttare. La scheda adesso si
apre comunque, la striscia dice perché è vuota, e i comandi dell'analisi
precedente si spengono invece di restare accesi su niente.

**La striscia in semplice disegna la fatica, non i count grezzi.** L'inviluppo
min/max è una mappa da riconoscere per chi sa cos'è un count; a chi canta non
dice niente. Stessa scala del riquadro e dei grafici, così un picco alto lì è
alto anche qui.

**Il cassetto ⚙ era `display: contents`**, cioè i suoi undici controlli si
mescolavano ai pulsanti di collegamento e andavano a capo dove capitava. Con i
quattro nomi di famiglia il difetto si vedeva subito: un'etichetta in fondo a una
riga e il suo gruppo sulla successiva. Adesso è una riga sua, dove il ⚙ non
esiste.

### Verificato come

Chrome headless via CDP (vedi `README`), sul dev server, in tre passate:
il percorso completo del modo semplice a 1280×1000 (vuoto → vivo → i venti
secondi dello zero → registrando → la presa → la domanda → avanzato), lo stesso a
390×844 con l'emulazione mobile e il microfono finto, e la presa del solo
microfono. Nessun errore in console, documento mai più largo del viewport, e i
190 test dei moduli senza DOM continuano a passare.

### Fuori piano, di proposito

- **Il simulatore** non si cancella ma scende in avanzato: è diventato uno
  strumento da sviluppo. La demo per far vedere l'app è **un video registrato**,
  non una funzione.
- **La 5c (riaprire una registrazione salvata)** resta non fatta e non entra qui.
- **Una landing page** è stata valutata e scartata: i comandi di collegamento
  devono comunque stare nella pagina coi grafici, quindi una terza schermata
  sarebbe da mantenere per niente. Il suo posto lo prende lo **stato vuoto** della
  pagina unica. Da riprendere solo quando ci sarà qualcosa da raccontare a chi il
  sensore non ce l'ha ancora.
- **La calibrazione** esce dal modo semplice: la 6e aveva già stabilito che non è
  prerequisito di niente. Resta in avanzato per `×rif` e per il referto sul
  montaggio degli elettrodi.

---

## Cosa NON rifare

- **Non aggiungere un flag.** Le cinque domande del committente venivano da quattro
  flag indipendenti. Ogni nuovo stato booleano che non passi dalla fase riporta il
  problema.
- **Non mettere due grandezze diverse sullo stesso asse Y.** Provato con sforzo e
  nota: fa leggere correlazioni che sono coincidenze di scala.
- **Non colorare dal vivo l'ultimo secondo.** Qualunque lettura che pretenda di
  sapere adesso una misura centrata su adesso sta attribuendo un colore non ancora
  misurato.
- **Non spegnere un comando per proteggere l'utente.** *Registra* con una presa non
  salvata si chiede, non si vieta: spegnerlo blocca anche il caso legittimo in cui
  quella presa si vuole buttare.
- **Non spiegare sotto ogni titolo.** «Ingressi» seguito da «cosa sta entrando
  nell'app» è rumore: se il titolo ha bisogno di una glossa, è sbagliato il titolo.

---

## 7i — Il primo giro di ritorno, e cosa ha trovato

La 7 è stata mostrata a chi l'ha chiesta, e sono tornati nove appunti in un
messaggio solo. Otto sono difetti veri; uno — la barra in alto — è la conferma
che il lavoro si era fermato un passo prima della fine. Nessuno riguarda il
modello di stato: **le due fasi e i due modi hanno tenuto**, e tutto quello che
segue è vestizione, misura o attrito.

### La barra in alto non aveva più niente da dire

> «la barra in alto con avanzato non mi sta bene. occupa spazio ed è brutto […]
> da desktop la mergiamo con la barra del sensore»

Nel modo semplice quella riga conteneva quattro cose: il nome dell'app, il
pallino dello stato — **già spento dalla 7c**, perché lo stato lo dice
l'interruttore — il ⚙ dei controlli, che nel semplice non ha controlli da
aprire, e l'interruttore dei modi. Cioè un elemento vivo su quattro, in una riga
di altezza piena, appiccicata in cima.

**Nel semplice l'header non c'è.** Il suo unico comando scende accanto alla `i`,
in fondo alla rastrelliera, dove stanno le due cose secondarie della schermata.
Sono due pulsanti nel DOM per lo stesso comando — l'altro resta in alto a destra
in avanzato, dove la rastrelliera non c'è — e li scrive entrambi `applica()` con
una `querySelectorAll`: due elementi che non possono dire cose diverse. Il nome
dell'app ricompare in un posto solo, lo **stato vuoto**, che è il solo momento
in cui uno ha bisogno di sapere su cosa è atterrato.

### Le cose che dicevano la storia dello sviluppo

> «il fatto che "il riposo non si calibra" è un dettaglio di chi sa la storia
> dello sviluppo ma così non ha senso»

Ed è vero: quella frase rispondeva a una domanda che si erano fatti solo i due
che hanno scritto la 6e. Chi apre l'app non sa che esiste una calibrazione da
non fare. Adesso il paragrafo dice cosa succede — *lo zero è il tuo riposo, lo
misura l'app, non c'è niente da preparare* — invece di negare una cosa che
nessuno aveva chiesto.

Stessa famiglia, altre due: la parola **ADESSO** sopra il numero del riquadro e
la parola **NOTA** sopra la nota. La prima diceva a un riquadro dal vivo di
essere dal vivo; la seconda nominava una cosa che si riconosce da sola.

> «va bene l'indicazione del tempo sopra, ma non è allineato alla nota. non mi
> piace. togliamoli entrambi, va bene il numero dello sforzo e la nota, si
> capisce e basta»

Via tutte e due. Il riquadro è la parola, il numero, la nota.

### Venti secondi erano un'eredità, non una misura

> «per la calibrazione iniziale se uno sta a riposo secondo me bastano 5 secondi»

`ZERO_MIN` era 20 e il commento che lo giustificava parlava di un caso solo —
chi comincia a cantare subito, il cui "riposo" sarebbe la frase più piana. Ma
quel numero lo pagavano tutti, compreso chi accende il sensore e sta fermo, che
è quello che fa chiunque apra l'app: venti secondi di schermo che dice «sto
misurando» come prima cosa che si vede. Adesso sono **cinque**, e su cinque
secondi fermi il 5° percentile è già tutto riposo. Il caso brutto resta, si dice
e si paga: chi parte cantando ha per qualche secondo uno zero troppo alto, e la
finestra mobile su due minuti lo corregge da sé. Misurato sul banco: a 2,5 s il
riquadro scrive ancora «4 s», poco dopo i 6 s il numero c'è.

### Il pitch che si autoadatta

> «il pitch, che si autoadatta non si capisce molto»

Il difetto non era la velocità dell'inseguimento — il filtro era già lento — ma
che **l'asse non aveva mai due volte la stessa scala**: i DO scivolavano, i
tasti neri si spostavano sotto la linea, e una nota tenuta ferma sembrava salire
perché era il fondo a scendere. Nel semplice l'asse adesso si aggancia alle
**ottave**: gli estremi sono sempre dei DO, il campo è un numero intero di
ottave (minimo due), e si sposta solo quando la voce sta per uscire davvero, con
un semitono di isteresi e senza toccare niente durante le pause — altrimenti a
ogni respiro la tastiera salterebbe al campo di ripiego. Il risultato è una
tastiera che resta ferma per tutta una canzone e, quando si muove, si muove di
un'ottava intera: si vede che è successo.

Effetto collaterale da sistemare subito dopo: agganciando alle ottave i DO
cadono **esattamente** sui due bordi, e la regola che saltava le etichette fuori
quadro lasciava etichettato solo quello di mezzo. Adesso i nomi al bordo
rientrano di cinque pixel — solo nel semplice: in avanzato sono etichettati
tutti i semitoni e un nome tirato dentro finirebbe addosso al suo vicino.

### Le altre due curve non erano nascoste, erano irraggiungibili

> «hai tolto dal chart dello sforzo le altre curve, ma non c'è modo di
> aggiungere easy il modo di farle vedere?»

La 7f le aveva spente nel semplice con una ragione giusta (chi canta non sta
cercando un artefatto) e una conseguenza non pensata: nel semplice **la barra
del pannello non c'è**, quindi le tre caselle non esistono, quindi l'unico modo
di rivedere il segnale sotto era passare in avanzato — cambiare tutta la
schermata per accendere una riga. Adesso c'è un comando **curve** in alto a
destra dentro il grafico, fantasma finché non lo si cerca, che riaccende
entrambe insieme: nel semplice la domanda è una sola («fammi vedere il segnale
sotto»), e una sola risposta basta. Si ricorda, come il modo.

### La linea che usciva dall'asse Y

> «nel grafico dello sforzo la riga esce a sinistra dell'asse y»

Un difetto vero, e con una causa esatta: la linea della fatica si disegna a
`t − WIN/2` — mezza finestra indietro, perché il valore descrive il passato — ma
la condizione che decideva da dove cominciare guardava `t`. Il primo campione
utile cadeva quindi **un secondo a sinistra del bordo sinistro**, sopra le
etichette dei count. Spostare la condizione avrebbe tagliato la *linea*,
lasciando un secondo di buco dopo l'asse; la cosa giusta è tagliare il *disegno*,
quindi tutte e tre le tracce girano dentro un `clip` sul rettangolo del grafico.
Verificato leggendo i pixel del margine: zero pixel colorati a sinistra di
`PAD.l`, con le curve accese e spente.

### La nota che faceva ballare il riquadro

> «quando c'è la nota, continua a cambiare dimensione orizzontalmente»

Due cause sovrapposte. La nota **andava e veniva** a ogni pausa (`hidden`), e
quando c'era misurava da due a tre caratteri. Adesso il posto dipende dalla
sorgente e non dall'istante — col microfono aperto, o su una presa che ha il suo
pitch, il riquadro tiene il posto e lo lascia vuoto nelle pause — ed è largo tre
caratteri di monospazio, il caso peggiore.

Su 390 px ne è saltata fuori una terza, che il desktop non poteva mostrare: con
le larghezze a contenuto bastavano due cifre in più nel numero per mandare la
nota **a capo**, cioè per lasciare esattamente la riga vuota che si stava
togliendo. La parola prende `flex: 1 1 8ch`: a cedere è lei, che va a capo per
mestiere.

### Il riascolto: una barra si trascina

> «la window dovrebbe essere draggabile non solo clic […] c'è di fianco "sei a
> 0:12" ma non ha senso "sei a" e poi resta fisso e si aggiorna solo a stop»

Tre cose, e la terza era un bug.

**Si trascina.** Il clic resta e resta diverso: senza spostamento si aggancia al
momento più vicino (è così che si salta da un punto caldo all'altro),
trascinando no — agganciarsi mentre si scorre farebbe saltare la vista addosso
ai momenti. Tre pixel separano un tocco da un trascinamento, che su un vetro è
la differenza fra un dito fermo e un dito fermo davvero. Durante il
trascinamento si riscrive solo il tempo e non tutta la lista: la striscia e i
tre pannelli li ridisegna il ciclo, che legge il cursore da sé.

**«sei a» non c'è più**, e al suo posto c'è il totale: `0:12 di 1:45`. Un tempo
accanto a una barra di navigazione è già la posizione; la preposizione era
l'etichetta ridondante che tutta la fase 7 toglie, e il totale è l'unica cosa
che mancava per dare una misura al numero.

**E si muove.** Quella riga era scritta solo da `render()`, cioè a ogni scelta
dell'utente — e la riproduzione non ne fa nessuna: il cursore correva sulla
striscia, che la ridisegna il ciclo, e il numero restava fermo sull'istante in
cui si era premuto play. Adesso lo riscrive anche il ciclo, a 5 Hz, che è la
cadenza del riquadro e delle statistiche. È lo stesso difetto di categoria del
cursore del grafico trovato nella 7e: **una cosa che si muove non può stare in
un posto che si aggiorna solo quando si clicca.**

### Verificato come

Chrome headless via CDP, sul dev server, in quattro passate: il percorso
completo del semplice a 1280×1000 (vuoto → vivo → i cinque secondi dello zero →
registrando → la presa → riascolto → la domanda), lo stesso a 390×844 con
l'emulazione mobile e un oscillatore al posto del microfono finto, il
trascinamento della striscia con eventi di puntatore veri
(`Input.dispatchMouseEvent`), e il modo avanzato per controllare che non sia
cambiato niente. Più due misure di pixel: il margine sinistro del grafico vuoto
in tutti e due gli stati delle curve, e le tre righe del riquadro sulla stessa
riga anche con cinque cifre nel numero. Nessun errore in console, documento mai
più largo del viewport, 190 test dei moduli senza DOM.

## 7j — Il secondo giro, e cosa sono quei puntini

Sei appunti, e cinque sono la stessa osservazione vista da cinque punti diversi:
**la schermata semplice aveva ancora addosso dei comandi travestiti da
decorazione**, e intanto lasciava vuoto un terzo dello schermo. Il sesto è una
domanda, ed è la più utile del gruppo perché nessuno se l'era fatta.

### «Avanzato» non è un comando da tenere a schermo

> «avanzato in alto a destra non mi piace. ci possiamo mettere una rotellina
> forse che apre un dropdown che ci lascia spazio alle opzioni»

Nella 7i quell'interruttore era sceso dall'header alla rastrelliera, e il
problema era rimasto lo stesso di prima, solo più piccolo: una parola sempre in
vista per un comando che si tocca una volta al mese. Adesso c'è una **rotellina**
e dentro un menu — che è anche la risposta alla parte della frase che non parlava
del difetto ma del futuro: *ci lascia spazio alle opzioni*. Le opzioni del
semplice erano zero perché non c'era dove metterle.

La prima ci è entrata subito: **quanto tempo si vede**. In avanzato è la casella
`finestra`, qui sono quattro scatti (3, 5, 10, 30 s) che scrivono lo **stesso**
campo `#win`. Un valore solo e due modi di toccarlo: se ne esistessero due,
prima o poi direbbero numeri diversi.

### La `i` spiegava una schermata che si spiega da sé

> «la info su mobile esce dallo schermo a sinistra. io ti direi che lo togliamo,
> il resto è intuitivo»

Il bordo che usciva era un difetto da sistemare in una riga di CSS; la frase
dopo è quella che conta, e ha ragione. Quel pannellino conteneva quattro
paragrafi su cosa fosse il numero, su quanto stesse indietro, su dove fosse lo
zero e su cosa prendesse *Registra* — cioè la documentazione del progetto messa
dentro il prodotto. La schermata è due interruttori, un numero grande con una
parola accanto, e un comando rosso. Se ha bisogno di quattro paragrafi, non sono
i paragrafi a mancare.

Via la `i`. I suoi contenuti restano dove vive la documentazione: il blocco
*Requisiti, limiti e come si legge* in avanzato, e questi due file.

### Un comando travestito da nota a margine

> «il pulsantino curve non mi piace magari ce la caviamo con una legenda sotto,
> in orizzontale delle tre curve e cliccabile che le disattivi?»

Il `curve` della 7i era un ripiego, e si vedeva: un pulsantino fantasma appiccicato
dentro il grafico, in alto a destra, che accendeva **due** tracce insieme perché
non c'era posto per tre. Intanto in avanzato le stesse tre tracce erano tre
caselle nella barra, con l'etichetta colorata — cioè una legenda che faceva finta
di non esserlo.

Erano due comandi diversi, in due posti diversi, per la stessa cosa. Adesso è uno
solo: **la legenda sotto il grafico**, tre voci in fila col trattino del proprio
colore, e si clicca per spegnere. Una legenda è ciò che uno cerca quando non sa
cosa sia una riga; farla diventare anche l'interruttore di quella riga costa zero
pixel in più e toglie un elemento dalla barra.

Due memorie separate per modo (`ui/modo.js`): in avanzato le tre tracce partono
accese, nel semplice solo lo sforzo. Non è una preferenza sola letta due volte —
quello che si vuole vedere cantando non è quello che si vuole vedere cercando un
artefatto — ed è per questo che il modo è la chiave giusta per distinguerle. Chi
aveva acceso il vecchio `curve` se lo ritrova acceso: la vecchia chiave si
traduce una volta e poi non serve più.

### Il pitch non diceva quanto tempo stava mostrando

> «il pitch non ha range temporale. lo aggiungerei per uniformità»

I due pannelli condividono l'asse X per costruzione — stessi `PAD.l`/`PAD.r`,
stessa finestra — ma solo uno dei due lo **scriveva**: per sapere quanti secondi
stavi guardando nel pitch dovevi guardare il grafico sopra. Il reticolo era
copiato nei due file, le etichette no, ed è esattamente il modo in cui due copie
divergono.

Adesso l'asse dei tempi è un modulo suo, `draw/tempo.js`: `reticoloTempi()` e
`etichetteTempi()`, che riceve contesto, asse e funzione `X` di chi chiama e non
sa niente dei canvas. I due pannelli scrivono gli stessi secondi indietro in
avanzato e le stesse due parole (`−5 s` / `adesso`, o il tempo dentro la presa in
riascolto) nel semplice, e se domani cambia il passo delle tacche cambia in un
posto.

Una differenza voluta: l'asse dei tempi segue il **modo**, non lo stato della
misura. Prima, nel semplice, le due parole comparivano solo quando lo zero della
sessione c'era già; nei primi cinque secondi si vedevano i secondi negativi
dell'avanzato. L'asse X non ha niente a che fare con lo zero del riposo, e il
pannello del pitch — che uno zero non ce l'ha proprio — deve poter dire la stessa
cosa.

### I numeri delle altezze erano sbagliati in quanto numeri

> «abbiamo un po' di spazio verticale e i pannelli non usano tutto lo spazio
> disponibile, possiamo alzarli un pochino fino a riempire lo spazio»

Le altezze del semplice erano 300 px e 200 px, più tre media query con frazioni
di viewport per i telefoni. Su uno schermo alto restava un terzo di pagina vuoto
sotto; su uno basso si scrollava. Un difetto che si presenta in tutte e due le
direzioni non è un numero da ritoccare: è un numero che non doveva esserci.

`main` è alto almeno un viewport, i due pannelli sono `flex: 1.5 1 0` e
`flex: 1 1 0` — le **proporzioni** invece delle misure, il sensore una volta e
mezzo il pitch — e quello che avanza dopo la rastrelliera e il riquadro finisce
nei grafici. L'unica misura rimasta è un `min-height` di 96 px sul corpo, cioè il
punto sotto il quale un grafico non dice più niente; le frazioni di viewport dei
telefoni sono sparite tutte. Nella fase *la presa* la scheda in cima si prende la
sua altezza e i due grafici si dividono il resto, senza una regola in più.

Un dettaglio che non era ovvio: col corpo che prende l'altezza dal flex, un
canvas `height: 100%` dipende da una misura che il browser calcola dopo. I due
canvas del semplice sono `position: absolute; inset: 0`, e il `ResizeObserver`
di `draw/canvas.js` fa il resto come già faceva.

### «Cosa sono quei puntini rossi e verdi?»

> «ti chiedo anche nel grafico del pitch cos'è quei puntini rossi e verdi che ci
> sono in basso.. è se non rileva nulla? non capisco»

È la **clarity**, cioè quanto la stima di pitch è credibile istante per istante:
verde sopra la soglia del pannello, gialla appena sotto, rosso scuro quando la
periodicità non c'è — silenzio, consonanti, una base in cassa che porta una
seconda sorgente. Non è una misura sulla voce, è una misura **sulla misura**.

La domanda però è la risposta: se chi guarda l'app deve chiedere cosa sia una
fila di puntini colorati sotto un grafico, quella fila sta dicendo di essere un
secondo grafico. E soprattutto **quello che dice si vede già**: sotto soglia la
linea del pitch si interrompe, e un buco nella linea è più leggibile di un
puntino rosso sotto di essa. Nel semplice la striscia non si disegna più. In
avanzato resta, perché lì `clarity ≥` è un comando in barra e la striscia è come
lo si tara.

### Tre correzioni sùbito dopo, e una regressione mia

> «non mi piace che quando avvii la prima volta prima di collegare il sensore c'è
> il grafico vuoto sotto»

Quello era **un difetto introdotto qui**, e vale la pena dire come. La regola che
spegne i pannelli nello stato vuoto era scritta su `.panel`; le regole nuove che
danno l'altezza ai due grafici sono scritte sugli id. Un id batte qualunque
numero di classi, quindi `#pEmg { display: flex }` ha vinto su
`[data-ing=niente] .panel { display: none }` e il grafico del sensore è
ricomparso vuoto sotto l'invito — esattamente la cosa che quella regola esiste
per togliere. Adesso lo stato vuoto spegne per id, e già che c'era prende
**tutta la pagina**: `flex: 1` al posto dei suoi 256 px di contenuto. Finché non
entra niente la schermata è una cosa sola.

Lezione generale, non solo di questo punto: in un foglio dove il layout è deciso
da `[data-modo]` e `[data-fase]`, *aggiungere un id abbassa il soffitto a tutte
le regole di stato scritte con le classi*. O si sta sulle classi, o si passa agli
id da entrambe le parti.

> «la rotella facciamola più grossa come icona e senza bordo»

Il bordo la faceva leggere come un pulsante fra i pulsanti, e non lo è: sta in
fondo alla barra perché è l'ultima cosa, non perché sia la terza. Icona a 23 px,
niente bordo, e il tondo di sfondo solo sotto il dito o a menu aperto.

> «in versione mobile i toggle sensore e microfono li terrei comunque allineati a
> sinistra»

La griglia del telefono era `1fr 1fr auto`: due colonne elastiche spingevano il
microfono in mezzo allo schermo, lontano dal sensore, e i due interruttori
smettevano di leggersi come una coppia. Adesso è `auto auto 1fr` — a cedere è lo
spazio *prima* della rotellina, che è quello che non serve a nessuno.

### Verificato come

Chrome headless via CDP sul dev server, in tre passate: il semplice a 1280×1000
col simulatore e il microfono finto (la rotellina che si apre, sta dentro lo
schermo e si chiude cliccando fuori; i quattro scatti della finestra che
scrivono `#win`; la legenda che accende, spegne, si ricorda e cambia col modo; i
pixel della fascia bassa del canvas del pitch, che ci devono essere per le
etichette e non ci devono essere per la striscia di clarity), lo stesso a
390×844 in emulazione mobile (il menu dentro i 390 px, nessuno scroll
orizzontale), e una registrazione vera di quattro secondi per guardare la fase
*la presa* con la scheda in cima. In tutte e tre: `scrollHeight` uguale
all'altezza del viewport — la pagina sta in uno schermo — l'ultimo pannello che
arriva in fondo, e nessun errore in console. Più i 190 test dei moduli senza DOM.
Lo stato vuoto ha una passata sua, desktop e telefono: l'altezza di ogni figlio
di `main` letta una per una, che è il modo in cui il grafico di troppo si è fatto
trovare — 501 px di pannello sotto un invito che ne occupava 256.

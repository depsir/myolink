# Fase 6 — Un rilevatore solo, tarato sui dati veri

> Piano nuovo, scritto il **4 settembre 2026**. `docs/PIANO.md` resta com'è: è il
> racconto delle fasi 1–5 e va letto prima di questo, ma la **fase 5b va
> considerata superata** da quanto c'è qui sotto.

## Perché c'è un piano nuovo invece di una correzione

La 5b è stata disegnata e costruita senza mai aver visto una registrazione cantata
vera. Funzionava su un brano sintetico che avevo costruito io, e il brano
sintetico conteneva la mia ipotesi — «troppa tensione = il livello sale» — quindi
non poteva che confermarla. Alla prova a mano non convinceva, e le prime tre
registrazioni vere hanno ribaltato non una costante ma l'impianto.

Non è una fase di rifinitura: **si cancella più di quanto si aggiunge.**

---

## Dove eravamo

| | |
|---|---|
| fasi 1–4 | fatte e **committate** (ultimo commit `66ad055`, 13 agosto) |
| fasi 5a + 5b | scritte, poi **in gran parte cancellate dalla 6d** — mai committate |
| fase 5c (replay col video) | mai iniziata |
| 4 settembre, mattina | il grafico disegna la mediana a 300 ms (6a), e arrivano le quattro registrazioni vere |
| 4 settembre, sera | **6b, 6c, 6d, 6e fatte**, più il semaforo dal vivo che non era in piano: 190 test verdi, `tools/bench-momenti.mjs` verde con 41 controlli |

Tutto il lavoro dal 13 agosto in poi è ancora fuori da git, `docs/samples/`
compreso. **Committare è la prima cosa da fare**, prima di toccare qualunque riga.

---

## Cos'era rotto nella 5b, e non erano le costanti

Tre cose, tutte dimostrate prima di cambiare qualcosa.

1. **Venti punti sempre.** La salienza è relativa e non c'è nessun pavimento: il
   girone pesca dai tre elenchi finché non ha riempito lo slider, quale che sia il
   valore di quello che pesca. Su una performance senza un solo difetto la macchina
   produce ugualmente 99 candidati e ne consegna 20. Il coach vede una lista piena
   in tutti e due i casi, e impara a non fidarsi.
2. **«Instabile» ordinava rumore.** I suoi due candidati in testa erano gli stessi
   punti, con gli stessi valori, in un brano con le oscillazioni e in uno senza.
3. **Il numero che direbbe la differenza esisteva già** — `s.val` col suo
   percentile `s.p` — ed era deliberatamente nascosto, «perché un numero inviterebbe
   a regolarlo». La scelta era ragionevole e si porta via l'unica informazione che
   distingue una canzone con quattro punti caldi da una che va bene.

---

## I dati veri — `docs/samples/`

Tre registrazioni del pomeriggio del 4 settembre, a pochi minuti l'una dall'altra,
**stesso montaggio**: è questo che permette di confrontarle in assoluto, cosa che
di solito non si può fare ed è metà del loro valore.

| file | cosa c'è dentro | durata |
|---|---|---|
| `…-161922` | silenzio | 33,9 s |
| `…-162656-errore` | *Man in the Box*, buona fino a un certo punto, poi **una strofa in cui mancava il fiato: «un errore grosso»** | 71,7 s |
| `…-162809-ok` | *Man in the Box*, **solo la parte che spinge, ma fatta bene** | 58,6 s |
| `…-163516-callmeadog-forseok` | *Call Me a Dog*, **giudicata «abbastanza buona», «ma il grafico va un pochino su»** | 197,7 s |

100 Hz (non 200: la banda del fenomeno sta sotto i 3 Hz, quindi va benissimo).
Ogni presa ha il suo `.csv` (EMG), il suo `.pitch.csv` e il suo `.mp4`.

**Le durate dei tre mp4 coincidono con quelle dei CSV al centesimo**, quindi i
tempi stampati dagli strumenti sono i tempi del video: un punto trovato a 0:46 si
riguarda a 0:46.

> **Queste registrazioni sono le uniche etichette che esisteranno mai.** Il piano
> della 5b diceva che un dataset etichettato non si sarebbe formato, e aveva torto
> per un motivo semplice: chi canta *sa* dire «qui ho sbagliato», basta chiederglielo
> e registrarlo. Non si cancellano mai. Le etichette (quali secondi sono cosa)
> stanno in `TRATTI` dentro `app/tools/analisi-samples.mjs` — quelle sì che sono
> in repo, ed è la metà che il codice legge.
>
> **In git però non ci sono**, ed è una decisione rimandata e non una svista: sono
> 90 MB, di cui 89 di mp4 e uno solo da 53 MB, e un binario così non si toglie più
> dalla storia senza riscriverla. Per ora `docs/samples/` è in `.gitignore` e i file
> stanno sul disco. Chi riparte da un clone non li ha: i numeri che seguono si
> rifanno solo con quelle registrazioni sotto mano.

---

## Cosa dicono i dati

Un comando rifà tutte le misure di questa sezione:

```
node app/tools/analisi-samples.mjs
```

**La scala esiste, in count sopra il riposo** (riposo = 251 count, oscillazione a
riposo = 0,89 count):

| tratto | livello | in σ del riposo | oscillazione |
|---|---|---|---|
| silenzio | +0 | 0σ | 0,91 (1,0×) |
| canta normale | +2 … +3 | 2–3σ | 3,1–3,5 (3,5×) |
| spinge, ma va bene | +18 (picco +32) | 20σ | 10,6 (11,9×) |
| **la strofa sbagliata** | **+35 (picco +82)** | **39σ** | **16,4 (18,5×)** |

**Cosa trova una soglia sola sul livello**, sulle quattro registrazioni:

| soglia | silenzio | «ok» | «errore» | «call me a dog» |
|---|---|---|---|---|
| +25 | 0 | 3 | 2 | 6 |
| **+35** | 0 | **0** | **1: 0:46–0:52 (+82)** | 3 |
| +45 | 0 | 0 | 1 | **1: 2:54–3:04 (+63)** |
| +65 | 0 | 0 | 1: 0:48–0:52 | 0 |

Le prime tre registrazioni sono d'accordo su qualunque soglia fra +35 e +65. È la
quarta a mettere il dito nel punto giusto, ed è per questo che vale più delle altre
tre: *Call Me a Dog* è giudicata «abbastanza buona» da chi l'ha cantata, che però ha
anche notato che **«il grafico va un pochino su»** — e infatti il suo massimo, +63,
sta esattamente in mezzo fra la parte che spinge bene (+32) e la strofa sbagliata
(+82).

**Il controllo che rende il confronto pulito.** Nella strofa sbagliata la nota
mediana è **Sol#4** — *la stessa* della parte che spinge ma va bene, e in tutte e
due canta (voce nel 57% e nel 63% del tempo). Stessa altezza, esecuzione diversa:
non è la nota acuta a far scattare la misura. Non l'ho costruito io, è venuto così.

### La prova migliore che abbiamo: il Sol#4

È la domanda che chi canta ha posto per primo — *«anche se la nota è acuta ma vado
giusto, la linea rimane tranquilla»* — ed è il falso positivo peggiore possibile: se
il livello seguisse l'altezza della nota, una soglia segnalerebbe ogni passaggio
acuto e lo strumento sarebbe inutile.

Raggruppando ogni istante con voce per semitono, sulla **stessa nota, stesso
cantante, stessa canzone, minuti di distanza**:

| Sol#4 | 25° pct | mediana | 95° pct |
|---|---|---|---|
| presa **ok** | +24 | **+24** | +29 |
| presa **con l'errore** | +17 | **+68** | +76 |

**2,8× sulla stessa nota**, e la distribuzione della presa buona è strettissima
(+24 … +29). Su tutte e tre le prese cantate la nota spiega solo il **16–24%**
della varianza del livello: il resto è come la nota viene tenuta. **Il livello non
è un misuratore di altezza — misura la fatica.**

---

## La cosa su cui mi ero sbagliato, e va lasciata scritta

Prima delle registrazioni c'erano **due immagini del serial plotter dell'Arduino
IDE** — un passaggio cantato bene su una nota acuta e uno tirato — lette pixel per
pixel. Dicevano che il fenomeno era **l'ampiezza dell'oscillazione** (4,7×) e non
il livello (1,9×), e su quelle avevo disegnato la misura.

**Sui dati veri non regge**: le due grandezze salgono insieme e il livello sale di
più (1,94× contro 1,55× fra la strofa sbagliata e la parte che spinge bene; con la
soglia al 5° percentile dell'errore il livello lascia passare il 18,8% del resto,
l'oscillazione il 33,7%).

Perché mi ero sbagliato: le due immagini erano **un contrasto diverso** — una nota
acuta *tenuta bene* contro una tirata — mentre nelle registrazioni il confronto è
fra *spingere bene* e *spingere male*. Da due spezzoni di un altro contrasto, in un
altro mezzo (il plotter disegnava una traccia già lisciata; la nostra disegna ogni
campione grezzo), non si generalizzava. La lezione non è «l'oscillazione non serve»
— è che **due spezzoni non sono un dataset**, nemmeno quando i numeri sono netti.

**Quello che invece regge, ed era il punto vero: non si divide.** Il rapporto
oscillazione/livello — cioè `wobble()`, l'indice di «instabile», costruito apposta
per essere indipendente dal guadagno — su questi dati **scende** quando si spinge:
1,16 cantando normale, 0,47 nella strofa sbagliata. Non è debole: è **invertito**.

---

## Le sottofasi

### 6a — Il grafico mostra la linea del rilevatore ✅ fatta

`app/src/draw/chart.js`. Sopra la nuvola dei campioni grezzi (ora al 50% di
opacità) c'è **la mediana mobile a 300 ms**, in bianco, spessa 2. Non è un
lisciamento cosmetico: è `movMedian(ts, vs, ACT_WIN)`, *esattamente* la funzione
che gira dentro l'analisi — se le due divergessero, il grafico mentirebbe. La
finestra si semina `ACT_WIN` prima del bordo sinistro, altrimenti i primi 300 ms
visibili mostrerebbero una mediana parziale.

**Perché è servita.** Il fenomeno che chi canta riconosce ha ampiezza di pochi
count, mentre il rumore per campione ne ha quattro volte tanti: sui grezzi sta
sotto la nuvola, e quello che non si vede non si può giudicare. Nel vecchio plotter
si vedeva solo perché quella traccia era già lisciata da chi la stampava.

### 6b — Un rilevatore solo: il livello sopra il riposo ✅ fatta

**La misura.** Mediana mobile a 300 ms → letta su una finestra di **2 s** →
**meno il riposo** → in count. Niente percentili, niente rapporti, niente girone.

**Da dove viene il riposo — misurato, e la risposta è netta.** Delle due strade
vince la seconda, e non di poco:

| registrazione | 5° percentile del livello | mediana del silenzio | scarto |
|---|---|---|---|
| silenzio (34 s) | 251,0 | 251 | **0,0** |
| «errore» (72 s) | 251,0 | 251 | **0,0** |
| «ok» (59 s) | 251,0 | 251 | **0,0** |
| «call me a dog» (198 s) | 251,0 | 251 | **0,0** |

Zero count di scarto su tutte e quattro, *Call Me a Dog* compresa — che sono tre
minuti di canto quasi continuo. Funziona perché dentro una canzone il riposo
esiste comunque: è la **pausa fra due frasi**, cioè il rilascio inspiratorio.
Quindi **il blocco di silenzio non serve**, e nemmeno la calibrazione: lo zero se
lo prende la sessione da sé (`zeroVivo` in `core/fatica.js`, `restFromRecording`
per l'analisi — stesso percentile, stessa grandezza).

Sul brano sintetico dei test, con solo il 20% di pause, lo scarto sale a un paio
di count: il 5° percentile cade più in alto dentro la distribuzione del riposo. È
il caso peggiore e resta molto sotto la larghezza del verde.

**E il numero si mostra**, accanto a ogni momento. È il ribaltamento di una
decisione della 5b — *«il punteggio non si mostra, perché un numero inviterebbe a
regolarlo»* — e stavolta c'è la prova che quel numero è la cosa più utile che
abbiamo:

> +24 = tenuta bene · +42 = un pochino su · +68 = sbagliata

Questa scala è **leggibile da chi canta**, e non è una manopola: non regola niente,
descrive. La 5b nascondeva l'unica informazione che distingue una canzone con
quattro punti caldi da una che va bene, e la nascondeva per proteggere una
semplicità che poi non c'era. Il numero poi si riassume in **tre zone** — vedi 6c —
che sono la forma in cui va a schermo.

**Com'è andata.** La soglia d'ingresso è diventata **il confine del verde**
(+30), non un secondo numero: un momento è un tratto che *esce dal verde* e ci
resta almeno un secondo, con isteresi d'uscita a 0,7× e il tratto attribuito al
**centro** della finestra di lettura. Il modulo vero dell'app, sui quattro CSV
(`node app/tools/marks-csv.mjs …`):

| presa | momenti |
|---|---|
| silenzio | **0** — «nessun momento fuori dal verde: la lista è vuota, ed è un risultato» |
| «ok» | 2, entrambi **gialli** e corti: `0:27 +32 · 1,0 s` e `0:43 +31 · 2,3 s` |
| «errore» | 2: `0:40 +32 giallo` e **`0:46–0:53 +82 rosso`** — il tratto confermato da chi cantava |
| «call me a dog» | 3: `1:40 +42 giallo` · `2:07 +35 giallo` · `2:54 +63 rosso` |

**Gli unici due rossi delle quattro registrazioni sono l'errore confermato e il
passaggio che chi cantava aveva notato da sé** («il grafico va un pochino su»). I
due momenti della presa buona stanno a +31 e +32, cioè un count sopra il confine:
sono il tetto di ciò che sostiene bene, ed è giusto che compaiano in giallo — la
misura non ha un'opinione, ha un numero.

### 6c — Tre zone invece di una soglia ✅ fatta

**Non una soglia: tre zone.** La proposta viene da chi canta, guardando la linea
bianca del grafico mentre cantava *Call Me a Dog*: *«mi sembrava che si alzasse, ma
non mi sembrava di andare così male… potrebbe essere una zona gialla, che potrebbe
andare meglio oppure anche verde con sufficiente sostegno perché comunque
difficile»*. I dati le danno ragione, e le zone si ancorano ai **suoi due passaggi
etichettati**, non a numeri scelti:

| zona | da … a | ancorata a |
|---|---|---|
| **verde** | fino a **+30** | il tetto di ciò che sostiene bene: le due parti «spinge ma va bene» stanno a +24 di mediana e non superano mai +32 |
| **giallo** | **+30 … +55** | la terra di mezzo, dove cade tutto *Call Me a Dog*: il suo passaggio peggiore ha mediana +47 |
| **rosso** | oltre **+55** | dove vive l'errore confermato: mediana +68, e le due prese buone non ci arrivano mai |

Il tempo passato in ciascuna zona è più eloquente di qualunque elenco di momenti:

| presa | verde | giallo | rosso |
|---|---|---|---|
| «ok» (59 s) | 56 s | 0,5 s | **0 s** |
| «call me a dog» (198 s) | 181 s | **12,4 s** | **2,1 s** (1%) |
| «errore» (72 s) | 62 s | 1,9 s | **5,4 s** (7,5%) |

**Sette volte più rosso nella presa sbagliata, in un file lungo un terzo.**

**Perché tre zone e non una soglia.** Il giallo dice una cosa che una soglia non
può dire, ed è proprio la cosa vera: *questo passaggio è costato più del tuo
normale, e può darsi che vada bene così perché è difficile*. Non è un giudizio
sospeso per prudenza — è la descrizione esatta di ciò che la misura sa e di ciò che
non sa. Il rosso invece è raro e si è guadagnato il nome: nelle quattro
registrazioni lo tocca solo l'errore confermato, più due secondi su tre minuti.

**Quanto sono provvisori questi numeri.** Due eventi etichettati, un cantante, una
sessione. La *struttura* — tre zone, ancorate a un passaggio tenuto bene e a uno
sbagliato dalla stessa persona — è la decisione; i confini sono una prima
regolazione e si sposteranno con le prossime registrazioni. Vanno tenuti in un
posto solo e dichiarati come tarati su quel montaggio.

**Un raffinamento suggerito da chi canta, da non fare adesso.** «Verde con
sufficiente sostegno perché comunque difficile» implica che il confine dovrebbe
dipendere da quanto è impegnativo il passaggio. È tecnicamente possibile — la nota
spiega il 16–24% della varianza del livello, quindi un confine che sale con
l'altezza avrebbe una base — ma con quattro registrazioni sarebbe adattarsi al
rumore. Si riprende quando ci saranno abbastanza prese da avere, per ogni nota, sia
esecuzioni buone sia esecuzioni tirate.

**In che unità.** `+30` e `+55` sono tarati su **quel** montaggio: sposta gli
elettrodi e non valgono più. In σ del riposo (0,89 count) i due confini stanno a
**34σ** e **62σ**; in multipli del passaggio tenuto bene (+24), a **1,25×** e
**2,3×**. Le
due candidate, da decidere misurando e non a ragionamento:

- **σ del riposo** (la soglia diventa ~40σ): trasferisce se il rumore scala col
  guadagno, e in prima approssimazione lo fa. Non chiede nessun gesto in più.
- **multipli del canto normale** (+3 → la soglia sarebbe ~12×): musicalmente più
  leggibile, ma il denominatore è piccolo e quindi instabile.

Serve una seconda sessione, con gli elettrodi rimessi da capo, per vedere quale
delle due regge. **Finché non c'è, la soglia resta in count e si dice che è tarata
su quel montaggio.**

### 6d — Cosa si cancella ✅ fatta

Da fare solo **dopo** che la 6b passa, e solo col via libera di chi decide il
prodotto, perché è una potatura seria:

| via | perché |
|---|---|
| i tre rilevatori → **uno** | «instabile» ordina rumore; «troppa tensione» e «sostegno che manca» sono i due versi della stessa misura |
| `wobble()` e tutto l'indice di oscillazione | l'indice è invertito, non debole |
| i percentili d'ingresso (`Q_IN`, `Q_OUT`, `SOST_IN`, `SOST_OUT`) | sono ciò che butta via la scala assoluta |
| `pickOrder()`, il girone all'italiana | con un rilevatore solo non c'è niente da alternare |
| lo slider «quanti punti» | sostituito dalla soglia: la lista può e deve essere vuota |

**È restato tutto il resto, che funziona**: la striscia panoramica, la lista
cliccabile, la curatela tieni/scarta, il cursore di revisione, il riascolto col
nastro, l'export `.vtt` e `.json`. Il banco di prova è stato aggiornato e
rinominato **`tools/bench-momenti.mjs`** (non testa più «la 5b»), e i controlli
sulle due manopole sono stati sostituiti da quelli sul semaforo, sul numero in
lista e sul nastro delle zone: 41 verdi.

Cosa è successo ai file: `core/marks.js` è passato da 529 a ~230 righe e ha perso
`KINDS/KIND/KEYS`, `segments`, `voicedSpans`, `wobble`, `crossings`, `pickOrder`,
`pick` e sette costanti; la misura è finita in un modulo nuovo, `core/fatica.js`,
perché adesso la usano anche il grafico e il semaforo. `marks.json` non porta più
il percentile ma **la zona e le costanti** con cui i numeri sono stati prodotti —
senza, fra un anno un file esportato non si saprebbe più leggere.

### 6e — La calibrazione si accorcia ✅ non serviva più

Alla 6b non serve **nemmeno il riposo**: lo zero se lo prende dalla sessione (vedi
la tabella nella 6b). La calibrazione resta dov'era, utile per `×rif` e per il
referto sul montaggio, ma **non è più un prerequisito di niente** — che è più di
quanto questo piano si aspettasse. Il ragionamento originale, ancora valido su
cosa serva a cosa: il blocco del massimo (3 × 4 s di espirazioni
forzate) accende `%max`, che sui dati veri è una scala debole; il riferimento
accende `×rif`, che sull'addome resta quasi sempre spenta. Sono 20 secondi su 34, e
sono la parte spiacevole. Il blocco degli accenti serviva a `wobble()`, che sparisce.

Nota pratica: **per registrare non serve calibrare affatto** — il rilevatore
funziona con `cal = null`. Le tre registrazioni del 4 settembre sono state fatte
così.

---

### 6f — Il semaforo dal vivo ✅ fatta (non era in piano)

Non c'era nella prima stesura, ed è venuta da una richiesta esplicita di chi
canta: *«un feedback live visibile tipo con un segnale colorato verde giallo
rosso, anche continuo volendo per la misurazione della fatica»*. Era fattibile
senza scoprire niente di nuovo, perché la misura si legge sulla coda dell'anello
esattamente come sulla registrazione.

**È la stessa identica misura**, e questo è il punto: se il colore dal vivo e la
lista dopo divergessero, il semaforo mentirebbe mentre si canta — il modo peggiore
di sbagliare. Il banco di prova lo controlla apposta.

Va a schermo in tre posti, dal più grosso al più preciso:

1. **la pastiglia in barra** (`verde +3`, `rosso +68`), grande abbastanza da
   prendersi con la coda dell'occhio. Il colore **non è mai solo**: dentro c'è
   sempre la parola e il numero — un semaforo verde/giallo/rosso è la
   combinazione peggiore per chi non distingue i rossi dai verdi, e la parola
   costa due centimetri di barra;
2. **il grafico**: due fasce orizzontali appena accennate a +30 e +55, e **la
   linea della fatica colorata per zona** sopra la nuvola dei grezzi e la mediana
   a 300 ms. La distanza fra la linea e il riposo *è* la fatica;
3. **il nastro delle zone** nella striscia dei momenti: la stessa cosa srotolata
   su tutta la presa, che ha preso il posto delle tre corsie della 5b.

**Il ritardo si dice, non si nasconde.** Il numero a `t` descrive `[t-2s, t]`,
quindi dal vivo arriva circa un secondo dopo il centro di ciò che descrive, e la
linea sul grafico si ferma un secondo prima del cursore — è disegnata *al centro
della sua finestra*, come i tratti, altrimenti starebbe un secondo a destra del
passaggio che descrive e non coinciderebbe con la banda del momento. Si vedeva
nella prima schermata, ed è stato corretto guardandola.

Accorciare la finestra toglierebbe il ritardo e romperebbe la misura: seguirebbe
ogni attacco di frase invece della fatica di un passaggio. Meglio un semaforo
lento e vero che uno pronto e nervoso.

### 6g — Le tre tracce si accendono una per una ✅ fatta (non era in piano)

Il grafico del sensore è arrivato a **tre letture dello stesso segnale
sovrapposte**: i campioni grezzi, la mediana a 300 ms, la linea della fatica
colorata — più le due righe delle zone e le bande dei momenti. Ognuna è stata
aggiunta per una ragione buona, e messe insieme fanno una cosa che nessuna delle
tre voleva: la nuvola dei grezzi copre le altre due proprio quando servono, e la
linea della fatica, che è spessa 2 px e opaca, copre la mediana ogni volta che il
segnale è fermo — sono quasi lo stesso numero, e infatti si sovrappongono.

Tre caselle nella barra del pannello, `tracce: grezza · mediana · fatica`, tutte
accese di serie. Non è una preferenza da salvare: si spegne quello che dà fastidio
*mentre* si guarda, e al giro dopo si riparte con tutto acceso, che è lo stato in
cui il grafico dice tutto quello che sa.

Tre dettagli che sono la differenza fra un interruttore e un interruttore giusto:

- **le due righe a +30 e +55 seguono la fatica**, perché sono la sua scala: da
  sole misurerebbero una linea che nel grafico non c'è più;
- **il numero in alto a sinistra resta sempre**, anche a tracce tutte spente —
  quello è la lettura, non una traccia. Sparisce invece il pallino sull'ultimo
  campione, che è il capolinea della grezza;
- **il video segue le caselle** senza saperne niente: il registratore copia questo
  canvas, quindi quello che si spegne qui non finisce nell'`.mp4`. È la sola cosa
  che rende utile spegnere la nuvola.

L'etichetta di ogni casella ha il colore della sua riga — blu, bianco, verde —
così la legenda non deve stare dentro il canvas, dove sarebbe stata la quarta cosa
a contendersi lo stesso spazio.

## Le domande aperte

Due sono state chiuse il 4 settembre, e vanno lasciate scritte perché sono ciò che
autorizza la 6d:

- ✅ **0:46–0:52 è la strofa giusta**, confermato da chi cantava.
- ✅ **Via libera a cancellare** quello che elenca la 6d.

Una terza è stata **chiusa dalla risposta «non lo so»**, che è essa stessa il dato:
i tre momenti di *Call Me a Dog* (**1:40–1:43** +42 · **2:07–2:08** +35 ·
**2:54–3:04** +63) restano senza etichetta, e ci restano per sempre. Da lì viene la
scelta di disegno della 6c: soglia bassa, numero in vista, giudizio a chi ascolta.

Una quarta si è chiusa implementando, ed è quella che la 6b lasciava in sospeso:
✅ **lo zero non ha bisogno di un blocco di silenzio** — il 5° percentile del
livello dà 251,0 su tutte e quattro le registrazioni, scarto 0,0 count.

Resta aperta una sola cosa, tecnica, che si risolve misurando: **l'unità della
6c**, che ha bisogno di una seconda sessione con gli elettrodi rimessi da capo.
Finché non c'è, i confini sono in count e l'app lo dice nel pannello dei
requisiti.

---

## Cosa NON rifare

Le trappole della fase 5 valgono ancora tutte (misurare il rumore sui valori invece
che sulle differenze; i livelli con una media invece che con una mediana; analizzare
lo store invece della registrazione). A quelle la fase 6 ne aggiunge tre sue:

- **Non dividere una grandezza per l'altra** per renderla «scale-free». Livello e
  oscillazione salgono insieme, e il rapporto si porta via il fenomeno — qui
  addirittura lo inverte. Se serve indipendenza dal guadagno, la si prende
  normalizzando sul **riposo della stessa persona**, non su un'altra grandezza dello
  stesso istante.
- **Non usare la MAD su una serie derivata dalla mediana di interi.** Il livello
  vive su una griglia da mezzo count, e una MAD può solo cadere sui nodi di quella
  griglia: sul silenzio dava esattamente **0**, cioè una divisione per zero proprio
  sul riferimento. Ci vuole la σ, che è continua anche su dati quantizzati.
- **Non tarare su un brano sintetico.** Il brano lo costruisce chi ha l'ipotesi, e
  quindi la conferma. Vale anche per due spezzoni veri di un contrasto diverso.
- **Non costruire niente che abbia bisogno di un'etichetta sui casi al margine.**
  Chi canta sa dire «qui ho sbagliato» quando l'errore è grosso, e *non* sa dire se
  un passaggio un po' caricato fosse giusto — l'ha detto esplicitamente. Ogni
  disegno che richieda quella distinzione (una soglia tarata sui borderline, una
  metrica di precisione, un classificatore) si appoggia su un dato che non
  arriverà. Il numero mostrato non ha questo problema: descrive, non giudica.

---

## Da dove ripartire a freddo

1. `git status` — c'è un mese di lavoro non committato. Committare prima di tutto.
2. `cd app && npm test` (190 attesi) e `node app/tools/bench-momenti.mjs` (41 controlli verdi).
3. `node app/tools/analisi-samples.mjs` — tutti i numeri di questo piano, rifatti.
4. `node app/tools/marks-csv.mjs docs/samples/myolink-20260904-162656.csv --pitch
   docs/samples/myolink-20260904-162656.pitch.csv` — il **modulo vero dell'app**
   sui dati veri: riposo, tempo in zona, momenti col numero.
5. `node app/tools/prova-spinta.mjs docs/samples/myolink-20260904-162656.csv` — il
   profilo nel tempo di una singola registrazione, con i tratti sopra soglia.
   Attenzione: quello strumento misura **l'oscillazione**, che è la strada poi
   scartata; resta utile per rivedere il confronto, non per tarare.
6. La spiegazione visiva di tutto questo, con le tracce disegnate, sta nell'artifact
   **«Dentro i momenti salienti»** (`claude.ai/code/artifact/3c9c1c29-04e3-4c4c-b254-38025da4cf29`).

# Come funziona Confermo, nel dettaglio

Documento di riferimento sul comportamento del sistema: cosa fa, quando lo fa,
e soprattutto **quando decide di non fare nulla** — che è la parte che
distingue un sistema affidabile da uno che manda messaggi alla cieca.

Serve a te per rispondere con precisione alle domande di uno studio o di un
consulente, e a chiunque metta mano al codice in futuro.

---

## 1. Il problema e la scelta di fondo

Un appuntamento mancato è tempo che non si recupera. Il promemoria telefonico
funziona ma costa tempo alla segreteria, e spesso salta.

Confermo automatizza il promemoria, ma la scelta che conta è un'altra:
**chiede al paziente di rispondere**. Chi conferma rassicura lo studio; chi
disdice in anticipo libera lo slot in tempo per riassegnarlo; chi non risponde
finisce in una lista corta di persone da chiamare a mano.

Il valore non è "mandare messaggi": è **trasformare un'agenda muta in
un'agenda che si aggiorna da sola**, e ridurre le telefonate a quelle poche
che richiedono davvero una persona.

---

## 2. Il modello dei dati

Cinque entità, tutte collegate allo **studio** (`clinic`): il sistema è
multi-studio fin dallo schema, anche se oggi ogni studio ha un accesso unico.

| Entità | Cosa rappresenta |
| --- | --- |
| **clinic** | Lo studio: nome, fuso orario, orari di silenzio, tipologie di appuntamento, credenziali del canale WhatsApp (cifrate) |
| **patient** | Nome, cognome, telefono, consenso privacy, stato di opt-out, apertura della finestra di conversazione |
| **appointment** | Data e ora, durata, tipologia generica, stato |
| **reminder** | Un promemoria programmato: quale tipo, quando parte, com'è andata, che risposta è arrivata |
| **inbound_message** | Ogni messaggio ricevuto dai pazienti, con l'identificativo del provider |
| **event_log** | Registro di tutto ciò che accade, senza dati personali nel contenuto |

Il pezzo non ovvio è **`reminder`**. I promemoria non vengono calcolati al
momento dell'invio: vengono **materializzati come righe** appena l'appuntamento
viene creato, ciascuna con il proprio orario di partenza. È questa scelta che
rende possibile l'unicità garantita degli invii (§4).

---

## 3. Il ciclo di vita di un appuntamento

### Gli stati

```
                    ┌─────────────┐
                    │  In attesa  │ ← appena creato
                    └──────┬──────┘
          «Confermo»       │       «Devo disdire» / segreteria
        ┌──────────────────┼──────────────────┐
        ▼                  │                  ▼
  ┌───────────┐            │            ┌───────────┐
  │ Confermato│            │            │  Disdetto │
  └─────┬─────┘            │            └───────────┘
        │                  │
        └────────┬─────────┘
                 ▼  (dopo l'orario, deciso dalla segreteria)
     ┌───────────────────────────┐
     │ Completato / Non presentato│  ← correggibili tra loro
     └───────────────────────────┘
```

Le transizioni sono **controllate**: il sistema rifiuta i passaggi incoerenti
(per esempio da "completato" a "in attesa"). Un appuntamento disdetto può
essere riattivato; "completato" e "non presentato" restano correggibili tra
loro, perché un click sbagliato della segreteria deve poter essere annullato.

### Cosa succede quando cambia qualcosa

- **Appuntamento creato** → nascono le due righe promemoria, con orario a
  T-48h e T-3h.
- **Appuntamento spostato** → i promemoria non ancora partiti vengono
  ricalcolati; quelli **già inviati non vengono toccati** (la storia non si
  riscrive).
- **Appuntamento disdetto o concluso** → i promemoria ancora in coda vengono
  annullati. È il motivo per cui, dopo una disdetta, il promemoria delle 3 ore
  non parte più.

---

## 4. Lo scheduler: come partono i promemoria

Un processo interno controlla **ogni 60 secondi** se ci sono promemoria dovuti.
Non serve Redis né una coda esterna: lo stato vive tutto sul database.

### L'unicità dell'invio

È il requisito più delicato del sistema, e regge su tre livelli:

1. **Vincolo sul database**: non possono esistere due promemoria dello stesso
   tipo per lo stesso appuntamento. Strutturalmente impossibile.
2. **Presa esclusiva della riga**: quando lo scheduler prende in carico un
   promemoria lo blocca in transazione (`FOR UPDATE SKIP LOCKED`), così anche
   con più processi attivi ogni riga viene lavorata da uno solo.
3. **Marcatura prima dell'invio**: la riga passa a "inviato" **prima** della
   chiamata al provider. Nel caso peggiore un messaggio risulta inviato senza
   esserlo — mai il contrario. Meglio un promemoria mancante che due uguali
   allo stesso paziente.

### Quando un promemoria NON parte

Questa è la parte che vale la pena conoscere a memoria, perché è ciò che
protegge la reputazione dello studio:

| Situazione | Cosa fa il sistema |
| --- | --- |
| Paziente **senza consenso privacy** | Non invia. Il promemoria risulta "non previsto" |
| Paziente che ha fatto **opt-out** (STOP) | Non invia, mai più, finché non viene riattivato |
| Appuntamento **disdetto o già concluso** | Non invia |
| **Canale WhatsApp non configurato** | Non invia, e lo registra |
| Promemoria **troppo in ritardo** | Non invia (vedi sotto) |
| Siamo dentro gli **orari di silenzio** | **Rimanda**, non annulla (vedi sotto) |

**Il promemoria in ritardo.** Se il servizio resta fermo qualche ora, alla
ripartenza lo scheduler trova l'arretrato con l'orario di invio già passato.
Un promemoria che arriverebbe a **meno di 30 minuti** dall'appuntamento — o
dopo — viene scartato. «Le ricordiamo il suo appuntamento» ricevuto a visita
iniziata è peggio del silenzio.

**Gli orari di silenzio.** Predefiniti 21:00–08:00, configurabili per studio.
Qui il promemoria non viene perso ma **rinviato alla prima ora utile**. Senza
questa regola, il promemoria delle 3 ore per una visita alle 9:00 partirebbe
alle 6 del mattino. Gli invii comandati a mano (messaggio di prova, pulsanti
della demo) ignorano la fascia: lì c'è una persona che ha deciso.

### Quando l'invio fallisce

Gli errori del provider non sono tutti uguali, e il sistema li tratta in modo
diverso:

| Errore | Comportamento |
| --- | --- |
| **Limite di invii superato** | Riprova con attese crescenti (2, 4, 8, 16 minuti), fino a 5 tentativi |
| **Modello non approvato** | Fallisce subito, nessun tentativo: riprovare non cambierebbe nulla |
| **Numero non su WhatsApp** | Fallisce subito, nessun tentativo |
| **Altro** (rete, credenziali) | Fallisce, resta a registro |

Il retry sul limite di invii è sicuro perché in quel caso il provider ha
**rifiutato** la richiesta: nulla è partito, quindi rimettere la riga in coda
non rischia doppioni.

---

## 5. Le risposte dei pazienti

### I pulsanti

Ogni promemoria porta con sé due pulsanti. Il sistema non si limita a leggere
il testo premuto: **incorpora l'identificativo dell'appuntamento nel pulsante**,
così la risposta viene agganciata all'appuntamento esatto anche se il paziente
ne ha più d'uno in programma. Se l'identificativo manca (per esempio perché il
paziente ha scritto la parola a mano) si ricade sull'euristica: il promemoria
inviato più di recente.

- **«Confermo»** → l'appuntamento passa a Confermato, e parte il ringraziamento
- **«Devo disdire»** → passa a Disdetto, i promemoria successivi vengono
  annullati, e il caso finisce tra i **messaggi da gestire**: uno slot libero
  è un'informazione che richiede una persona, non un automatismo

### Il testo libero

Un paziente che scrive «posso spostare a giovedì?» non viene interpretato dalla
macchina. Il messaggio viene salvato e mostrato in cima all'agenda nel riquadro
**«Messaggi da gestire»**, perché lo veda la segreteria.

È una scelta deliberata: indovinare l'intenzione di un paziente e sbagliare
costa molto più che chiedere a una persona di leggere una riga.

### L'opt-out

Se il paziente scrive **STOP**, **BASTA**, **CANCELLAMI**, **NON SCRIVERMI** o
simili, viene marcato immediatamente: nessun invio futuro, e i promemoria già
in coda vengono annullati. **Nessuna risposta automatica**: a chi chiede di non
essere disturbato non si replica.

La segreteria può riattivarlo dalla scheda del paziente, ma **solo se c'è un
consenso privacy valido** — riattivare chi ha detto STOP senza una nuova
autorizzazione è esattamente ciò che non deve poter accadere per errore.

### La finestra di 24 ore

WhatsApp permette messaggi liberi solo entro 24 ore dall'ultimo messaggio del
paziente; fuori da quella finestra servono modelli pre-approvati.

Il ringraziamento («Grazie, ti aspettiamo!») è un messaggio libero, inviato
dentro la finestra che la conferma stessa ha appena aperto. Se per qualche
ragione la finestra è chiusa, **non viene inviato e non è un errore**: viene
solo annotato nel registro.

### Lo stesso evento consegnato due volte

I provider di messaggistica ripetono le consegne quando non ricevono conferma.
Ogni messaggio in arrivo viene registrato con l'identificativo assegnato dal
provider, e un vincolo di unicità impedisce che lo stesso evento produca
effetti due volte: la seconda consegna viene riconosciuta e ignorata.

---

## 6. Il canale WhatsApp

Il resto del sistema non sa quale canale è attivo: parla con un'astrazione.
Oggi esistono tre implementazioni:

- **Canale simulato** — per le presentazioni e lo sviluppo. Non invia nulla.
- **360dialog** — un intermediario ufficiale (BSP), consigliato in produzione
  perché intermedia anche la fatturazione e offre assistenza.
- **Meta Cloud API** — collegamento diretto, senza intermediari. Utile per il
  collaudo (Meta offre un numero di test gratuito) e come alternativa.

La scelta è **per singolo studio**: due studi possono usare provider diversi
sulla stessa installazione.

**Il canale è sempre intestato allo studio**, non a noi: numero e account sono
suoi. È anche ciò che dà al paziente la garanzia di ricevere un messaggio dal
proprio studio di fiducia.

### Le credenziali

Le chiavi dei canali sono **cifrate** (AES-256-GCM) e legate crittograficamente
allo studio: una credenziale copiata sulla riga di un altro studio non è
decifrabile. Non compaiono mai in chiaro nelle risposte dell'API — solo gli
ultimi quattro caratteri, per conferma visiva — né nei log.

---

## 7. La modalità demo

Uno studio può essere marcato come **dimostrativo**. In quel caso usa **sempre**
il canale simulato, anche se ha credenziali reali salvate e canale attivo: da
uno studio demo non può partire nulla di vero. È la garanzia che permette di
fare presentazioni su un'installazione di produzione.

In quella modalità la dashboard mostra:

- una **barra** per cambiare al volo il nome dello studio da mostrare, il tipo
  di attività (dentistico / poliambulatorio / fisioterapia) e **azzerare i
  dati** in meno di un secondo, per passare da un cliente all'altro;
- su ogni appuntamento, un **telefono simulato** che mostra il messaggio come
  apparirebbe al paziente, con i pulsanti cliccabili. Il testo non è
  ricostruito per finta: è esattamente quello che il sistema ha prodotto, e
  premere il pulsante percorre la stessa strada di una risposta vera.

I dati dimostrativi comprendono due settimane di storico con esiti realistici,
così le statistiche mostrano numeri credibili e **identici a ogni
presentazione** (gli esiti sono assegnati per quote esatte, non a caso).

---

## 8. Le statistiche

Calcolate al volo sul periodo scelto:

- **Tasso di conferma** — conferme ricevute sui promemoria inviati
- **Tasso di no-show** — non presentati sulle visite con esito
  (non presentati + completati)
- **Tempo medio di risposta**
- **Dettaglio per stato**

È anche il materiale con cui dimostrare allo studio il ritorno del servizio: i
numeri li produce il sistema, non una stima.

---

## 9. Privacy e sicurezza: le scelte di progetto

**Nessun dato sanitario.** Il sistema registra nome, telefono, data/ora e una
dicitura generica della tipologia. Il campo tipologia è limitato a 40 caratteri
e nell'interfaccia c'è un avviso esplicito: sono vincoli pensati per impedire
che il campo diventi il posto dove si scrive una diagnosi.

**La tipologia non entra nei messaggi.** Non è disponibile tra le variabili dei
modelli, ed è deliberato: comparirebbe nell'anteprima della notifica sul
telefono, leggibile da chiunque abbia il dispositivo in mano.

**Diritto all'oblio.** L'eliminazione di un paziente cancella lui, i suoi
appuntamenti e i suoi promemoria. Le righe del registro eventi restano ma
vengono scollegate: non contengono dati personali, quindi le statistiche
aggregate sopravvivono alla cancellazione.

**Consenso come condizione tecnica.** Senza consenso registrato il sistema non
invia: non è una spunta formale, è una condizione che il codice verifica a ogni
invio.

**Dati in Unione Europea**, database e applicazione.

**Accessi.** Un utente per studio, password di almeno 10 caratteri
modificabile dalla dashboard, protezione contro i tentativi a raffica sul login
(8 tentativi ogni 15 minuti per combinazione indirizzo+email, così un attacco
contro uno studio non blocca gli altri).

---

## 10. Architettura in breve

- **Backend**: Node.js + TypeScript (Fastify), PostgreSQL con Prisma
- **Dashboard**: React + Vite, in italiano
- **Un solo processo** serve API, dashboard e scheduler: nessuna infrastruttura
  complessa, gira su un piccolo server o su una piattaforma gestita
- **157 test automatici** coprono le parti critiche: unicità degli invii
  (compresi scheduler concorrenti e webhook consegnati due volte), transizioni
  di stato, consenso e opt-out, cifratura delle credenziali, orari di silenzio,
  promemoria in ritardo, resilienza alla caduta del database, e il ciclo
  completo di backup e ripristino

### Monitoraggio

`GET /api/health` risponde **503** in tre casi: database irraggiungibile,
scheduler fermo da oltre cinque minuti, oppure **invii che falliscono in
blocco** nelle ultime 24 ore. È l'indirizzo da tenere sotto controllo con un
servizio di uptime esterno.

Il terzo caso è il guasto silenzioso, e merita attenzione: se le credenziali di
uno studio scadono, lo scheduler continua a girare regolarmente e ogni altro
controllo resta verde, mentre nessun messaggio arriva più. La soglia richiede
almeno tre fallimenti che siano almeno la metà dei tentativi, e ignora i numeri
non su WhatsApp — quelli sono dati sbagliati in anagrafica, non un canale rotto.

**Backup.** Il comando `npm run backup` esporta i dati di uno studio in un file
JSON, indipendente dai backup della piattaforma di hosting. Il ciclo esporta →
cancella → ripristina è verificato da test automatici. Le credenziali WhatsApp
non vengono esportate: sono cifrate con una chiave legata all'installazione.
Procedura in [riferimenti/operativita.md](riferimenti/operativita.md).

**Cosa succede se il servizio si ferma.** Lo stato dei promemoria vive sul
database, non in memoria: alla ripartenza lo scheduler riprende da dove era,
senza doppioni e senza perdere ciò che non era ancora partito. L'arretrato
troppo vecchio viene scartato secondo la regola dei 30 minuti.

---

## 11. Cosa il sistema non fa (per ora)

- Non si integra con i gestionali di studio: gli appuntamenti entrano a mano o
  via file CSV
- Non gestisce liste d'attesa automatiche
- Non ha ruoli o utenti multipli per studio
- Non gestisce fatturazione o pagamenti
- Non interpreta i messaggi di testo dei pazienti

---

## Approfondimenti

| Documento | Argomento |
| --- | --- |
| [setup.md](setup.md) | Installazione e attivazione, passo per passo |
| [per-lo-studio.md](per-lo-studio.md) | Il documento da consegnare al cliente |
| [riferimenti/whatsapp-360dialog.md](riferimenti/whatsapp-360dialog.md) | Attivare un canale con 360dialog |
| [riferimenti/whatsapp-collaudo-meta.md](riferimenti/whatsapp-collaudo-meta.md) | Collaudare sul numero di test di Meta |
| [riferimenti/deploy.md](riferimenti/deploy.md) | Deploy e opzioni di hosting |

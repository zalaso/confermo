# Confermo — Panoramica del prodotto

Sistema per ridurre i mancati appuntamenti (no-show) negli studi medici e
dentistici italiani, tramite promemoria automatici su WhatsApp con conferma del
paziente e una dashboard pensata per la segreteria.

Questo documento descrive **cosa fa oggi** il software, **cosa è previsto**, e
**come si installa**. È il riferimento d'insieme; i documenti operativi
(deploy, attivazione di uno studio, consenso pazienti) sono elencati in fondo.

---

## Il problema che risolve

Un appuntamento mancato è tempo perso che non si recupera: la poltrona resta
vuota, un altro paziente avrebbe potuto occuparla. Il promemoria telefonico
funziona ma costa tempo alla segreteria, e spesso non parte. Confermo lo
automatizza e, cosa più importante, chiede al paziente di **confermare o
disdire**: chi disdice in anticipo libera lo slot in tempo per riassegnarlo.

Il valore per lo studio è misurabile e il software lo misura da solo: tasso di
conferma, tasso di no-show, appuntamenti liberati in anticipo.

---

## Funzionalità attuali

### Gestione degli appuntamenti

- **Agenda** con vista Oggi / Prossimi 7 giorni / Tutti i futuri / Passati,
  raggruppata per giornata, con stato a colori di ogni appuntamento.
- **Stati dell'appuntamento**: in attesa → confermato / disdetto / non
  presentato / completato, con transizioni controllate (non si può passare da
  uno stato all'altro in modo incoerente) e correzione degli errori di click.
- **Inserimento manuale** di appuntamenti, con tipologie proposte
  configurabili per studio.
- **Import da CSV**: la segreteria carica un file (esportato dal gestionale o
  compilato a mano) e il sistema crea pazienti e appuntamenti riconoscendo i
  pazienti già presenti dal numero di telefono.
- **Anagrafica pazienti** con ricerca, consenso privacy e stato opt-out.

### Promemoria automatici

- Due promemoria per appuntamento: **48 ore** e **3 ore** prima.
- **Conferma con un tocco**: il paziente riceve un messaggio con i pulsanti
  «Confermo» / «Devo disdire». La risposta aggiorna in automatico lo stato
  dell'appuntamento e compare in tempo reale nella dashboard.
- **Messaggio di ringraziamento** dopo la conferma («Grazie, ti aspettiamo!»).
- **Testi dei messaggi configurabili** per studio, con variabili (nome
  paziente, data, ora, nome studio).

### Regole di invio (pensate per non far fare brutta figura allo studio)

- **Consenso obbligatorio**: senza consenso privacy registrato, il sistema non
  invia nulla a quel paziente.
- **Opt-out automatico**: se il paziente scrive STOP o BASTA, viene marcato e
  non riceve più alcun messaggio; i suoi promemoria in coda vengono annullati.
- **Fascia oraria di silenzio** configurabile (predefinita 21:00–08:00): un
  promemoria che cadrebbe di notte non viene perso, ma rinviato alla prima ora
  utile.
- **Niente promemoria in ritardo**: dopo un'eventuale interruzione del
  servizio, un promemoria che arriverebbe a ridosso dell'appuntamento (o dopo)
  viene scartato invece che inviato.
- **Invio garantito una volta sola**: un promemoria non parte mai due volte per
  lo stesso appuntamento, nemmeno in caso di riavvii o problemi temporanei.

### Messaggi in arrivo dal paziente

- Le risposte con i pulsanti aggiornano l'appuntamento in automatico.
- I messaggi di **testo libero** («posso spostare a giovedì?») non vengono
  interpretati dalla macchina: compaiono in un riquadro «Messaggi da gestire»
  in cima all'agenda, perché li gestisca la segreteria.

### Statistiche

- Tasso di conferma, tasso di no-show, tempo medio di risposta, dettaglio per
  stato, su un periodo scelto. È anche il materiale con cui dimostrare allo
  studio il ritorno del servizio.

### Impostazioni dello studio

- Nome dello studio, tipologie di appuntamento, fascia di silenzio.
- Testi dei tre messaggi (48h, 3h, ringraziamento).
- Configurazione del canale WhatsApp e invio di un messaggio di prova.
- Cambio della password di accesso.

### Modalità demo

- Ogni studio può essere messo in **modalità demo**: usa sempre un canale
  simulato, non invia nulla di reale nemmeno se ci sono credenziali salvate.
- **Telefono simulato**: durante una presentazione, «Invia promemoria adesso»
  mostra il messaggio come apparirebbe sul telefono del paziente, con i pulsanti
  cliccabili; premendo «Confermo» la card dell'agenda diventa verde in diretta.
- **Preparazione rapida**: si cambia il nome dello studio da mostrare, il tipo
  di attività (studio dentistico / poliambulatorio / fisioterapia) e si azzerano
  i dati in meno di un secondo, per passare da un cliente all'altro.
- **Dati dimostrativi realistici**: agenda dei prossimi giorni e due settimane
  di storico con numeri credibili (circa 56% conferme, 13% no-show).

---

## Come è fatto (per chi deve valutarlo tecnicamente)

- **Backend**: Node.js + TypeScript (Fastify), PostgreSQL con Prisma.
- **Dashboard**: React + Vite, in italiano.
- **Un solo processo** serve API, dashboard e programmatore degli invii: niente
  infrastruttura complessa, gira su un piccolo server o su Railway.
- **Multi-studio fin dallo schema dati**: ogni studio è un'entità separata a cui
  tutto è collegato, pur restando oggi un login singolo per studio.
- **WhatsApp tramite un'astrazione**: il resto del sistema non sa quale canale è
  attivo. Oggi esistono un canale simulato (per demo e sviluppo) e
  l'integrazione con **360dialog**; è in preparazione il canale diretto con la
  **Cloud API di Meta**.
- **117 test automatici** coprono le parti critiche: invio garantito una volta
  sola, transizioni di stato, opt-out, cifratura credenziali, fascia di
  silenzio, gestione delle risposte.

### Privacy e GDPR — scelte di progetto

- **Nessun dato clinico**: solo nome, telefono, data e una dicitura generica del
  tipo di appuntamento. Il tipo di appuntamento è limitato a 40 caratteri e non
  è disponibile nei messaggi, perché comparirebbe nella notifica sul telefono.
- **Dati ospitati in Unione Europea**.
- **Credenziali cifrate**: le chiavi dei canali WhatsApp sono cifrate e mai
  mostrate in chiaro.
- **Diritto all'oblio**: cancellazione completa di un paziente e dei suoi dati,
  conservando solo le statistiche aggregate (che non contengono dati personali).
- **Consenso e opt-out** gestiti come descritto sopra.

---

## Funzionalità future

Ordine indicativo, dalla più vicina alla più lontana.

### In preparazione

- **Canale WhatsApp diretto con Meta (Cloud API)**, accanto a 360dialog. Meta
  offre un numero di test gratuito senza verifica aziendale: permette di
  collaudare l'intera integrazione (template, pulsanti, risposte) prima di
  attivarla su uno studio reale, e lascia un secondo canale disponibile in
  alternativa a 360dialog.

### Previste

- **Attivazione self-service del canale WhatsApp** da parte dello studio
  (oggi la configurazione è assistita).
- **Ruoli e utenti multipli** per studio (oggi c'è un accesso unico).
- **Recupero password autonomo** via email (oggi il reset è assistito).

### In valutazione

- **Integrazione con i gestionali di studio** (es. AlfaDocs), per evitare il
  doppio inserimento degli appuntamenti. È l'evoluzione con l'impatto maggiore
  sull'adozione quotidiana.
- **Lista d'attesa**: quando un appuntamento viene disdetto, proporre
  automaticamente lo slot a un altro paziente in attesa.
- **Report periodici** inviati allo studio (es. il riepilogo mensile del
  risparmio).

### Esplicitamente fuori ambito, per ora

Fatturazione e pagamenti, receptionist vocale/telefonica, app mobile dedicata.

---

## Come si installa

Confermo è un'applicazione web: **non si installa nulla sul computer dello
studio**. Gira su un server, e la segreteria vi accede da browser (anche da
telefono o tablet). Servono solo un indirizzo web e le credenziali di accesso.

Ci sono due modi di ospitarlo. La procedura dettagliata è in
[deploy.md](deploy.md); qui il quadro d'insieme.

### Opzione A — Railway (piattaforma gestita)

La via più rapida: ventina di minuti, HTTPS automatico, nessun server da
amministrare.

1. Collegare il repository, scegliere una **regione europea**.
2. Aggiungere un database PostgreSQL (anch'esso in EU).
3. Impostare le variabili d'ambiente (chiavi di sicurezza, indirizzo pubblico).
4. Il deploy si occupa da solo di build, migrazioni del database e avvio.
5. Creare lo studio dimostrativo con un comando di popolamento.

Costo indicativo: il piano gratuito copre le prime demo; per un uso continuativo
si passa a un piano da circa 20 $/mese.

### Opzione B — Server proprio (VPS europeo)

Più economico (~5 €/mese su Hetzner) ma richiede di gestire sistema operativo,
certificati HTTPS e backup. Adatto quando ci sono più studi e si vuole
controllo pieno.

### Requisiti tecnici

- Node.js 22 o superiore, PostgreSQL 16 o superiore.
- Un indirizzo web pubblico in **HTTPS** (necessario anche per WhatsApp).
- In sviluppo, il database è scaricato come dipendenza: non serve installare
  PostgreSQL a mano.

### Sviluppo in locale

Per chi lavora al codice:

```bash
npm install
npm run db:start          # database locale
npm run db:migrate -w apps/api
npm run seed -- --clinic "Studio Demo" --preset dentista
npm run dev:api           # backend
npm run dev:web           # dashboard su http://localhost:5173
```

---

## Attivare i promemoria WhatsApp reali

La demo funziona senza alcuna credenziale. Per inviare messaggi veri, ogni
studio collega il **proprio** canale WhatsApp (numero e account suoi): la
procedura è in [procedura-attivazione-studio.md](procedura-attivazione-studio.md),
e ciò che lo studio deve fornire è in
[cosa-serve-dal-cliente.md](cosa-serve-dal-cliente.md).

Il canale è intestato allo studio perché è lo studio a comunicare con i propri
pazienti: è anche la ragione per cui non serve una struttura societaria del
fornitore per far partire un pilota.

---

## Indice dei documenti

| Documento | A cosa serve |
| --- | --- |
| [deploy.md](deploy.md) | Mettere online il servizio |
| [whatsapp-setup.md](whatsapp-setup.md) | Riferimento completo su 360dialog e i template Meta |
| [procedura-attivazione-studio.md](procedura-attivazione-studio.md) | Foglio di campo per la visita allo studio |
| [cosa-serve-dal-cliente.md](cosa-serve-dal-cliente.md) | Cosa lo studio deve preparare per l'attivazione |
| [modulo-consenso-pazienti.md](modulo-consenso-pazienti.md) | Bozza del consenso per i pazienti |

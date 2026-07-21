# Kit GDPR — [Confermo] · versione bozza da far revisionare

> ⚠️ **Nota importante:** queste sono bozze di lavoro preparate per farti arrivare preparato da un professionista, non documenti finali. Prima di farle firmare a uno studio, falle revisionare da un consulente privacy o un avvocato (spesso il commercialista ha un privacy officer convenzionato). I punti tra parentesi quadre vanno completati con i tuoi dati.

---

## Documento 1 — Nomina a Responsabile del trattamento (art. 28 GDPR)

**ACCORDO PER IL TRATTAMENTO DEI DATI PERSONALI**
ai sensi dell'art. 28 del Regolamento (UE) 2016/679 ("GDPR")

**tra**

**[Denominazione Studio]**, con sede in [indirizzo], P. IVA [•], in persona del titolare Dott. [•] (di seguito, il "**Titolare**")

**e**

**[Nome/Ragione sociale tua]**, con sede in [indirizzo], P. IVA [•] (di seguito, il "**Responsabile**")

### 1. Oggetto
Il Titolare affida al Responsabile il trattamento di dati personali dei propri pazienti, limitatamente a quanto necessario per l'erogazione del servizio "[Confermo]": invio automatico di promemoria degli appuntamenti tramite WhatsApp, raccolta delle conferme/disdette e reportistica statistica sulle presenze.

### 2. Durata
Il presente accordo ha efficacia per tutta la durata del contratto di servizio e cessa con la sua risoluzione, fatti salvi gli obblighi di cancellazione di cui all'art. 8.

### 3. Natura e finalità del trattamento
Raccolta, registrazione, conservazione, consultazione, comunicazione al paziente tramite il canale WhatsApp dello Studio, cancellazione. Finalità esclusiva: gestione dei promemoria e delle conferme degli appuntamenti. È esclusa ogni finalità di marketing.

### 4. Categorie di dati e di interessati
- **Interessati:** pazienti dello Studio che hanno prestato consenso alle comunicazioni via WhatsApp.
- **Dati trattati:** nome e cognome, numero di telefono, data/ora e tipologia generica dell'appuntamento (es. "visita di controllo"), esito di presenza, contenuto delle risposte inviate dal paziente.
- **Il servizio non tratta dati relativi alla salute:** nessuna informazione clinica, diagnosi o prestazione sanitaria specifica viene registrata nel sistema. Il Titolare si impegna a non inserire dati clinici nei campi liberi (note, tipologia appuntamento).

### 5. Obblighi del Responsabile
Il Responsabile si impegna a:
a) trattare i dati solo su istruzione documentata del Titolare e per le finalità di cui all'art. 3;
b) garantire che le persone autorizzate al trattamento siano vincolate alla riservatezza;
c) adottare le misure di sicurezza di cui all'art. 32 GDPR, come descritte nell'Allegato A;
d) assistere il Titolare nel dare seguito alle richieste di esercizio dei diritti degli interessati (accesso, rettifica, cancellazione, opposizione), entro [5] giorni lavorativi dalla richiesta;
e) notificare al Titolare senza ingiustificato ritardo, e comunque entro [24/48] ore dalla scoperta, ogni violazione di dati personali (data breach), fornendo le informazioni necessarie alla eventuale notifica al Garante entro 72 ore;
f) mettere a disposizione le informazioni necessarie a dimostrare il rispetto del presente accordo e consentire verifiche da parte del Titolare, con preavviso di almeno [10] giorni;
g) non trasferire i dati al di fuori dello Spazio Economico Europeo, fatto salvo quanto previsto all'art. 6 per i sub-responsabili.

### 6. Sub-responsabili
Il Titolare autorizza in via generale il ricorso ai seguenti sub-responsabili:

| Sub-responsabile | Servizio | Sede del trattamento |
|---|---|---|
| [Provider hosting, es. Railway/Hetzner] | Infrastruttura e database | UE ([regione]) |
| 360dialog GmbH | Connessione alla piattaforma WhatsApp Business | UE (Germania) |
| Meta Platforms Ireland Ltd / WhatsApp | Recapito dei messaggi | UE/USA — trasferimenti disciplinati da clausole contrattuali standard e dal Data Privacy Framework, secondo i termini WhatsApp Business |

Il Responsabile informa il Titolare di ogni modifica prevista (aggiunta o sostituzione), dando la possibilità di opporsi entro [15] giorni. I sub-responsabili sono vincolati da obblighi equivalenti a quelli del presente accordo.

### 7. Diritti degli interessati e opt-out
Le richieste di cancellazione possono essere eseguite direttamente dal personale dello Studio tramite l'apposita funzione del software, che elimina integralmente i dati identificativi del paziente. La revoca del consenso alle comunicazioni (opt-out) è gestita automaticamente: il paziente che risponde "STOP" non riceve ulteriori messaggi.

### 8. Cancellazione al termine
Alla cessazione del contratto, il Responsabile — a scelta del Titolare — restituisce in formato leggibile (export CSV) e/o cancella integralmente tutti i dati personali entro [30] giorni, salvo obblighi di legge di conservazione. Restano conservati esclusivamente dati statistici aggregati privi di riferimenti identificativi.

### 9. Responsabilità
Ciascuna parte risponde dei danni causati dal trattamento in violazione del GDPR secondo quanto previsto dall'art. 82 GDPR.

Luogo e data: _______________

Il Titolare: _______________  Il Responsabile: _______________

### Allegato A — Misure di sicurezza (art. 32 GDPR)
- Dati ospitati su infrastruttura ubicata nell'Unione Europea
- Cifratura delle comunicazioni in transito (TLS) e delle credenziali di accesso ai canali di messaggistica (AES-256-GCM)
- Accesso al pannello protetto da autenticazione; credenziali API mai visualizzabili in chiaro
- Log applicativi privi di dati personali (numeri di telefono mascherati)
- Registro degli eventi (audit log) privo di dati identificativi, che sopravvive alle cancellazioni senza compromettere il diritto all'oblio
- Funzione di cancellazione integrale del singolo paziente disponibile in autonomia allo Studio
- Backup cifrati con conservazione massima di [30] giorni
- Verifica di autenticità delle notifiche in ingresso dal provider di messaggistica

---

## Documento 2 — Paragrafo da integrare nell'informativa privacy dello Studio

Da consegnare al dentista perché lo faccia aggiungere alla propria informativa pazienti (di solito la gestisce il suo consulente privacy):

> **Promemoria degli appuntamenti tramite WhatsApp.** Previo Suo consenso, lo Studio utilizza un servizio automatico di promemoria degli appuntamenti tramite WhatsApp. A tal fine, il Suo nome, numero di telefono e i dati dell'appuntamento (data, ora e tipologia generica) sono trattati da [Nome/Ragione sociale tua], nominato responsabile del trattamento ai sensi dell'art. 28 GDPR, che si avvale dei fornitori 360dialog GmbH (UE) e Meta Platforms (WhatsApp) per il recapito dei messaggi. Nessun dato relativo al Suo stato di salute viene trasmesso attraverso questo canale. Il conferimento è facoltativo: in assenza di consenso, i promemoria Le saranno forniti con le modalità tradizionali. Può revocare il consenso in qualsiasi momento rispondendo "STOP" a un messaggio o rivolgendosi alla segreteria; la revoca non pregiudica gli appuntamenti già fissati.

## Documento 3 — Formula di consenso (modulo cartaceo o digitale dello Studio)

> ☐ Acconsento a ricevere promemoria dei miei appuntamenti tramite WhatsApp al numero da me indicato, secondo quanto descritto nell'informativa privacy dello Studio.

Nota operativa per lo studio: il consenso va registrato nel software (campo "consenso privacy" sulla scheda paziente) con la data. Senza quel flag, il sistema non invia nulla a quel paziente — per progettazione.

---

## Promemoria per te (non da consegnare)
1. Far revisionare i tre documenti a un professionista **prima** della prima firma
2. Verificare che il DPA di 360dialog sia firmato nel loro Hub (checklist punto 6 della milestone) e archiviarne copia
3. Archiviare copia del DPA del provider di hosting con indicazione della regione EU
4. Quando esisterà l'entità giuridica definitiva, aggiornare i riferimenti in tutti i documenti

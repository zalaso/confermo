# Monitoraggio e backup

Le due cose da sistemare **prima** che nel sistema entrino dati di pazienti
veri. Sono anche le uniche che ti permettono di smettere di guardare il
servizio: finché non ci sono, l'unico monitoraggio sei tu che apri la
dashboard.

---

## 1. Monitoraggio

### Cosa controlla il sistema da solo

`GET /api/health` risponde **200** se tutto va, **503** se qualcosa è rotto.
Risponde 503 in tre casi:

| Situazione | Come se ne accorge |
| --- | --- |
| **Database irraggiungibile** | Una query di prova fallisce |
| **Scheduler in ritardo** | Non completa un giro da più di 5 minuti |
| **Canale WhatsApp rotto** | Gli invii falliscono in blocco nelle ultime 24 ore |

Il terzo è il più importante e il meno ovvio. Se le credenziali di uno studio
scadono o vengono revocate, lo scheduler continua a girare benissimo: senza
questo controllo il monitoraggio resterebbe **verde** mentre nessun paziente
riceve più niente.

La soglia è pensata per non dare falsi allarmi: servono almeno **3 fallimenti**
e devono essere **almeno la metà** dei tentativi. Un numero sbagliato in
anagrafica (`failed_recipient`) non conta: è un problema di dati, non di canale.

Esempio di risposta sana:

```json
{
  "ok": true,
  "database": "ok",
  "scheduler": { "status": "ok", "consecutiveErrors": 0 },
  "deliveries": { "status": "ok", "sentLast24h": 12, "failedLast24h": 0 }
}
```

### Configurare l'avviso esterno

Serve qualcuno che interroghi quell'indirizzo quando tu non ci sei.
**UptimeRobot** è gratuito e basta:

1. Registrati su **uptimerobot.com**
2. **+ New monitor** → tipo **HTTP(s)**
3. **URL**: `https://<tuo-dominio>/api/health`
4. **Monitoring interval**: 5 minuti
5. **Alert contacts**: la tua email (e il numero per gli SMS, se il piano lo
   consente)
6. Salva

Da quel momento ricevi un avviso quando l'endpoint risponde 503 o non risponde
affatto.

**Provalo davvero**: fermare il servizio da Railway per un minuto e verificare
che l'avviso arrivi. Un monitoraggio mai visto scattare non sai se funziona.

### Cosa NON copre

Il monitoraggio vede il servizio, non il singolo studio. Un promemoria fallito
per un numero sbagliato resta visibile solo nella dashboard, sulla card
dell'appuntamento («numero non su WhatsApp»). È corretto così: è la segreteria
a dover correggere il numero, non tu a ricevere una notifica.

---

## 2. Backup

Ci sono due livelli, e servono entrambi.

### Livello 1 — i backup della piattaforma

Railway fa backup automatici del database PostgreSQL.

- [ ] Apri il servizio **Postgres** → scheda **Backups**
- [ ] Verifica che ce ne siano di recenti e con quale frequenza
- [ ] Annota **quanto indietro** si può tornare (la retention dipende dal piano)

Questi backup sono comodi ma hanno un limite: **vivono nello stesso account**.
Se perdi l'accesso a Railway, o il progetto viene cancellato per errore, se ne
vanno con lui.

### Livello 2 — una copia indipendente

Per questo c'è un comando che esporta i dati di uno studio in un file JSON:

```bash
npm run backup -w apps/api -- --list
npm run backup -w apps/api -- --export --clinic "Studio Dentistico Rossi" --out backup.json
```

Il file contiene studio, utenti, testi dei messaggi, pazienti, appuntamenti,
promemoria, messaggi ricevuti e registro eventi.

**Non contiene le credenziali WhatsApp**, di proposito: sono cifrate con una
chiave legata a quell'installazione, quindi altrove sarebbero comunque
illeggibili — e un file di backup non è il posto dove tenerle. Dopo un
ripristino vanno reinserite da Impostazioni.

> ⚠️ Il file contiene **dati personali di pazienti**: nomi, telefoni,
> appuntamenti. Va trattato come tale — conservato cifrato, non lasciato nella
> cartella Download, non mandato via email. Cancellalo quando non serve più.

### Ripristinare

```bash
npm run backup -w apps/api -- --import --in backup.json
```

Se lo studio esiste già viene **sostituito**: è un ripristino, non una fusione.
Gli identificativi originali sono conservati, quindi i collegamenti fra
appuntamenti, pazienti e promemoria restano validi.

### La prova del ripristino

Un backup che non hai mai ripristinato non è un backup. Il ciclo completo —
esporta, cancella, ripristina, confronta — **è coperto da un test automatico**
che gira a ogni esecuzione della suite: verifica che i conteggi tornino, che le
date sopravvivano al passaggio in JSON e che le credenziali non finiscano nel
file.

Ma il test gira su dati di prova. Almeno una volta fallo sul serio:

1. Esporta lo studio dimostrativo
2. Cancella qualche paziente dalla dashboard
3. Reimporta il file
4. Verifica che i pazienti siano tornati

Dieci minuti, e da lì in poi sai che funziona.

### Ogni quanto

Finché c'è un solo studio pilota, un export a mano **una volta a settimana** è
ragionevole, prima di ogni intervento importante. Con più studi conviene
automatizzarlo — quando ci arriverai, il comando c'è già.

---

## Lista di controllo prima dei dati veri

- [ ] Monitoraggio esterno configurato su `/api/health`
- [ ] Avviso ricevuto davvero almeno una volta (prova a fermare il servizio)
- [ ] Backup della piattaforma verificati (esistono, e sai la retention)
- [ ] Un export scaricato e conservato in luogo sicuro
- [ ] Un ripristino provato almeno una volta
- [ ] Piano di hosting a pagamento attivo (il credito di prova finisce)

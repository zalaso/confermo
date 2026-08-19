# Documentazione di Confermo

## I tre documenti principali

| Documento | A cosa serve | A chi |
| --- | --- | --- |
| **[funzionamento.md](funzionamento.md)** | Come funziona il sistema nel dettaglio: regole di invio, stati, privacy, architettura | Te, e chi mette mano al codice |
| **[setup.md](setup.md)** | Procedura passo per passo: dal deploy all'attivazione di uno studio | Te |
| **[per-lo-studio.md](per-lo-studio.md)** | Cosa fa il servizio, cosa serve per attivarlo, cosa non inserire | **Da consegnare allo studio** |

## Da consegnare o far firmare — [modelli/](modelli/)

| File | Contenuto |
| --- | --- |
| [consenso-pazienti.md](modelli/consenso-pazienti.md) | Bozza del consenso che lo studio fa firmare ai pazienti (due versioni) |
| [kit-gdpr.md](modelli/kit-gdpr.md) | Bozza di nomina a responsabile del trattamento (art. 28) e allegati |
| [esempio-import.csv](modelli/esempio-import.csv) | File di esempio per l'importazione degli appuntamenti |

> ⚠️ Le bozze legali vanno **fatte revisionare da un professionista** prima di
> usarle con uno studio reale.

## Approfondimenti tecnici — [riferimenti/](riferimenti/)

| File | Contenuto |
| --- | --- |
| [deploy.md](riferimenti/deploy.md) | Deploy su Railway o su server proprio, variabili d'ambiente |
| [operativita.md](riferimenti/operativita.md) | Monitoraggio e backup: cosa configurare prima dei dati veri |
| [whatsapp-360dialog.md](riferimenti/whatsapp-360dialog.md) | Attivare un canale con 360dialog: procedura completa e testi dei modelli |
| [whatsapp-collaudo-meta.md](riferimenti/whatsapp-collaudo-meta.md) | Collaudare sul numero di test gratuito di Meta, e le trappole incontrate |
| [checklist-attivazione.md](riferimenti/checklist-attivazione.md) | Foglio di campo da avere in mano durante la visita allo studio |

## Vendita — [vendita/](vendita/)

| File | Contenuto |
| --- | --- |
| [kit-pilota.md](vendita/kit-pilota.md) | Come individuare, contattare e chiudere il primo studio pilota |

---

## Da dove partire

- **Devo installare il sistema** → [setup.md](setup.md)
- **Devo fare una demo a uno studio** → [setup.md § Preparare una demo](setup.md#preparare-una-demo)
- **Vado da un cliente** → stampa [per-lo-studio.md](per-lo-studio.md) e porta
  [checklist-attivazione.md](riferimenti/checklist-attivazione.md)
- **Devo attivare WhatsApp per uno studio** → [setup.md § Parte 3](setup.md#parte-3--collegare-il-canale-whatsapp)
- **Voglio capire perché il sistema si comporta così** → [funzionamento.md](funzionamento.md)

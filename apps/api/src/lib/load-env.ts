/**
 * Carica il file .env nella cartella corrente, se esiste.
 *
 * Import a effetto collaterale: va messo per PRIMO in ogni entrypoint
 * (server e script da riga di comando), prima di qualunque import che
 * legga `process.env`. In produzione il file può non esserci: le variabili
 * arrivano dall'ambiente e l'assenza non è un errore.
 */
try {
  process.loadEnvFile();
} catch {
  // .env assente: le variabili possono arrivare dall'ambiente (es. Railway)
}

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cifratura at rest delle credenziali (API key dei canali WhatsApp).
 * AES-256-GCM, chiave a 32 byte da CREDENTIALS_ENCRYPTION_KEY (base64).
 * Formato salvato: "v1:<iv>:<ciphertext>:<authTag>" (base64, IV random da 12 byte).
 *
 * L'AAD lega il ciphertext al suo contesto (usiamo clinic.id): un valore
 * copiato su un'altra riga non decifra.
 */

function loadKey(): Buffer {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'CREDENTIALS_ENCRYPTION_KEY mancante. Genera una chiave con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY non valida: servono 32 byte in base64');
  }
  return key;
}

export function encryptSecret(plaintext: string, aad: string): string {
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${ciphertext.toString('base64')}:${tag.toString('base64')}`;
}

export function decryptSecret(stored: string, aad: string): string {
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Credenziale in formato non riconosciuto');
  }
  const [, ivB64, ctB64, tagB64] = parts;
  const key = loadKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64!, 'base64'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagB64!, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64!, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}

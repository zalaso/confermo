import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret } from '../../src/lib/crypto.js';

const KEY = randomBytes(32).toString('base64');
let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  process.env.CREDENTIALS_ENCRYPTION_KEY = KEY;
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY;
  else process.env.CREDENTIALS_ENCRYPTION_KEY = savedKey;
});

describe('cifratura credenziali (AES-256-GCM)', () => {
  it('roundtrip: cifra e decifra con la stessa AAD', () => {
    const stored = encryptSecret('sk-api-key-segreta', 'clinic-123');
    expect(stored.startsWith('v1:')).toBe(true);
    expect(stored).not.toContain('segreta');
    expect(decryptSecret(stored, 'clinic-123')).toBe('sk-api-key-segreta');
  });

  it('due cifrature dello stesso valore producono ciphertext diversi (IV random)', () => {
    const a = encryptSecret('stesso-valore', 'clinic-123');
    const b = encryptSecret('stesso-valore', 'clinic-123');
    expect(a).not.toBe(b);
  });

  it('AAD diversa (ciphertext copiato su altra clinic) → la decifratura fallisce', () => {
    const stored = encryptSecret('sk-api-key', 'clinic-A');
    expect(() => decryptSecret(stored, 'clinic-B')).toThrow();
  });

  it('ciphertext manomesso → la decifratura fallisce', () => {
    const stored = encryptSecret('sk-api-key', 'clinic-A');
    const parts = stored.split(':');
    const ct = Buffer.from(parts[2]!, 'base64');
    ct[0] = ct[0]! ^ 0xff;
    parts[2] = ct.toString('base64');
    expect(() => decryptSecret(parts.join(':'), 'clinic-A')).toThrow();
  });

  it('formato non riconosciuto → errore chiaro', () => {
    expect(() => decryptSecret('roba-a-caso', 'clinic-A')).toThrow(/formato/i);
  });

  it('chiave mancante → errore con istruzioni', () => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    expect(() => encryptSecret('x', 'clinic-A')).toThrow(/CREDENTIALS_ENCRYPTION_KEY/);
  });

  it('chiave di lunghezza sbagliata → errore', () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = Buffer.from('corta').toString('base64');
    expect(() => encryptSecret('x', 'clinic-A')).toThrow(/32 byte/);
  });
});

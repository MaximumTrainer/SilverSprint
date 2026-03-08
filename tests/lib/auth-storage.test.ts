import { describe, it, expect } from 'vitest';
import { encryptCredentials, decryptCredentials, _TEST_PBKDF2_PASSPHRASE, _TEST_PBKDF2_SALT } from '../../src/lib/auth-storage';

describe('auth-storage encryption', () => {
  it('round-trips credentials through encrypt → decrypt', async () => {
    const credentials = { athleteId: 'i12345', apiKey: 'abc-secret-key' };
    const encrypted = await encryptCredentials(credentials);
    const decrypted = await decryptCredentials(encrypted);
    expect(decrypted).toEqual(credentials);
  });

  it('produces a non-empty base64 string that does not expose the plain credentials', async () => {
    const credentials = { athleteId: 'i99999', apiKey: 'super-secret' };
    const encrypted = await encryptCredentials(credentials);
    expect(typeof encrypted).toBe('string');
    expect(encrypted.length).toBeGreaterThan(0);
    expect(encrypted).not.toContain('i99999');
    expect(encrypted).not.toContain('super-secret');
  });

  it('produces different ciphertext on each call (random IV)', async () => {
    const credentials = { athleteId: 'i12345', apiKey: 'abc-secret-key' };
    const enc1 = await encryptCredentials(credentials);
    const enc2 = await encryptCredentials(credentials);
    expect(enc1).not.toBe(enc2);
  });

  it('returns null for an empty string', async () => {
    expect(await decryptCredentials('')).toBeNull();
  });

  it('returns null for arbitrary invalid data', async () => {
    expect(await decryptCredentials('not-valid-base64!!!')).toBeNull();
  });

  it('returns null for valid base64 that is not a valid ciphertext', async () => {
    const garbage = btoa('this is not a real ciphertext');
    expect(await decryptCredentials(garbage)).toBeNull();
  });

  it('returns null when decrypted JSON has missing fields', async () => {
    // Encrypt something that is valid JSON but not AuthCredentials, using the
    // same key derivation as the module under test.
    const key = await (async () => {
      const km = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(_TEST_PBKDF2_PASSPHRASE),
        'PBKDF2',
        false,
        ['deriveKey'],
      );
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: new TextEncoder().encode(_TEST_PBKDF2_SALT), iterations: 100_000, hash: 'SHA-256' },
        km,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    })();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify({ foo: 'bar' }));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);
    const encoded = btoa(String.fromCharCode(...combined));

    expect(await decryptCredentials(encoded)).toBeNull();
  });
});

import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { decryptRefreshToken, encryptRefreshToken } from './token-encryption';

describe('token-encryption', () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });

  it('round-trips a plaintext token through encrypt/decrypt', () => {
    const plaintext = '1//0gExampleRefreshTokenValue';
    const encrypted = encryptRefreshToken(plaintext);
    expect(decryptRefreshToken(encrypted)).toBe(plaintext);
  });

  it('produces a different ciphertext (different IV) for the same plaintext on each call', () => {
    const plaintext = 'same-token-every-time';
    const first = encryptRefreshToken(plaintext);
    const second = encryptRefreshToken(plaintext);
    expect(first).not.toBe(second);
    expect(decryptRefreshToken(first)).toBe(plaintext);
    expect(decryptRefreshToken(second)).toBe(plaintext);
  });

  it('throws instead of returning garbage when the ciphertext has been tampered with', () => {
    const encrypted = encryptRefreshToken('tamper-detection-test');
    const [iv, authTag, ciphertext] = encrypted.split('.') as [string, string, string];
    const tamperedBytes = Buffer.from(ciphertext, 'base64');
    tamperedBytes[0] = (tamperedBytes[0] ?? 0) ^ 0xff;
    const tampered = [iv, authTag, tamperedBytes.toString('base64')].join('.');
    expect(() => decryptRefreshToken(tampered)).toThrow();
  });

  it('throws on a malformed encrypted value', () => {
    expect(() => decryptRefreshToken('not-the-right-shape')).toThrow(
      'Malformed encrypted refresh token',
    );
  });

  it('throws a clear error when TOKEN_ENCRYPTION_KEY is missing', () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encryptRefreshToken('anything')).toThrow('TOKEN_ENCRYPTION_KEY is not set');
  });

  it('throws a clear error when TOKEN_ENCRYPTION_KEY is the wrong length', () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.from('too-short').toString('base64');
    expect(() => encryptRefreshToken('anything')).toThrow('must decode to exactly 32 bytes');
  });
});

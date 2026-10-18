import { describe, it, expect } from 'vitest';
import {
  generateAesKey,
  encryptFile,
  decryptFile,
  exportAesKey,
  importAesKey,
} from '../aes.js';
import {
  generateRsaKeyPair,
  exportPublicKey,
  importPublicKey,
  exportPrivateKey,
  importPrivateKey,
  wrapAesKey,
  unwrapAesKey,
} from '../rsa.js';
import { computeFileHash } from '../hash.js';

describe('1. AES-256-GCM Client-Side Cryptography (aes.js)', () => {
  const samplePlaintext = new TextEncoder().encode(
    'PATIENT MEDICAL RECORD: Patient ID #9482. Blood Pressure 120/80. Diagnosis: Healthy. Lab Notes: Stable.'
  );

  it('Should successfully encrypt and decrypt original file data (round trip)', async () => {
    const key = await generateAesKey();
    const { ciphertext, iv } = await encryptFile(samplePlaintext, key);

    expect(ciphertext).toBeInstanceOf(Uint8Array);
    expect(iv).toBeInstanceOf(Uint8Array);
    expect(iv.length).toBe(12); // Non-negotiable 12-byte IV

    // Ciphertext must not equal plaintext
    expect(ciphertext).not.toEqual(samplePlaintext);

    // Decrypt
    const decrypted = await decryptFile(ciphertext, iv, key);
    expect(new TextDecoder().decode(decrypted)).toBe(new TextDecoder().decode(samplePlaintext));
  });

  it('Should FAIL decryption when using a wrong AES key', async () => {
    const correctKey = await generateAesKey();
    const wrongKey = await generateAesKey();

    const { ciphertext, iv } = await encryptFile(samplePlaintext, correctKey);

    await expect(decryptFile(ciphertext, iv, wrongKey)).rejects.toThrow();
  });

  it('Should FAIL decryption if ciphertext is tampered with by even 1 byte (GCM auth tag check)', async () => {
    const key = await generateAesKey();
    const { ciphertext, iv } = await encryptFile(samplePlaintext, key);

    // Create tampered copy by flipping the first byte
    const tamperedCiphertext = new Uint8Array(ciphertext);
    tamperedCiphertext[0] ^= 0xff;

    await expect(decryptFile(tamperedCiphertext, iv, key)).rejects.toThrow();
  });

  it('Should FAIL decryption if IV is tampered with', async () => {
    const key = await generateAesKey();
    const { ciphertext, iv } = await encryptFile(samplePlaintext, key);

    const tamperedIv = new Uint8Array(iv);
    tamperedIv[0] ^= 0x01;

    await expect(decryptFile(ciphertext, tamperedIv, key)).rejects.toThrow();
  });

  it('Should export and re-import raw AES key maintaining decryption capability', async () => {
    const key = await generateAesKey();
    const { ciphertext, iv } = await encryptFile(samplePlaintext, key);

    const rawBytes = await exportAesKey(key);
    expect(rawBytes.length).toBe(32); // 256 bits

    const importedKey = await importAesKey(rawBytes);
    const decrypted = await decryptFile(ciphertext, iv, importedKey);
    expect(new TextDecoder().decode(decrypted)).toBe(new TextDecoder().decode(samplePlaintext));
  });
});

describe('2. RSA-OAEP Public-Key Wrapping & Envelope Encryption (rsa.js)', () => {
  it('Should export and import RSA public and private keys without corruption', async () => {
    const keyPair = await generateRsaKeyPair();

    const pubBase64 = await exportPublicKey(keyPair.publicKey);
    const privBase64 = await exportPrivateKey(keyPair.privateKey);

    expect(typeof pubBase64).toBe('string');
    expect(typeof privBase64).toBe('string');

    const importedPub = await importPublicKey(pubBase64);
    const importedPriv = await importPrivateKey(privBase64);

    expect(importedPub.type).toBe('public');
    expect(importedPriv.type).toBe('private');
  });

  it('Should wrap AES key with recipient public key and unwrap with recipient private key', async () => {
    // 1. Hospital generates its RSA key pair
    const hospitalKeyPair = await generateRsaKeyPair();

    // 2. Patient generates AES key and encrypts record
    const aesKey = await generateAesKey();
    const sampleData = new TextEncoder().encode('Confidential MRI Scan Data');
    const { ciphertext, iv } = await encryptFile(sampleData, aesKey);

    // 3. Patient wraps AES key using Hospital Public Key
    const wrappedKeyEnvelope = await wrapAesKey(aesKey, hospitalKeyPair.publicKey);
    expect(typeof wrappedKeyEnvelope).toBe('string');

    // 4. Hospital unwraps AES key using its RSA Private Key
    const unwrappedAesKey = await unwrapAesKey(wrappedKeyEnvelope, hospitalKeyPair.privateKey);

    // 5. Hospital decrypts ciphertext with reconstituted AES key
    const decryptedData = await decryptFile(ciphertext, iv, unwrappedAesKey);
    expect(new TextDecoder().decode(decryptedData)).toBe('Confidential MRI Scan Data');
  });

  it('Should FAIL unwrapping when attempted with a wrong RSA private key', async () => {
    const hospitalA = await generateRsaKeyPair();
    const hospitalB = await generateRsaKeyPair(); // Unauthorized hospital

    const aesKey = await generateAesKey();
    // Patient wraps AES key for Hospital A
    const wrappedKey = await wrapAesKey(aesKey, hospitalA.publicKey);

    // Hospital B attempts to unwrap key meant for Hospital A -> Must reject
    await expect(unwrapAesKey(wrappedKey, hospitalB.privateKey)).rejects.toThrow();
  });
});

describe('3. SHA-256 Original File Tamper Detection (hash.js)', () => {
  const originalFile = new TextEncoder().encode(
    'Lab Test Report: Glucose 95 mg/dL, Cholesterol 180 mg/dL'
  );

  it('Should return deterministic 0x-prefixed 64-char hex string (Solidity bytes32 format)', async () => {
    const hash1 = await computeFileHash(originalFile);
    const hash2 = await computeFileHash(originalFile);

    expect(hash1).toMatch(/^0x[a-f0-9]{64}$/);
    expect(hash1).toBe(hash2);
  });

  it('Should produce a completely different hash if even ONE byte changes', async () => {
    const originalHash = await computeFileHash(originalFile);

    // Modify a single character: 'Glucose 95' -> 'Glucose 96'
    const tamperedFile = new Uint8Array(originalFile);
    tamperedFile[25] = '6'.charCodeAt(0);

    const tamperedHash = await computeFileHash(tamperedFile);

    expect(tamperedHash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(tamperedHash).not.toBe(originalHash);
  });
});

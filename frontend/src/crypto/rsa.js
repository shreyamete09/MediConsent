/**
 * @file rsa.js
 * @notice Client-Side RSA-OAEP Key Pair Generation & Envelope Encryption
 * 
 * ============================================================================
 * SECURITY ARCHITECTURE & KEY WRAPPING:
 * 
 * 1. HOW KEY WRAPPING WORKS:
 *    - Medical files are encrypted with symmetric AES-256-GCM (fast, handles large files).
 *    - To share the record with Hospital B, the patient's browser exports the raw
 *      AES key bytes and WRAPS (encrypts) them using Hospital B's RSA-OAEP 2048-bit
 *      Public Key (fetched immutably from the smart contract).
 *    - The resulting "wrapped key" can ONLY be decrypted by Hospital B, because only
 *      Hospital B possesses the corresponding RSA Private Key.
 * 
 * 2. ZERO-KNOWLEDGE & PRIVATE KEY HANDLING:
 *    - Private keys NEVER leave the browser, are NEVER sent to the backend, and
 *      are NEVER logged to console.
 *    - Plain localStorage storage of private keys carries XSS extraction risks;
 *      in production, private keys must be stored in IndexedDB with user-passphrase
 *      encryption or hardware WebAuthn credentials.
 * ============================================================================
 */

import { exportAesKey, importAesKey } from './aes.js';

const getSubtleCrypto = () => {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
    return window.crypto.subtle;
  }
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
    return globalThis.crypto.subtle;
  }
  throw new Error('Web Crypto API (crypto.subtle) is not supported in this environment');
};

/**
 * Helper: ArrayBuffer to Base64
 */
export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Helper: Base64 to Uint8Array
 */
export function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Generates an RSA-OAEP 2048-bit key pair using SHA-256.
 * @returns {Promise<CryptoKeyPair>}
 */
export async function generateRsaKeyPair() {
  const subtle = getSubtleCrypto();
  return subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]), // 65537
      hash: 'SHA-256',
    },
    true, // extractable
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
  );
}

/**
 * Exports an RSA Public Key to Base64 SPKI format (suitable for on-chain contract storage).
 * @param {CryptoKey} publicKey
 * @returns {Promise<string>} Base64 encoded SPKI string
 */
export async function exportPublicKey(publicKey) {
  const subtle = getSubtleCrypto();
  const spki = await subtle.exportKey('spki', publicKey);
  return arrayBufferToBase64(spki);
}

/**
 * Imports an RSA Public Key from Base64 SPKI format.
 * @param {string} spkiBase64
 * @returns {Promise<CryptoKey>}
 */
export async function importPublicKey(spkiBase64) {
  const subtle = getSubtleCrypto();
  const bytes = base64ToUint8Array(spkiBase64);
  return subtle.importKey(
    'spki',
    bytes,
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'wrapKey']
  );
}

/**
 * Exports an RSA Private Key to Base64 PKCS#8 format.
 * @param {CryptoKey} privateKey
 * @returns {Promise<string>} Base64 encoded PKCS#8 string
 */
export async function exportPrivateKey(privateKey) {
  const subtle = getSubtleCrypto();
  const pkcs8 = await subtle.exportKey('pkcs8', privateKey);
  return arrayBufferToBase64(pkcs8);
}

/**
 * Imports an RSA Private Key from Base64 PKCS#8 format.
 * @param {string} pkcs8Base64
 * @returns {Promise<CryptoKey>}
 */
export async function importPrivateKey(pkcs8Base64) {
  const subtle = getSubtleCrypto();
  const bytes = base64ToUint8Array(pkcs8Base64);
  return subtle.importKey(
    'pkcs8',
    bytes,
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256',
    },
    true,
    ['decrypt', 'unwrapKey']
  );
}

/**
 * Wraps an AES-GCM symmetric key with the recipient's RSA-OAEP public key.
 * Only the recipient with the corresponding RSA private key can unwrap it.
 * @param {CryptoKey} aesKey - The symmetric key to protect
 * @param {CryptoKey} recipientRsaPublicKey - The recipient's RSA public key
 * @returns {Promise<string>} Base64 encoded wrapped key envelope
 */
export async function wrapAesKey(aesKey, recipientRsaPublicKey) {
  const subtle = getSubtleCrypto();
  const rawAesBytes = await exportAesKey(aesKey);

  const encryptedKeyBuffer = await subtle.encrypt(
    { name: 'RSA-OAEP' },
    recipientRsaPublicKey,
    rawAesBytes
  );

  return arrayBufferToBase64(encryptedKeyBuffer);
}

/**
 * Unwraps an encrypted AES key envelope using the recipient's RSA-OAEP private key.
 * @param {string} wrappedKeyBase64 - Base64 encoded wrapped key envelope
 * @param {CryptoKey} recipientRsaPrivateKey - The recipient's RSA private key
 * @returns {Promise<CryptoKey>} Reconstituted AES-GCM CryptoKey
 */
export async function unwrapAesKey(wrappedKeyBase64, recipientRsaPrivateKey) {
  const subtle = getSubtleCrypto();
  const encryptedBytes = base64ToUint8Array(wrappedKeyBase64);

  const rawAesBytes = await subtle.decrypt(
    { name: 'RSA-OAEP' },
    recipientRsaPrivateKey,
    encryptedBytes
  );

  return importAesKey(rawAesBytes);
}

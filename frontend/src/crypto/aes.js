/**
 * @file aes.js
 * @notice Client-Side AES-256-GCM File Encryption & Decryption
 * 
 * SECURITY MANDATE:
 * 1. Encryption and decryption MUST happen solely within the user's browser.
 * 2. A fresh, cryptographically random 96-bit (12-byte) Initialization Vector (IV)
 *    is generated for every single file to prevent nonce reuse attacks.
 * 3. AES-GCM provides authenticated encryption: if even a single bit of the ciphertext
 *    or IV is tampered with, decryption will fail at the authentication tag verification.
 */

// Use browser crypto or Node 18+ globalThis.crypto
const getSubtleCrypto = () => {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
    return window.crypto.subtle;
  }
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
    return globalThis.crypto.subtle;
  }
  throw new Error('Web Crypto API (crypto.subtle) is not supported in this environment');
};

const getCrypto = () => {
  if (typeof window !== 'undefined' && window.crypto) {
    return window.crypto;
  }
  if (typeof globalThis !== 'undefined' && globalThis.crypto) {
    return globalThis.crypto;
  }
  throw new Error('Crypto API is not available');
};

/**
 * Generates a fresh, extractable 256-bit AES-GCM symmetric key.
 * @returns {Promise<CryptoKey>}
 */
export async function generateAesKey() {
  const subtle = getSubtleCrypto();
  return subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true, // extractable so it can be wrapped with recipient's public key
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts a binary file buffer using AES-256-GCM with a fresh 12-byte IV.
 * @param {ArrayBuffer|Uint8Array} fileData - The plaintext medical record bytes
 * @param {CryptoKey} aesKey - The 256-bit AES-GCM symmetric key
 * @returns {Promise<{ ciphertext: Uint8Array, iv: Uint8Array }>}
 */
export async function encryptFile(fileData, aesKey) {
  const subtle = getSubtleCrypto();
  const cryptoObj = getCrypto();

  // Fresh 12-byte (96-bit) IV generated per file - Non-negotiable rule
  const iv = cryptoObj.getRandomValues(new Uint8Array(12));

  const buffer = fileData instanceof Uint8Array ? fileData : new Uint8Array(fileData);

  const encryptedBuffer = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
      tagLength: 128, // 128-bit authentication tag appended automatically
    },
    aesKey,
    buffer
  );

  return {
    ciphertext: new Uint8Array(encryptedBuffer),
    iv: iv,
  };
}

/**
 * Decrypts AES-256-GCM ciphertext, automatically verifying the authentication tag.
 * @param {Uint8Array} ciphertext - The encrypted bytes (includes 16-byte auth tag)
 * @param {Uint8Array} iv - The 12-byte IV used during encryption
 * @param {CryptoKey} aesKey - The 256-bit AES-GCM symmetric key
 * @returns {Promise<Uint8Array>} The decrypted plaintext bytes
 * @throws {Error} Throws if key is incorrect or ciphertext/tag was tampered with
 */
export async function decryptFile(ciphertext, iv, aesKey) {
  const subtle = getSubtleCrypto();

  const decryptedBuffer = await subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv,
      tagLength: 128,
    },
    aesKey,
    ciphertext
  );

  return new Uint8Array(decryptedBuffer);
}

/**
 * Exports an AES CryptoKey to raw 32-byte array for wrapping.
 * @param {CryptoKey} aesKey
 * @returns {Promise<Uint8Array>}
 */
export async function exportAesKey(aesKey) {
  const subtle = getSubtleCrypto();
  const raw = await subtle.exportKey('raw', aesKey);
  return new Uint8Array(raw);
}

/**
 * Imports raw 32-byte array back into an AES-GCM CryptoKey.
 * @param {Uint8Array|ArrayBuffer} rawBytes
 * @returns {Promise<CryptoKey>}
 */
export async function importAesKey(rawBytes) {
  const subtle = getSubtleCrypto();
  return subtle.importKey(
    'raw',
    rawBytes,
    {
      name: 'AES-GCM',
      length: 256,
    },
    true,
    ['encrypt', 'decrypt']
  );
}

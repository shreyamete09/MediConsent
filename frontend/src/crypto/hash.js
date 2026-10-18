/**
 * @file hash.js
 * @notice Client-Side SHA-256 Integrity Hashing for On-Chain Tamper Detection
 * 
 * SECURITY MANDATE:
 * 1. The hash MUST be computed on the ORIGINAL, PLAINTEXT file before encryption.
 * 2. The resulting SHA-256 hash is committed to the blockchain in MediConsent.sol
 *    (stored as a bytes32 recordHash).
 * 3. Any third party or patient can later verify data integrity by downloading the
 *    decrypted file, computing its hash, and calling verifyRecord(recordId, hash).
 * 4. If even a single byte or pixel of the file changes, the SHA-256 avalanche effect
 *    causes an entirely different hash, immediately exposing data tampering.
 */

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
 * Computes the SHA-256 hash of the original file data.
 * @param {ArrayBuffer|Uint8Array} fileData - The plaintext file bytes
 * @returns {Promise<string>} 0x-prefixed 32-byte hexadecimal string (Solidity bytes32)
 */
export async function computeFileHash(fileData) {
  const subtle = getSubtleCrypto();
  const buffer = fileData instanceof Uint8Array ? fileData : new Uint8Array(fileData);

  const hashBuffer = await subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hexString = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  return `0x${hexString}`;
}

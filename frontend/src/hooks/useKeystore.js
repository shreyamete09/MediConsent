/**
 * @file useKeystore.js
 * @notice Manages RSA-OAEP key pair lifecycle for a connected wallet address.
 *
 * STORAGE WARNING (XSS RISK):
 * Private keys are stored in localStorage under a wallet-scoped key.
 * localStorage is accessible to any JavaScript running on the same origin.
 * An XSS vulnerability could expose the private key to an attacker.
 * For production: migrate to IndexedDB with a user passphrase (PBKDF2-derived)
 * wrapping the private key before storage, or use WebAuthn hardware credentials.
 * This implementation is intentionally simplified for hackathon/demo purposes.
 */

import { useState, useEffect, useCallback } from "react";
import {
  generateRsaKeyPair,
  exportPublicKey,
  exportPrivateKey,
  importPublicKey,
  importPrivateKey,
} from "../crypto/rsa.js";

const STORAGE_PREFIX = "mediconsent_keystore_";

/**
 * Builds the localStorage key for a given wallet address.
 */
function storageKey(address) {
  return `${STORAGE_PREFIX}${address.toLowerCase()}`;
}

/**
 * useKeystore hook — generates, persists, exports, and imports RSA key pairs.
 * @param {string|null} account - Currently connected wallet address
 * @returns {{ publicKey, privateKey, publicKeyB64, isLoading, error, downloadBackup, importFromFile }}
 */
export function useKeystore(account) {
  const [keyPair, setKeyPair] = useState({ publicKey: null, privateKey: null });
  const [publicKeyB64, setPublicKeyB64] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load or generate key pair when account changes
  useEffect(() => {
    if (!account) {
      setKeyPair({ publicKey: null, privateKey: null });
      setPublicKeyB64(null);
      return;
    }

    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const stored = localStorage.getItem(storageKey(account));
        if (stored) {
          const { publicKeyB64: pubB64, privateKeyB64: privB64 } = JSON.parse(stored);
          const pub = await importPublicKey(pubB64);
          const priv = await importPrivateKey(privB64);
          setKeyPair({ publicKey: pub, privateKey: priv });
          setPublicKeyB64(pubB64);
        } else {
          // First visit — generate a fresh key pair
          const pair = await generateRsaKeyPair();
          const pubB64 = await exportPublicKey(pair.publicKey);
          const privB64 = await exportPrivateKey(pair.privateKey);

          // WARNING: XSS risk — see file header
          localStorage.setItem(
            storageKey(account),
            JSON.stringify({ publicKeyB64: pubB64, privateKeyB64: privB64, createdAt: Date.now() })
          );

          setKeyPair({ publicKey: pair.publicKey, privateKey: pair.privateKey });
          setPublicKeyB64(pubB64);
        }
      } catch (err) {
        setError(`Keystore error: ${err.message}`);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [account]);

  /**
   * Downloads a JSON backup of the current key pair.
   * The file is named mediconsent-keystore-<shortAddr>.json.
   */
  const downloadBackup = useCallback(async () => {
    if (!account || !keyPair.publicKey || !keyPair.privateKey) return;
    try {
      const pubB64 = await exportPublicKey(keyPair.publicKey);
      const privB64 = await exportPrivateKey(keyPair.privateKey);
      const backup = {
        version: 1,
        account: account.toLowerCase(),
        createdAt: new Date().toISOString(),
        publicKeyB64: pubB64,
        privateKeyB64: privB64,
        warning:
          "KEEP THIS FILE SECURE. Anyone with this file can decrypt your medical records.",
      };

      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mediconsent-keystore-${account.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(`Backup failed: ${err.message}`);
    }
  }, [account, keyPair]);

  /**
   * Imports a previously-exported JSON keystore file.
   * @param {File} file - The .json backup file
   */
  const importFromFile = useCallback(
    async (file) => {
      if (!account || !file) return;
      setError(null);
      try {
        const text = await file.text();
        const backup = JSON.parse(text);

        if (!backup.publicKeyB64 || !backup.privateKeyB64) {
          throw new Error("Invalid keystore file format");
        }

        const pub = await importPublicKey(backup.publicKeyB64);
        const priv = await importPrivateKey(backup.privateKeyB64);

        // WARNING: XSS risk — see file header
        localStorage.setItem(
          storageKey(account),
          JSON.stringify({
            publicKeyB64: backup.publicKeyB64,
            privateKeyB64: backup.privateKeyB64,
            createdAt: Date.now(),
          })
        );

        setKeyPair({ publicKey: pub, privateKey: priv });
        setPublicKeyB64(backup.publicKeyB64);
      } catch (err) {
        setError(`Import failed: ${err.message}`);
      }
    },
    [account]
  );

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    publicKeyB64,
    isLoading,
    error,
    downloadBackup,
    importFromFile,
  };
}

/**
 * @file storage.js
 * @notice Unified storage layer: Pinata IPFS with Local Disk Fallback.
 * 
 * SECURITY MANDATE (ZERO-KNOWLEDGE ARCHITECTURE):
 * The server is an untrusted blind storage relay. Files handled by this module
 * are ALREADY ENCRYPTED client-side in the patient or hospital's browser using
 * AES-256-GCM.
 * 
 * 1. The server NEVER sees plaintext Protected Health Information (PHI).
 * 2. The server NEVER holds private keys or decryption secrets.
 * 3. The server MUST NEVER log file buffers, base64 strings, or decrypted contents.
 * 
 * Even with complete root access to this server or IPFS node, an adversary
 * obtains only high-entropy random ciphertext.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const FormData = require("form-data");

const UPLOADS_DIR = path.resolve(__dirname, "../../storage/uploads");

// Ensure local storage directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Strict CID alphanumeric format: allows IPFS CIDv0 (Qm...), CIDv1 (bafy...), and local mock CIDs (QmLocal...)
const STRICT_CID_REGEX = /^[a-zA-Z0-9]{10,90}$/;

/**
 * Stores an already-encrypted file buffer either on IPFS via Pinata or local disk fallback.
 * @param {Buffer} fileBuffer - Encrypted ciphertext bytes
 * @param {string} originalName - Original filename (for Pinata metadata only)
 * @returns {Promise<{ cid: string, storage: "pinata" | "local", size: number }>}
 */
async function storeEncryptedFile(fileBuffer, originalName = "encrypted_record.bin") {
  const useLocalStorage = process.env.USE_LOCAL_STORAGE === "true";
  const pinataJwt = process.env.PINATA_JWT;

  // 1. Production Mode: Pin to Pinata IPFS if configured
  if (!useLocalStorage && pinataJwt && pinataJwt.trim().length > 0) {
    try {
      const formData = new FormData();
      formData.append("file", fileBuffer, { filename: originalName });

      const metadata = JSON.stringify({
        name: `mediconsent_${Date.now()}_${originalName}`,
      });
      formData.append("pinataMetadata", metadata);

      const options = JSON.stringify({ cidVersion: 0 });
      formData.append("pinataOptions", options);

      const response = await axios.post(
        "https://api.pinata.cloud/pinning/pinFileToIPFS",
        formData,
        {
          headers: {
            Authorization: `Bearer ${pinataJwt}`,
            ...formData.getHeaders(),
          },
          maxBodyLength: Infinity,
        }
      );

      return {
        cid: response.data.IpfsHash,
        storage: "pinata",
        size: fileBuffer.length,
      };
    } catch (pinataError) {
      console.warn(
        `[Storage Service] Pinata IPFS upload failed (${pinataError.message}). Falling back to local disk storage.`
      );
      // Fall through to local fallback
    }
  }

  // 2. Dev / Fallback Mode: Store to local disk with deterministic SHA-256 mock CID
  const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
  // QmLocal + first 39 chars of hash => 46-character mock CID matching IPFS CIDv0 length
  const mockCid = `QmLocal${hash.slice(0, 39)}`;

  const filePath = path.resolve(UPLOADS_DIR, `${mockCid}.bin`);
  await fs.promises.writeFile(filePath, fileBuffer);

  return {
    cid: mockCid,
    storage: "local",
    size: fileBuffer.length,
  };
}

/**
 * Retrieves an encrypted file buffer by CID with strict path traversal prevention.
 * @param {string} cid - IPFS CID or local mock CID
 * @returns {Promise<{ stream?: fs.ReadStream, buffer?: Buffer, size: number, source: string }>}
 */
async function getEncryptedFile(cid) {
  // Strict format validation
  if (!cid || typeof cid !== "string" || !STRICT_CID_REGEX.test(cid)) {
    const error = new Error("Invalid CID format: must be alphanumeric (10-90 characters)");
    error.statusCode = 400;
    throw error;
  }

  // Path Traversal Security Verification:
  // Normalize and resolve path, ensuring it strictly resides within UPLOADS_DIR
  const resolvedPath = path.resolve(UPLOADS_DIR, `${cid}.bin`);
  const normalizedUploadsDir = path.normalize(UPLOADS_DIR) + path.sep;

  if (!resolvedPath.startsWith(normalizedUploadsDir)) {
    const error = new Error("Access Denied: Path traversal detected");
    error.statusCode = 403;
    throw error;
  }

  // Check if file exists locally
  if (fs.existsSync(resolvedPath)) {
    const stat = await fs.promises.stat(resolvedPath);
    const stream = fs.createReadStream(resolvedPath);
    return {
      stream,
      size: stat.size,
      source: "local",
    };
  }

  // If not local, and it is a real IPFS CID, fetch from Pinata Gateway
  const gateway = process.env.PINATA_GATEWAY || "https://gateway.pinata.cloud/ipfs";
  try {
    const response = await axios.get(`${gateway}/${cid}`, {
      responseType: "arraybuffer",
      timeout: 10000,
    });

    return {
      buffer: Buffer.from(response.data),
      size: response.data.length,
      source: "pinata_gateway",
    };
  } catch (gatewayError) {
    const error = new Error(`File not found for CID: ${cid}`);
    error.statusCode = 404;
    throw error;
  }
}

module.exports = {
  storeEncryptedFile,
  getEncryptedFile,
  STRICT_CID_REGEX,
  UPLOADS_DIR,
};

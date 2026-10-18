/**
 * @file file.js
 * @notice Route handler for GET /file/:cid.
 *
 * SECURITY DESIGN:
 * Encrypted ciphertext is served freely because without the AES key it is
 * indecipherable ciphertext. The AES key is protected separately in /key-envelope,
 * which enforces on-chain checkAccess() before serving it.
 *
 * OPTIONAL CONSENT CHECK:
 * If a caller supplies ?recordId=<id>&hospital=<addr>, the server will also verify
 * on-chain consent before serving the file. This provides defence-in-depth for
 * clients that always pass context.
 */

const express = require("express");
const { ethers } = require("ethers");
const { getEncryptedFile, STRICT_CID_REGEX } = require("../services/storage");

const router = express.Router();

// Minimal ABI subset — same as envelope.js
const MINIMAL_ABI = [
  "function checkAccess(address patient, address hospital, uint8 recordType) external view returns (bool)",
  "function getRecord(uint256 recordId) external view returns (tuple(uint256 id, address patient, address hospital, uint8 recordType, string ipfsCid, bytes32 recordHash, uint256 timestamp, bool exists))",
];

function getContractInstance() {
  const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
  const contractAddress = process.env.CONTRACT_ADDRESS;
  if (!contractAddress) return null;
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    return new ethers.Contract(contractAddress, MINIMAL_ABI, provider);
  } catch {
    return null;
  }
}

/**
 * @route GET /file/:cid
 * @desc Retrieve encrypted file blob by CID.
 *       Optional query: ?recordId=<uint>&hospital=<address>
 *       When supplied, verifies on-chain checkAccess before streaming.
 * @access Public (ciphertext is unreadable without AES key)
 */
router.get("/:cid", async (req, res, next) => {
  try {
    const { cid } = req.params;
    const { recordId, hospital } = req.query;

    // ── 1. Strict CID format validation (path traversal guard) ──────────────
    if (!cid || !STRICT_CID_REGEX.test(cid)) {
      return res.status(400).json({
        success: false,
        error:
          "Invalid CID format: must be strictly alphanumeric (10-90 characters). " +
          "Special characters and path operators are prohibited.",
      });
    }

    // ── 2. Optional on-chain consent check ──────────────────────────────────
    if (recordId && hospital) {
      const contract = getContractInstance();
      if (contract) {
        try {
          const record = await contract.getRecord(BigInt(recordId));
          const hasAccess = await contract.checkAccess(
            record.patient,
            hospital,
            record.recordType
          );
          if (!hasAccess) {
            return res.status(403).json({
              success: false,
              error:
                "On-Chain Access Denied: Consent is expired or has been revoked by the patient.",
            });
          }
        } catch (contractErr) {
          // Contract not reachable in dev-only mode — log and continue
          console.warn(
            `[File Route] On-chain consent check skipped: ${contractErr.message}`
          );
        }
      }
    }

    // ── 3. Serve encrypted blob ──────────────────────────────────────────────
    const fileData = await getEncryptedFile(cid);

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${cid}.bin"`);
    res.setHeader("Content-Length", fileData.size);
    res.setHeader("X-Storage-Source", fileData.source);

    if (fileData.stream) {
      return fileData.stream.pipe(res);
    } else if (fileData.buffer) {
      return res.send(fileData.buffer);
    }
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        success: false,
        error: err.message,
      });
    }
    next(err);
  }
});

module.exports = router;

/**
 * @file envelope.js
 * @notice Route handler for managing encrypted AES key envelopes.
 * 
 * SECURITY MANDATE:
 * The key envelope contains the AES symmetric key ALREADY ENCRYPTED with the
 * recipient hospital's public key (RSA-OAEP). The server cannot read the AES key.
 * 
 * Access control enforcement:
 * When a hospital requests the wrapped key envelope for a record, the server
 * can verify that the hospital currently has valid, unexpired consent on-chain
 * via checkAccess() before serving the envelope.
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const router = express.Router();
const ENVELOPES_DIR = path.resolve(__dirname, "../../storage/envelopes");

if (!fs.existsSync(ENVELOPES_DIR)) {
  fs.mkdirSync(ENVELOPES_DIR, { recursive: true });
}

// Minimal ABI for on-chain checkAccess and getRecord
const MINIMAL_CONTRACT_ABI = [
  "function checkAccess(address patient, address hospital, uint8 recordType) external view returns (bool)",
  "function getRecord(uint256 recordId) external view returns (tuple(uint256 id, address patient, address hospital, uint8 recordType, string ipfsCid, bytes32 recordHash, uint256 timestamp, bool exists))"
];

/**
 * Returns an ethers Contract instance connected to the deployed contract if available.
 */
function getContractInstance() {
  const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
  const contractAddress = process.env.CONTRACT_ADDRESS;

  if (!contractAddress || contractAddress === ethers.ZeroAddress) {
    return null;
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    return new ethers.Contract(contractAddress, MINIMAL_CONTRACT_ABI, provider);
  } catch {
    return null;
  }
}

/**
 * @route POST /key-envelope
 * @desc Patient uploads wrapped AES key for an authorized hospital
 */
router.post("/", async (req, res) => {
  try {
    const { recordId, hospitalAddress, wrappedKey, patientAddress, recordType, recipient } = req.body;

    if (!recordId || (!hospitalAddress && !recipient) || !wrappedKey) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: recordId, (hospitalAddress or recipient), wrappedKey",
      });
    }

    const safeHospital = hospitalAddress ? hospitalAddress.toLowerCase() : null;
    const safePatient = patientAddress ? patientAddress.toLowerCase() : null;
    const safeRecipient = recipient ? recipient.toLowerCase() : safeHospital;

    const envelopeData = {
      recordId,
      hospitalAddress: safeHospital,
      patientAddress: safePatient,
      recipient: safeRecipient,
      recordType: recordType !== undefined ? Number(recordType) : 0,
      wrappedKey,
      savedAt: new Date().toISOString(),
    };

    // Save under primary recipient
    const primaryPath = path.resolve(ENVELOPES_DIR, `${recordId}_${safeRecipient}.json`);
    await fs.promises.writeFile(primaryPath, JSON.stringify(envelopeData, null, 2));

    // If wrapped for patient during record upload (patientAddress provided without explicit recipient),
    // also save under patientAddress so patient can fetch directly
    if (safePatient && safePatient !== safeRecipient) {
      const patientEnvelopePath = path.resolve(ENVELOPES_DIR, `${recordId}_${safePatient}.json`);
      await fs.promises.writeFile(patientEnvelopePath, JSON.stringify(envelopeData, null, 2));
    }

    return res.status(201).json({
      success: true,
      message: "Wrapped key envelope stored successfully",
      recordId,
      recipient: safeRecipient,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * @route GET /key-envelope/patient/:recordId
 * @desc Patient retrieves their own wrapped AES key envelope (no consent check needed).
 *       The patient's private key is required client-side to unwrap it — the encrypted
 *       blob is worthless to anyone who doesn't hold the matching RSA private key.
 *       The "for" address is the patientAddress stored in the envelope file.
 */
router.get("/patient/:recordId", async (req, res) => {
  try {
    const { recordId } = req.params;
    const { patientAddress } = req.query;

    if (!patientAddress) {
      return res.status(400).json({
        success: false,
        error: "Missing required query param: patientAddress",
      });
    }

    const safePatient = patientAddress.toLowerCase();
    let envelopePath = path.resolve(ENVELOPES_DIR, `${recordId}_${safePatient}.json`);

    // Fallback: check all envelopes for this recordId to see if patientAddress matches
    if (!fs.existsSync(envelopePath)) {
      const files = await fs.promises.readdir(ENVELOPES_DIR);
      const prefix = `${recordId}_`;
      for (const file of files) {
        if (file.startsWith(prefix) && file.endsWith(".json")) {
          try {
            const raw = await fs.promises.readFile(path.resolve(ENVELOPES_DIR, file), "utf8");
            const parsed = JSON.parse(raw);
            if (parsed.patientAddress && parsed.patientAddress.toLowerCase() === safePatient) {
              envelopePath = path.resolve(ENVELOPES_DIR, file);
              break;
            }
          } catch {
            // Ignore unparseable files
          }
        }
      }
    }

    if (!fs.existsSync(envelopePath)) {
      return res.status(404).json({
        success: false,
        error: `No patient envelope found for record ${recordId}`,
      });
    }

    const envelopeContent = JSON.parse(await fs.promises.readFile(envelopePath, "utf8"));

    return res.json({
      success: true,
      recordId,
      patientAddress: safePatient,
      wrappedKey: envelopeContent.wrappedKey,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * @route GET /key-envelope/:recordId/:hospital
 * @desc Hospital retrieves the wrapped AES key for a record.
 * Checks on-chain checkAccess() if contract address is configured.
 */
router.get("/:recordId/:hospital", async (req, res) => {
  try {
    const { recordId, hospital } = req.params;
    const safeHospital = hospital.toLowerCase();
    const envelopeFileName = `${recordId}_${safeHospital}.json`;
    const envelopePath = path.resolve(ENVELOPES_DIR, envelopeFileName);

    if (!fs.existsSync(envelopePath)) {
      return res.status(404).json({
        success: false,
        error: `No key envelope found for record ${recordId} and hospital ${hospital}`,
      });
    }

    const envelopeContent = JSON.parse(await fs.promises.readFile(envelopePath, "utf8"));

    // On-Chain Access Verification
    const contract = getContractInstance();
    if (contract && envelopeContent.patientAddress) {
      try {
        const hasAccess = await contract.checkAccess(
          envelopeContent.patientAddress,
          safeHospital,
          envelopeContent.recordType
        );

        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            error: "On-Chain Access Denied: Consent is expired or has been revoked by the patient.",
          });
        }
      } catch (contractErr) {
        console.warn(`[Key Envelope] On-chain checkAccess query failed: ${contractErr.message}. Serving stored envelope.`);
      }
    }

    return res.json({
      success: true,
      recordId,
      hospitalAddress: safeHospital,
      wrappedKey: envelopeContent.wrappedKey,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

/**
 * @file upload.js
 * @notice Route handler for POST /upload.
 * Receives already-encrypted ciphertext from the client and stores it off-chain.
 */

const express = require("express");
const multer = require("multer");
const { storeEncryptedFile } = require("../services/storage");

const router = express.Router();

const maxFileSizeMB = parseInt(process.env.MAX_FILE_SIZE_MB || "25", 10);

// Use multer memory storage (buffers encrypted bytes in memory before dispatching)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxFileSizeMB * 1024 * 1024, // 25MB default limit
  },
});

/**
 * @route POST /upload
 * @desc Uploads pre-encrypted medical record blob
 * @access Public (called by browser after AES-256-GCM encryption)
 */
router.post("/", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        error: "Missing required file field 'file' in multipart form data",
      });
    }

    if (req.file.buffer.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Uploaded file is empty (0 bytes)",
      });
    }

    // Zero-Knowledge Notice:
    // Only metadata (size, MIME type) is logged. File buffer content is NEVER logged.
    console.log(`[Upload] Processing encrypted blob: ${req.file.originalname} (${req.file.size} bytes)`);

    const result = await storeEncryptedFile(req.file.buffer, req.file.originalname);

    return res.status(201).json({
      success: true,
      cid: result.cid,
      size: result.size,
      storage: result.storage,
      message:
        result.storage === "local"
          ? "Encrypted file stored in local dev storage (mock CID)"
          : "Encrypted file pinned to IPFS via Pinata",
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

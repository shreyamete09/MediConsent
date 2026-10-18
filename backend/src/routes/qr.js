/**
 * @file qr.js
 * @notice Route handler for GET /qr/:requestId.
 * Generates QR code representing an on-chain access consent request for easy patient mobile scanning.
 */

const express = require("express");
const QRCode = require("qrcode");

const router = express.Router();

/**
 * @route GET /qr/:requestId
 * @desc Generate QR code image representing access consent request
 * @access Public
 */
router.get("/:requestId", async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const format = req.query.format || "png";

    if (!requestId || requestId.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameter 'requestId'",
      });
    }

    // Payload embedded in QR Code for patient wallet/app scanning
    const payload = JSON.stringify({
      protocol: "mediconsent-v1",
      action: "consent_request",
      requestId: requestId,
      url: `${process.env.FRONTEND_ORIGIN || "http://localhost:5173"}/consent?requestId=${encodeURIComponent(requestId)}`,
      createdAt: new Date().toISOString(),
    });

    if (format === "json") {
      const dataUrl = await QRCode.toDataURL(payload, {
        errorCorrectionLevel: "M",
        margin: 2,
        scale: 8,
      });

      return res.json({
        success: true,
        requestId,
        dataUrl,
      });
    }

    // Default: Stream PNG image buffer
    const qrBuffer = await QRCode.toBuffer(payload, {
      type: "png",
      errorCorrectionLevel: "M",
      margin: 2,
      scale: 8,
    });

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", qrBuffer.length);
    res.setHeader("Cache-Control", "public, max-age=300"); // Cache 5 min
    return res.send(qrBuffer);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

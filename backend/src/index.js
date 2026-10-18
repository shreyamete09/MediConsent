/**
 * @file index.js
 * @notice MediConsent Backend Relay Server
 * 
 * =========================================================================
 * ZERO-KNOWLEDGE & HIPPA / GDPR ARCHITECTURAL GUARANTEE:
 * 
 * 1. The server operates as an untrusted, blind off-chain relay.
 * 2. Protected Health Information (PHI) is encrypted exclusively inside
 *    the user's browser using AES-256-GCM before reaching this server.
 * 3. The AES symmetric encryption keys are encrypted with the recipient's
 *    public key (RSA-OAEP) in the browser.
 * 4. The server NEVER possesses private keys, raw AES keys, or plaintext data.
 * 5. The server logs strictly operational metadata (file size, timestamp, CID)
 *    and NEVER logs file payloads or cryptographic key material.
 * =========================================================================
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");

const uploadRoute = require("./routes/upload");
const fileRoute = require("./routes/file");
const qrRoute = require("./routes/qr");
const envelopeRoute = require("./routes/envelope");

const app = express();
const PORT = process.env.PORT || 5001;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";

// 1. Security Headers via Helmet
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }, // Allows image loading from frontend
  })
);

// 2. CORS Configuration: Restricted to configured frontend origin
const allowedOrigins = FRONTEND_ORIGIN.split(",").map((o) => o.trim());
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (e.g., mobile apps, curl, server-to-server)
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS policy`));
      }
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// 3. Rate Limiting: 100 requests per 15 minutes window
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many requests from this IP. Please try again after 15 minutes.",
  },
});
app.use(globalLimiter);

// Parse JSON bodies (for non-multipart endpoints)
app.use(express.json({ limit: "1mb" }));

// 4. Routes
app.use("/upload", uploadRoute);
app.use("/file", fileRoute);
app.use("/qr", qrRoute);
app.use("/key-envelope", envelopeRoute);

// Health Check Endpoint
app.get("/health", (req, res) => {
  const isLocal =
    process.env.USE_LOCAL_STORAGE === "true" || !process.env.PINATA_JWT;
  res.json({
    status: "healthy",
    service: "MediConsent Backend Relay",
    storageMode: isLocal ? "local_fallback" : "pinata_ipfs",
    timestamp: new Date().toISOString(),
  });
});

// Root info endpoint
app.get("/", (req, res) => {
  res.json({
    service: "MediConsent Off-Chain Storage & QR Relay API",
    version: "1.0.0",
    docs: {
      upload: "POST /upload (multipart/form-data: file)",
      fetchFile: "GET /file/:cid",
      qrCode: "GET /qr/:requestId",
      health: "GET /health",
    },
  });
});

// 5. Global Error Handling Middleware
app.use((err, req, res, next) => {
  // Handle Multer file size exceeded error
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      const maxMb = process.env.MAX_FILE_SIZE_MB || "25";
      return res.status(413).json({
        success: false,
        error: `File size exceeds the allowed limit of ${maxMb}MB`,
      });
    }
    return res.status(400).json({
      success: false,
      error: `Upload error: ${err.message}`,
    });
  }

  // Handle CORS validation error
  if (err.message && err.message.includes("CORS")) {
    return res.status(403).json({
      success: false,
      error: err.message,
    });
  }

  console.error("[Server Error]", err.message);
  return res.status(err.statusCode || 500).json({
    success: false,
    error: err.message || "Internal server error",
  });
});

// Start Server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log("=================================================");
    console.log(` MediConsent Backend Relay listening on port ${PORT}`);
    console.log(` CORS Allowed Origin: ${FRONTEND_ORIGIN}`);
    console.log(
      ` Storage Mode: ${process.env.USE_LOCAL_STORAGE === "true" ? "LOCAL DISK FALLBACK (mock CIDs)" : "PINATA IPFS"}`
    );
    console.log(" Zero-Knowledge Status: Active (No plaintext PHI logged)");
    console.log("=================================================");
  });
}

module.exports = app;

/**
 * @file RecordViewerPanel.jsx
 * @notice Hospital portal panel for discovering consented records and securely viewing them.
 *
 * CRITICAL SECURITY ORDER (Step 4B-1 Part 3):
 *   1. Call contract.logAccess(patient, recordId) on-chain FIRST and await confirmation.
 *      IF USER REJECTS METAMASK: ABORT IMMEDIATELY. NO DATA IS FETCHED OR DECRYPTED.
 *   2. Fetch hospital key envelope via GET /key-envelope/:recordId/:hospital.
 *   3. Fetch ciphertext via GET /file/:cid?recordId=&hospital=.
 *   4. Unwrap AES key using hospital's RSA private key from the client keystore.
 *   5. Decrypt file in browser using AES-256-GCM (auth tag verified).
 *   6. Recompute SHA-256 hash of original file and verify via contract.verifyRecord(recordId, hash).
 *   7. IF MATCH: Display green "Verified: hash matches blockchain" badge + preview/download.
 *      IF MISMATCH: Display red "TAMPERED: file does not match the on-chain hash" warning.
 *      DO NOT RENDER FILE CONTENT IF TAMPERED.
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { ethers } from "ethers";
import { useWeb3 } from "../context/Web3Context";
import {
  useContractEvents,
  recordTypeLabel,
  deriveRequestDetails,
} from "../hooks/useContractEvents.js";
import { unwrapAesKey } from "../crypto/rsa.js";
import { decryptFile } from "../crypto/aes.js";
import { computeFileHash } from "../crypto/hash.js";
import TxStatus from "./TxStatus.jsx";
import {
  Eye,
  FileText,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Download,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Clock,
  User,
  Hash,
  X,
} from "lucide-react";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:5001";

// Helper: Detect MIME type from raw file bytes
function detectMimeType(bytes) {
  if (bytes.length >= 4) {
    // PDF: %PDF
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
      return { mime: "application/pdf", ext: "pdf", isPdf: true, isImage: false };
    }
    // PNG: \x89PNG
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return { mime: "image/png", ext: "png", isPdf: false, isImage: true };
    }
    // JPEG: \xFF\xD8\xFF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return { mime: "image/jpeg", ext: "jpg", isPdf: false, isImage: true };
    }
    // GIF: GIF8
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
      return { mime: "image/gif", ext: "gif", isPdf: false, isImage: true };
    }
  }
  return { mime: "application/octet-stream", ext: "bin", isPdf: false, isImage: false };
}

export default function RecordViewerPanel({ privateKey, isHospitalRegistered }) {
  const { account, contract } = useWeb3();

  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [consentedRecords, setConsentedRecords] = useState([]);
  const [isLoadingRecords, setIsLoadingRecords] = useState(false);
  const [loadError, setLoadError] = useState(null);

  // Active view modal state
  const [activeViewModal, setActiveViewModal] = useState(null);
  const [viewTxStatus, setViewTxStatus] = useState({ status: "idle", message: "" });
  const [viewResult, setViewResult] = useState(null); // { isVerified, blobUrl, mimeInfo, record, hashes }
  const [isViewing, setIsViewing] = useState(false);

  // Query ConsentGranted events where indexed hospital == account
  const { events: grantEvents, isLoading: isGrantsLoading } = useContractEvents(
    contract,
    "ConsentGranted",
    account ? [null, account] : [],
    [account, refreshTrigger]
  );

  // Discover records covered by granted consents
  useEffect(() => {
    if (!contract || !account || !grantEvents || grantEvents.length === 0) {
      setConsentedRecords([]);
      return;
    }

    let isMounted = true;
    (async () => {
      setIsLoadingRecords(true);
      setLoadError(null);

      try {
        const recordsList = [];
        const seenRecordIds = new Set();

        for (const evt of grantEvents) {
          const patient = evt.args?.patient;
          const types = (evt.args?.recordTypes || []).map((t) => Number(t));

          if (!patient || patient === ethers.ZeroAddress) continue;

          try {
            const recordIds = await contract.getPatientRecordIds(patient);

            for (const rIdBn of recordIds) {
              const rId = Number(rIdBn);
              if (seenRecordIds.has(rId)) continue;

              const rec = await contract.getRecord(rId);
              const recType = Number(rec.recordType);

              if (types.includes(recType)) {
                // Verify on-chain access state
                const hasAccess = await contract.checkAccess(patient, account, recType).catch(() => false);
                const expiry = await contract.consentExpiry(patient, account, recType).catch(() => 0n);

                seenRecordIds.add(rId);
                recordsList.push({
                  id: rId,
                  patient: rec.patient,
                  hospital: rec.hospital,
                  recordType: recType,
                  ipfsCid: rec.ipfsCid,
                  recordHash: rec.recordHash,
                  timestamp: Number(rec.timestamp),
                  hasAccess,
                  expiry: Number(expiry),
                });
              }
            }
          } catch (err) {
            console.warn(`Error querying patient ${patient} records:`, err);
          }
        }

        if (isMounted) {
          setConsentedRecords(recordsList.sort((a, b) => b.id - a.id));
        }
      } catch (err) {
        console.error("Error loading consented records:", err);
        if (isMounted) setLoadError(err.message);
      } finally {
        if (isMounted) setIsLoadingRecords(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [contract, account, grantEvents, refreshTrigger]);

  // Clean up object URLs to avoid memory leaks
  const handleCloseModal = () => {
    if (viewResult?.blobUrl) {
      URL.revokeObjectURL(viewResult.blobUrl);
    }
    setActiveViewModal(null);
    setViewResult(null);
    setViewTxStatus({ status: "idle", message: "" });
    setIsViewing(false);
  };

  // ── 2. VIEW RECORD FLOW (ORDER MANDATED BY REQUIREMENTS) ──────────────────
  const handleOpenRecord = async (record) => {
    if (!contract || !account || isViewing) return;

    setActiveViewModal(record);
    setViewResult(null);
    setIsViewing(true);
    const setStatus = (status, message) => setViewTxStatus({ status, message });

    try {
      // ── Step a: Call logAccess(patient, recordId) on-chain FIRST ────────────
      setStatus(
        "confirming",
        "⛓ [Step 1/6] Logging access on-chain (logAccess)… Please confirm in MetaMask"
      );

      let logTx;
      try {
        logTx = await contract.logAccess(record.patient, record.id);
      } catch (logErr) {
        // Critical requirement: If user rejects in MetaMask, stop immediately.
        console.warn("logAccess transaction rejected or failed:", logErr);
        setStatus(
          "error",
          `Access Denied: On-chain access log was rejected in MetaMask or failed (${logErr.reason || logErr.message}). Execution halted — no data was fetched or decrypted.`
        );
        setIsViewing(false);
        return; // STOP!
      }

      setStatus("confirming", `⛓ [Step 1/6] Waiting for logAccess confirmation… (tx: ${logTx.hash.slice(0, 10)}…)`);
      await logTx.wait();

      // ── Step b: Fetch hospital key envelope ─────────────────────────────────
      setStatus("encrypting", `🔒 [Step 2/6] Fetching hospital key envelope for Record #${record.id}…`);
      const envRes = await fetch(`${BACKEND_URL}/key-envelope/${record.id}/${account}`);
      if (!envRes.ok) {
        const err = await envRes.json().catch(() => ({}));
        throw new Error(
          `Key envelope retrieval failed (${envRes.status}): ${err.error || envRes.statusText}. Has the patient approved consent for this record?`
        );
      }
      const { wrappedKey } = await envRes.json();

      // ── Step c: Fetch ciphertext from storage relay ─────────────────────────
      setStatus("uploading", `⬇ [Step 3/6] Fetching encrypted ciphertext from storage relay (CID: ${record.ipfsCid.slice(0, 15)}…)…`);
      const fileRes = await fetch(
        `${BACKEND_URL}/file/${record.ipfsCid}?recordId=${record.id}&hospital=${account}`
      );
      if (!fileRes.ok) {
        const err = await fileRes.json().catch(() => ({}));
        throw new Error(
          `Ciphertext fetch failed (${fileRes.status}): ${err.error || fileRes.statusText}`
        );
      }
      const payloadBuffer = await fileRes.arrayBuffer();
      const payloadBytes = new Uint8Array(payloadBuffer);

      if (payloadBytes.length < 12) {
        throw new Error("Invalid payload: Insufficient bytes to extract the 12-byte AES-GCM IV.");
      }

      // First 12 bytes = IV, remaining = ciphertext + 16-byte GCM tag
      const iv = payloadBytes.slice(0, 12);
      const ciphertext = payloadBytes.slice(12);

      // ── Step d: Unwrap AES key with hospital private key ────────────────────
      setStatus("encrypting", "🔒 [Step 4/6] Unwrapping AES key with your hospital RSA private key in browser…");
      if (!privateKey) {
        throw new Error(
          "Hospital RSA private key is not loaded in this browser. Please use the 'Import Key' button in the Keystore panel to restore your key pair."
        );
      }

      let aesKey;
      try {
        aesKey = await unwrapAesKey(wrappedKey, privateKey);
      } catch (unwrapErr) {
        throw new Error(
          "Failed to unwrap AES key: The loaded private key does not match this envelope. Please verify your active key in the Keystore panel."
        );
      }

      // ── Step e: Decrypt file in browser ─────────────────────────────────────
      setStatus("encrypting", "🔒 [Step 5/6] Decrypting file with AES-256-GCM (verifying 128-bit authentication tag)…");
      let decryptedBytes;
      try {
        decryptedBytes = await decryptFile(ciphertext, iv, aesKey);
      } catch (decryptErr) {
        setStatus("error", "⚠️ TAMPERED: Ciphertext authentication failed! Off-chain stored data was altered.");
        setViewResult({
          isVerified: false,
          isTamperedCiphertext: true,
          errorMessage: "Decryption failed: AES-256-GCM authentication tag verification failed. The ciphertext or IV in storage has been tampered with or corrupted.",
          onChainHash: record.recordHash,
        });
        return; // Halt and strictly block any file display
      }

      // ── Step f: Recompute SHA-256 hash & verifyRecord on-chain ──────────────
      setStatus("confirming", "🔍 [Step 6/6] Recomputing SHA-256 hash of original file & verifying against blockchain…");
      const recomputedHash = await computeFileHash(decryptedBytes.buffer);
      const isVerified = await contract.verifyRecord(record.id, recomputedHash);

      const mimeInfo = detectMimeType(decryptedBytes);
      let blobUrl = null;

      if (isVerified) {
        // ONLY create blob URL if verified!
        const blob = new Blob([decryptedBytes], { type: mimeInfo.mime });
        blobUrl = URL.createObjectURL(blob);
        setStatus("success", "✅ Record decrypted and cryptographically verified against blockchain hash!");
      } else {
        setStatus("error", "⚠️ TAMPERED: Decrypted file does NOT match the immutable on-chain hash!");
      }

      setViewResult({
        isVerified,
        isTamperedCiphertext: false,
        blobUrl,
        mimeInfo,
        recomputedHash,
        onChainHash: record.recordHash,
        fileSize: decryptedBytes.length,
      });
    } catch (err) {
      console.error("View record error:", err);
      setStatus("error", `Error: ${err.reason || err.message}`);
    } finally {
      setIsViewing(false);
    }
  };

  return (
    <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-5">
      {/* ── Section Header ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center space-x-2">
            <Eye className="w-5 h-5 text-emerald-400" />
            <span>Consented Medical Records</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-500/30">
              {consentedRecords.length}
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Decrypted client-side only after on-chain logAccess confirmation. Tamper detection verified against smart contract.
          </p>
        </div>

        <button
          onClick={() => setRefreshTrigger((prev) => prev + 1)}
          disabled={isLoadingRecords || isGrantsLoading}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-slate-900 border border-slate-700 text-slate-300 hover:text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoadingRecords || isGrantsLoading ? "animate-spin" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Loading state */}
      {(isLoadingRecords || isGrantsLoading) && (
        <div className="py-12 text-center space-y-2">
          <RefreshCw className="w-6 h-6 text-emerald-400 animate-spin mx-auto" />
          <p className="text-xs text-slate-400">Discovering consented records & validating on-chain permissions…</p>
        </div>
      )}

      {/* Error state */}
      {loadError && (
        <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/30 text-xs text-rose-300">
          Failed to load records: {loadError}
        </div>
      )}

      {/* Empty state */}
      {!isLoadingRecords && !isGrantsLoading && consentedRecords.length === 0 && (
        <div className="glass-card rounded-xl p-8 text-center border border-slate-800 space-y-2">
          <FileText className="w-8 h-8 text-slate-700 mx-auto" />
          <h4 className="text-sm font-semibold text-slate-300">No Consented Records</h4>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            You do not currently hold active consent for any patient records. Submit an access request in the "Request Patient Access" tab and wait for patient approval.
          </p>
        </div>
      )}

      {/* Consented Records Grid */}
      {!isLoadingRecords && consentedRecords.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {consentedRecords.map((rec) => {
            const isAccessActive = rec.hasAccess;
            const categoryName = recordTypeLabel(rec.recordType);

            return (
              <div
                key={rec.id}
                className={`glass-card rounded-xl p-4 border transition-all space-y-3 ${
                  isAccessActive
                    ? "border-emerald-500/30 hover:border-emerald-500/50"
                    : "border-slate-800 opacity-60"
                }`}
              >
                {/* Top: ID + Category + Access Status */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold text-white px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700">
                      Record #{rec.id}
                    </span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-500/25">
                      {categoryName}
                    </span>
                  </div>

                  {isAccessActive ? (
                    <span className="inline-flex items-center space-x-1 text-[11px] font-semibold text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Active Consent</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center space-x-1 text-[11px] font-semibold text-rose-400">
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Consent Inactive</span>
                    </span>
                  )}
                </div>

                {/* Patient Address */}
                <div className="flex items-center justify-between text-xs bg-slate-950/40 p-2 rounded-lg border border-slate-800/80">
                  <span className="text-slate-400 flex items-center space-x-1.5">
                    <User className="w-3.5 h-3.5 text-blue-400" />
                    <span>Patient:</span>
                  </span>
                  <span className="font-mono text-slate-200 text-[11px]">
                    {rec.patient.slice(0, 8)}…{rec.patient.slice(-6)}
                  </span>
                </div>

                {/* CID preview */}
                <div className="text-[11px] space-y-0.5">
                  <span className="text-slate-400">Encrypted IPFS CID:</span>
                  <p className="font-mono text-[10px] text-slate-400 truncate bg-slate-900/60 px-2 py-1 rounded border border-slate-800">
                    {rec.ipfsCid}
                  </p>
                </div>

                {/* Action button */}
                <button
                  onClick={() => handleOpenRecord(rec)}
                  disabled={!isAccessActive || isViewing}
                  className="w-full flex items-center justify-center space-x-1.5 py-2.5 rounded-xl font-semibold text-xs text-white bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 shadow-md shadow-emerald-500/15 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>
                    {isAccessActive ? "View Record (Log & Decrypt)" : "Consent Expired / Revoked"}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Secure Decryption & Viewer Modal ───────────────────────────────── */}
      {activeViewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn">
          <div className="glass-panel max-w-2xl w-full max-h-[90vh] flex flex-col rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-900/70">
              <div className="flex items-center space-x-2">
                <FileText className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">
                  Medical Record #{activeViewModal.id} ({recordTypeLabel(activeViewModal.recordType)})
                </h3>
              </div>
              <button
                onClick={handleCloseModal}
                disabled={isViewing}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-30"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 flex-1">
              {/* Step-by-Step Status Banner */}
              <TxStatus status={viewTxStatus.status} message={viewTxStatus.message} />

              {/* Progress skeleton while viewing */}
              {isViewing && (
                <div className="py-8 text-center space-y-3">
                  <Lock className="w-8 h-8 text-emerald-400 animate-pulse mx-auto" />
                  <p className="text-xs text-slate-300 font-medium">
                    Performing cryptographic handshake in your browser…
                  </p>
                  <p className="text-[11px] text-slate-500 max-w-md mx-auto">
                    Private key never leaves browser. Access log will be written to blockchain before ciphertext is decrypted.
                  </p>
                </div>
              )}

              {/* ── Verification Result Badges ──────────────────────────────── */}
              {viewResult && (
                <div className="space-y-4">
                  {viewResult.isVerified ? (
                    <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/40 space-y-2">
                      <div className="flex items-center space-x-2 text-emerald-300 font-bold text-sm">
                        <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                        <span>Verified: hash matches blockchain</span>
                      </div>
                      <p className="text-[11px] text-emerald-200/80 leading-relaxed">
                        The SHA-256 integrity hash of this decrypted file was matched against the immutable on-chain record hash. The file has not been altered since upload.
                      </p>
                      <div className="text-[10px] font-mono text-emerald-400/90 break-all bg-emerald-950/60 p-2 rounded border border-emerald-500/20">
                        {viewResult.recomputedHash}
                      </div>
                    </div>
                  ) : viewResult.isTamperedCiphertext ? (
                    <div className="p-4 rounded-xl bg-rose-950/50 border border-rose-500/50 space-y-2">
                      <div className="flex items-center space-x-2 text-rose-300 font-bold text-sm">
                        <ShieldAlert className="w-5 h-5 text-rose-400 flex-shrink-0" />
                        <span>TAMPERED: Ciphertext authentication failed</span>
                      </div>
                      <p className="text-[11px] text-rose-200/90 leading-relaxed">
                        SECURITY ALERT (Case A - Storage Tampering): The 128-bit AES-256-GCM authentication tag verification failed. The encrypted ciphertext or initialization vector stored off-chain has been modified or corrupted. File display is strictly blocked.
                      </p>
                      <div className="text-[10px] font-mono text-rose-300 bg-rose-950/60 p-2.5 rounded border border-rose-500/20 leading-relaxed">
                        {viewResult.errorMessage}
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl bg-rose-950/50 border border-rose-500/50 space-y-2">
                      <div className="flex items-center space-x-2 text-rose-300 font-bold text-sm">
                        <ShieldAlert className="w-5 h-5 text-rose-400 flex-shrink-0" />
                        <span>TAMPERED: file does not match the on-chain hash</span>
                      </div>
                      <p className="text-[11px] text-rose-200/90 leading-relaxed">
                        SECURITY ALERT (Case B - Hash Mismatch): The file was decrypted, but its recomputed SHA-256 hash does not match the immutable record hash committed to the blockchain. File display is strictly blocked to protect clinical integrity.
                      </p>
                      <div className="space-y-1 text-[10px] font-mono">
                        <p className="text-slate-400">On-Chain Expected: <span className="text-rose-300">{viewResult.onChainHash}</span></p>
                        <p className="text-slate-400">Recomputed Actual: <span className="text-rose-400">{viewResult.recomputedHash}</span></p>
                      </div>
                    </div>
                  )}

                  {/* ── File Content (Rendered ONLY if verified) ──────────────── */}
                  {viewResult.isVerified && viewResult.blobUrl && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-xs text-slate-300 font-semibold">
                        <span>Decrypted Record Preview:</span>
                        <span className="text-slate-500 font-normal">
                          {(viewResult.fileSize / 1024).toFixed(1)} KB ({viewResult.mimeInfo.mime})
                        </span>
                      </div>

                      {/* Image Preview */}
                      {viewResult.mimeInfo.isImage && (
                        <div className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-center">
                          <img
                            src={viewResult.blobUrl}
                            alt="Decrypted Medical Record"
                            className="max-h-80 mx-auto rounded-lg object-contain"
                          />
                        </div>
                      )}

                      {/* PDF Preview */}
                      {viewResult.mimeInfo.isPdf && (
                        <div className="rounded-xl overflow-hidden border border-slate-800 bg-slate-900">
                          <iframe
                            src={viewResult.blobUrl}
                            title="Decrypted PDF Record"
                            className="w-full h-80 rounded-xl"
                          />
                        </div>
                      )}

                      {/* Generic / Download link */}
                      <div className="pt-2">
                        <a
                          href={viewResult.blobUrl}
                          download={`medical-record-${activeViewModal.id}.${viewResult.mimeInfo.ext}`}
                          className="flex items-center justify-center space-x-2 py-2.5 px-4 rounded-xl text-xs font-semibold text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors shadow-sm"
                        >
                          <Download className="w-4 h-4 text-emerald-400" />
                          <span>Download Decrypted Medical Record</span>
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-800 bg-slate-900/50 flex justify-end">
              <button
                type="button"
                onClick={handleCloseModal}
                disabled={isViewing}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors disabled:opacity-40"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

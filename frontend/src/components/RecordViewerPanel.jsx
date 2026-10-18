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
  KeyRound,
  Copy,
  Check,
} from "lucide-react";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:5001";

// Helper: Detect MIME type from raw file bytes
function detectMimeType(bytes) {
  if (bytes.length >= 4) {
    // PDF: %PDF
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
      return { mime: "application/pdf", ext: "pdf", isPdf: true, isImage: false, isText: false };
    }
    // PNG: \x89PNG
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return { mime: "image/png", ext: "png", isPdf: false, isImage: true, isText: false };
    }
    // JPEG: \xFF\xD8\xFF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return { mime: "image/jpeg", ext: "jpg", isPdf: false, isImage: true, isText: false };
    }
    // GIF: GIF8
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
      return { mime: "image/gif", ext: "gif", isPdf: false, isImage: true, isText: false };
    }
  }
  // Check if valid UTF-8 text or JSON
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const text = decoder.decode(bytes);
    const trimmed = text.trim();
    const isJson =
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"));
    return {
      mime: isJson ? "application/json" : "text/plain",
      ext: isJson ? "json" : "txt",
      isPdf: false,
      isImage: false,
      isText: true,
      textContent: text,
    };
  } catch (e) {
    // Binary octet stream
  }
  return { mime: "application/octet-stream", ext: "bin", isPdf: false, isImage: false, isText: false };
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
  const [viewResult, setViewResult] = useState(null); // { isVerified, blobUrl, mimeInfo, record, hashes, logTxHash, blockNumber, logTimestamp, hospitalAddress }
  const [isViewing, setIsViewing] = useState(false);
  const [copiedModalField, setCopiedModalField] = useState(null);

  const handleCopyModal = (text, id) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedModalField(id);
    setTimeout(() => setCopiedModalField(null), 2000);
  };

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
      const receipt = await logTx.wait();
      const logTxHash = logTx.hash;
      const blockNumber = receipt?.blockNumber ? Number(receipt.blockNumber) : null;
      const logTimestamp = Date.now();

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
          recomputedHash: "N/A (Ciphertext authentication failure)",
          logTxHash,
          blockNumber,
          logTimestamp,
          hospitalAddress: account,
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
        logTxHash,
        blockNumber,
        logTimestamp,
        hospitalAddress: account,
      });
    } catch (err) {
      console.error("View record error:", err);
      setStatus("error", `Error: ${err.reason || err.message}`);
    } finally {
      setIsViewing(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-8 shadow-sm space-y-6">
      {/* ── Section Header ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
            <Eye className="w-5 h-5 text-teal-700" />
            <span>Consented Medical Records</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
              {consentedRecords.length}
            </span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Decrypted client-side only after on-chain logAccess confirmation. Tamper detection verified against contract event logs.
          </p>
        </div>

        <button
          onClick={() => setRefreshTrigger((prev) => prev + 1)}
          disabled={isLoadingRecords || isGrantsLoading}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 border border-slate-200 text-slate-700 hover:bg-slate-200 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoadingRecords || isGrantsLoading ? "animate-spin" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Loading state */}
      {(isLoadingRecords || isGrantsLoading) && (
        <div className="py-12 text-center space-y-2">
          <RefreshCw className="w-6 h-6 text-teal-700 animate-spin mx-auto" />
          <p className="text-xs text-slate-500">Discovering consented records & validating on-chain permissions…</p>
        </div>
      )}

      {/* Error state */}
      {loadError && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
          Failed to load records: {loadError}
        </div>
      )}

      {/* Empty state */}
      {!isLoadingRecords && !isGrantsLoading && consentedRecords.length === 0 && (
        <div className="rounded-2xl p-8 text-center border border-dashed border-slate-200 bg-slate-50/50 space-y-2">
          <FileText className="w-8 h-8 text-slate-400 mx-auto" />
          <h4 className="text-sm font-bold text-slate-800">No Consented Records</h4>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            You do not currently hold active consent for any patient records. Submit an access request in the "Request Access" tab and wait for patient approval.
          </p>
        </div>
      )}

      {/* Consented Records Grid */}
      {!isLoadingRecords && consentedRecords.length > 0 && (
        <div className="space-y-4">
          {consentedRecords.map((rec) => {
            const isAccessActive = rec.hasAccess;
            const categoryName = recordTypeLabel(rec.recordType);

            return (
              <div
                key={rec.id}
                className={`bg-slate-50 rounded-2xl p-5 sm:p-6 border transition-all space-y-4 ${
                  isAccessActive
                    ? "border-slate-200/90 hover:border-slate-300"
                    : "border-slate-200 opacity-60"
                }`}
              >
                {/* Top: ID + Category + Access Status */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 pb-3">
                  <div className="flex items-center space-x-2.5">
                    <span className="text-sm font-extrabold text-slate-900 font-mono">
                      #REC-{rec.id}
                    </span>
                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-teal-50 text-teal-800 border border-teal-200">
                      {categoryName}
                    </span>
                  </div>

                  {isAccessActive ? (
                    <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      <span>Consent Active</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                      <span>Consent Inactive</span>
                    </span>
                  )}
                </div>

                {/* Middle Two Columns: Patient & Payload CID */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {/* Patient Sovereign Identifier */}
                  <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 space-y-1.5">
                    <span className="text-slate-500 text-[11px] block font-sans">
                      Patient Sovereign Identifier:
                    </span>
                    <div className="flex items-center space-x-2">
                      <div className="w-6 h-6 rounded-full bg-teal-50 text-teal-700 flex items-center justify-center font-bold text-[10px]">
                        {rec.patient.slice(2, 4).toUpperCase()}
                      </div>
                      <span className="font-mono font-semibold text-slate-900 text-xs">
                        {rec.patient.slice(0, 8)}…{rec.patient.slice(-6)}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400">
                      Authorized scope: {categoryName}
                    </p>
                  </div>

                  {/* Encrypted Storage CID (Rule 3: do not say pinned to IPFS) */}
                  <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 space-y-1.5">
                    <span className="text-slate-500 text-[11px] block font-sans">
                      Encrypted storage CID:
                    </span>
                    <p className="font-mono text-[11px] text-slate-800 truncate bg-slate-50 px-2 py-1 rounded border border-slate-100">
                      {rec.ipfsCid}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      Client-side AES-256-GCM envelope
                    </p>
                  </div>
                </div>

                {/* Bottom Row: Status note & Action Button */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="text-[11px] text-slate-500 flex items-center space-x-1.5">
                    <Lock className="w-3.5 h-3.5 text-teal-700" />
                    <span>Smart contract consent verified • Encrypted in transit</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleOpenRecord(rec)}
                    disabled={!isAccessActive || isViewing}
                    className="flex items-center space-x-2 px-5 py-2.5 rounded-xl font-semibold text-xs text-white bg-teal-800 hover:bg-teal-700 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>
                      {isAccessActive ? "View Record (Log & Decrypt)" : "Consent Expired / Revoked"}
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Secure Decryption & Viewer Modal ───────────────────────────────── */}
      {activeViewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="max-w-3xl w-full max-h-[92vh] flex flex-col rounded-3xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
              <div>
                <div className="flex items-center space-x-1.5 text-[10px] font-bold tracking-wider text-teal-800 uppercase">
                  <ShieldCheck className="w-3.5 h-3.5 text-teal-600" />
                  <span>Cryptographic Proof Engine</span>
                </div>
                <h3 className="text-base font-bold text-slate-900 mt-0.5">
                  Medical Record #{activeViewModal.id}{" "}
                  <span className="text-xs font-semibold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full border border-teal-200 ml-1">
                    {recordTypeLabel(activeViewModal.recordType)}
                  </span>
                </h3>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                disabled={isViewing}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors disabled:opacity-30"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-4 flex-1 bg-white">
              {/* Step-by-Step Status Banner */}
              <TxStatus status={viewTxStatus.status} message={viewTxStatus.message} />

              {/* Progress skeleton while viewing */}
              {isViewing && (
                <div className="py-10 text-center space-y-3">
                  <Lock className="w-9 h-9 text-teal-700 animate-pulse mx-auto" />
                  <p className="text-xs text-slate-700 font-semibold">
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
                  {/* Verified State */}
                  {viewResult.isVerified ? (
                    <div className="p-5 rounded-2xl bg-emerald-50/80 border border-emerald-200 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2 text-emerald-900 font-bold text-sm">
                          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                          <span>✓ Verified: Hash matches blockchain</span>
                        </div>
                        <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                          <Check className="w-3 h-3 text-emerald-700" />
                          <span>Intact</span>
                        </span>
                      </div>

                      <p className="text-xs text-emerald-800 leading-relaxed">
                        SHA-256 Digest matches On-Chain Contract Record #{activeViewModal.id}. Block confirmation: #{viewResult.blockNumber || "N/A"}.
                      </p>

                      {/* Side by side hashes */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                        <div className="bg-white p-3 rounded-xl border border-emerald-200 space-y-1">
                          <div className="flex items-center justify-between text-[10px] font-semibold text-slate-500 uppercase">
                            <span>On-Chain Record Hash</span>
                            <button
                              type="button"
                              onClick={() => handleCopyModal(viewResult.onChainHash, "onChainHash")}
                              className="text-slate-400 hover:text-teal-700"
                              title="Copy on-chain hash"
                            >
                              {copiedModalField === "onChainHash" ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                          <p className="font-mono text-[11px] text-slate-800 break-all">{viewResult.onChainHash}</p>
                        </div>

                        <div className="bg-white p-3 rounded-xl border border-emerald-200 space-y-1">
                          <div className="flex items-center justify-between text-[10px] font-semibold text-slate-500 uppercase">
                            <span>Recomputed File Digest</span>
                            <button
                              type="button"
                              onClick={() => handleCopyModal(viewResult.recomputedHash, "recomputedHash")}
                              className="text-slate-400 hover:text-teal-700"
                              title="Copy recomputed digest"
                            >
                              {copiedModalField === "recomputedHash" ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                          <p className="font-mono text-[11px] text-slate-800 break-all">{viewResult.recomputedHash}</p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2 text-[11px] text-emerald-800 font-semibold pt-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                        <span>On-Chain Cryptographic Verification Passed • Hashes match exactly</span>
                      </div>
                    </div>
                  ) : viewResult.isTamperedCiphertext ? (
                    /* Tamper Case A: Ciphertext authentication failed */
                    <div className="p-5 rounded-2xl bg-rose-50 border border-rose-200 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2 text-rose-900 font-bold text-sm">
                          <ShieldAlert className="w-5 h-5 text-rose-600 flex-shrink-0" />
                          <span>TAMPERED: Ciphertext authentication failed</span>
                        </div>
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-800 border border-rose-200">
                          Storage Tampering Detected
                        </span>
                      </div>
                      <p className="text-xs text-rose-800 leading-relaxed">
                        SECURITY ALERT (Case A - Storage Tampering): The 128-bit AES-256-GCM authentication tag verification failed. The encrypted ciphertext or initialization vector stored off-chain has been modified or corrupted. File display is strictly blocked.
                      </p>
                      <div className="text-[11px] font-mono text-rose-900 bg-white p-3 rounded-xl border border-rose-200">
                        {viewResult.errorMessage}
                      </div>
                    </div>
                  ) : (
                    /* Tamper Case B: Hash mismatch */
                    <div className="p-5 rounded-2xl bg-rose-50 border border-rose-200 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2 text-rose-900 font-bold text-sm">
                          <ShieldAlert className="w-5 h-5 text-rose-600 flex-shrink-0" />
                          <span>TAMPERED: File does not match on-chain hash</span>
                        </div>
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-800 border border-rose-200">
                          Integrity Mismatch
                        </span>
                      </div>
                      <p className="text-xs text-rose-800 leading-relaxed">
                        SECURITY ALERT (Case B - Hash Mismatch): The file was decrypted, but its recomputed SHA-256 hash does not match the immutable record hash committed to the blockchain. File display is strictly blocked to protect clinical integrity.
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                        <div className="bg-white p-3 rounded-xl border border-rose-200 space-y-1">
                          <span className="text-[10px] font-semibold text-slate-500 uppercase">On-Chain Expected Hash</span>
                          <p className="font-mono text-[11px] text-rose-900 break-all">{viewResult.onChainHash}</p>
                        </div>
                        <div className="bg-white p-3 rounded-xl border border-rose-200 space-y-1">
                          <span className="text-[10px] font-semibold text-slate-500 uppercase">Recomputed Actual Hash</span>
                          <p className="font-mono text-[11px] text-rose-900 break-all">{viewResult.recomputedHash}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Decryption & Access Log Context Bar */}
                  <div className="bg-sky-50/80 border border-sky-100 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center space-x-2 text-slate-700">
                      <KeyRound className="w-4 h-4 text-sky-600 flex-shrink-0" />
                      <span>
                        Decrypted client-side using Hospital{" "}
                        <strong className="font-mono text-slate-900">
                          {viewResult.hospitalAddress
                            ? `${viewResult.hospitalAddress.slice(0, 8)}…${viewResult.hospitalAddress.slice(-6)}`
                            : "Registered"}
                        </strong>{" "}
                        key at{" "}
                        {new Date(viewResult.logTimestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                          timeZoneName: "short",
                        })}
                        .
                      </span>
                    </div>

                    <div className="flex items-center space-x-2 text-[11px]">
                      {viewResult.blockNumber && (
                        <span className="font-mono text-slate-600 bg-white px-2 py-0.5 rounded-lg border border-sky-200">
                          Block #{viewResult.blockNumber}
                        </span>
                      )}
                      {viewResult.logTxHash && (
                        <div className="flex items-center space-x-1 font-mono text-sky-800 bg-white px-2 py-0.5 rounded-lg border border-sky-200">
                          <span>Tx: {viewResult.logTxHash.slice(0, 8)}…{viewResult.logTxHash.slice(-6)}</span>
                          <button
                            type="button"
                            onClick={() => handleCopyModal(viewResult.logTxHash, "logTxHash")}
                            className="p-0.5 text-slate-400 hover:text-sky-700"
                            title="Copy transaction hash"
                          >
                            {copiedModalField === "logTxHash" ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── File Content (Rendered ONLY if verified) ──────────────── */}
                  {viewResult.isVerified && viewResult.blobUrl && (
                    <div className="space-y-4 pt-1">
                      <div className="flex items-center justify-between text-xs text-slate-700 font-semibold border-b border-slate-100 pb-2">
                        <span className="flex items-center space-x-1.5">
                          <FileText className="w-4 h-4 text-teal-700" />
                          <span>Decrypted Record Preview</span>
                        </span>
                        <span className="text-slate-500 font-normal">
                          {(viewResult.fileSize / 1024).toFixed(1)} KB • {viewResult.mimeInfo.mime}
                        </span>
                      </div>

                      {/* Image Preview */}
                      {viewResult.mimeInfo.isImage && (
                        <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-center">
                          <img
                            src={viewResult.blobUrl}
                            alt="Decrypted Medical Record"
                            className="max-h-96 mx-auto rounded-xl object-contain shadow-sm"
                          />
                        </div>
                      )}

                      {/* PDF Preview */}
                      {viewResult.mimeInfo.isPdf && (
                        <div className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-50">
                          <iframe
                            src={viewResult.blobUrl}
                            title="Decrypted PDF Record"
                            className="w-full h-96 rounded-2xl"
                          />
                        </div>
                      )}

                      {/* Text / JSON Preview */}
                      {viewResult.mimeInfo.isText && (
                        <div className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 p-4">
                          <pre className="text-xs font-mono text-slate-800 whitespace-pre-wrap break-all max-h-80 overflow-y-auto">
                            {viewResult.mimeInfo.textContent}
                          </pre>
                        </div>
                      )}

                      {/* Download button */}
                      <div className="pt-2">
                        <a
                          href={viewResult.blobUrl}
                          download={`medical-record-${activeViewModal.id}.${viewResult.mimeInfo.ext}`}
                          className="w-full flex items-center justify-center space-x-2 py-3 px-5 rounded-xl text-xs font-semibold text-white bg-teal-800 hover:bg-teal-700 shadow-sm transition-colors"
                        >
                          <Download className="w-4 h-4 text-white" />
                          <span>Download Decrypted Medical Record</span>
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button
                type="button"
                onClick={handleCloseModal}
                disabled={isViewing}
                className="px-5 py-2 rounded-xl text-xs font-semibold bg-slate-200 hover:bg-slate-300 text-slate-800 transition-colors disabled:opacity-40"
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

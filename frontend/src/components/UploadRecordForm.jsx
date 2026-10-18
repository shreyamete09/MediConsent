/**
 * @file UploadRecordForm.jsx
 * @notice Hospital uploads an encrypted medical record for a patient.
 *
 * Full browser-side pipeline:
 *   1. SHA-256 hash of original plaintext file (for on-chain tamper detection)
 *   2. Fetch patient's RSA public key from smart contract (on-chain PKI)
 *   3. Generate fresh AES-256-GCM key
 *   4. Encrypt file with AES key (fresh 12-byte random IV)
 *   5. Wrap AES key with patient's RSA public key → wrappedKeyForPatient
 *   6. POST encrypted blob to backend /upload → IPFS CID
 *   7. POST wrapped key envelope to backend /key-envelope
 *   8. Call contract.addRecord(patient, recordType, cid, hash) on-chain
 *   9. Log record ID returned in the success banner
 *
 * SECURITY: Private keys never leave the browser. The backend sees only
 * encrypted ciphertext and an RSA-encrypted AES key — both unreadable without
 * the correct private key.
 */

import React, { useState, useRef } from "react";
import { useWeb3 } from "../context/Web3Context";
import { generateAesKey, encryptFile } from "../crypto/aes.js";
import { importPublicKey, wrapAesKey } from "../crypto/rsa.js";
import { computeFileHash } from "../crypto/hash.js";
import TxStatus from "./TxStatus.jsx";
import { FileUp, ShieldCheck, Lock } from "lucide-react";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:5001";

const RECORD_TYPES = [
  { value: 0, label: "General" },
  { value: 1, label: "Cardiology" },
  { value: 2, label: "Radiology" },
  { value: 3, label: "Pathology" },
  { value: 4, label: "Neurology" },
  { value: 5, label: "Oncology" },
];

export default function UploadRecordForm({ onSuccess }) {
  const { contract, account } = useWeb3();

  const [patientAddress, setPatientAddress] = useState("");
  const [recordType, setRecordType] = useState(0);
  const [file, setFile] = useState(null);
  const [txStatus, setTxStatus] = useState({ status: "idle", message: "" });
  const [lastRecord, setLastRecord] = useState(null);
  const fileInputRef = useRef(null);

  const setStatus = (status, message) => setTxStatus({ status, message });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!contract || !account || !file || !patientAddress) return;

    setLastRecord(null);

    try {
      // ── Step 1: Hash the original plaintext file ────────────────────────
      setStatus("encrypting", "🔒 Computing SHA-256 hash of original file…");
      const fileBuffer = await file.arrayBuffer();
      const recordHash = await computeFileHash(fileBuffer);

      // ── Step 2: Fetch patient's RSA public key from smart contract ──────
      setStatus("encrypting", "🔒 Fetching patient RSA public key from on-chain registry…");
      const patientKeyB64 = await contract.patientPublicKeys(patientAddress);
      if (!patientKeyB64) {
        throw new Error(
          "Patient has not registered a public key on-chain. Ask them to visit MediConsent and register first."
        );
      }
      const patientRsaPublicKey = await importPublicKey(patientKeyB64);

      // ── Step 3: Generate fresh AES-256-GCM key ──────────────────────────
      setStatus("encrypting", "🔒 Generating AES-256-GCM key…");
      const aesKey = await generateAesKey();

      // ── Step 4: Encrypt file in browser ─────────────────────────────────
      setStatus("encrypting", "🔒 Encrypting file with AES-256-GCM in your browser… (no data sent yet)");
      const { ciphertext, iv } = await encryptFile(new Uint8Array(fileBuffer), aesKey);

      // Build combined payload: [12-byte IV][ciphertext] so the hospital
      // side can split them on download without a separate channel for IV.
      const payload = new Uint8Array(iv.length + ciphertext.length);
      payload.set(iv, 0);
      payload.set(ciphertext, iv.length);

      // ── Step 5: Wrap AES key with patient's RSA public key ──────────────
      setStatus("encrypting", "🔒 Wrapping AES key with patient's RSA-OAEP public key…");
      const wrappedKeyForPatient = await wrapAesKey(aesKey, patientRsaPublicKey);

      // ── Step 6: Upload encrypted blob to backend ────────────────────────
      setStatus("uploading", "⬆ Uploading encrypted ciphertext to storage relay…");
      const formData = new FormData();
      formData.append("file", new Blob([payload], { type: "application/octet-stream" }), `${file.name}.enc`);

      const uploadRes = await fetch(`${BACKEND_URL}/upload`, {
        method: "POST",
        body: formData,
      });
      if (!uploadRes.ok) {
        const err = await uploadRes.json();
        throw new Error(`Upload failed: ${err.error}`);
      }
      const { cid } = await uploadRes.json();

      // ── Step 7: Store wrapped AES key envelope for patient ───────────────
      setStatus("uploading", "⬆ Storing encrypted key envelope for patient…");
      // We temporarily use recordId "pending" and update it after on-chain tx
      const envelopeRes = await fetch(`${BACKEND_URL}/key-envelope`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordId: `pending_${Date.now()}`,
          hospitalAddress: account,
          patientAddress: patientAddress,
          recordType: recordType,
          wrappedKey: wrappedKeyForPatient,
        }),
      });
      if (!envelopeRes.ok) {
        const err = await envelopeRes.json();
        throw new Error(`Key envelope storage failed: ${err.error}`);
      }

      // ── Step 8: Call addRecord on-chain ──────────────────────────────────
      setStatus("confirming", "⛓ Sending addRecord transaction to smart contract… (confirm in MetaMask)");
      const tx = await contract.addRecord(patientAddress, recordType, cid, recordHash);

      setStatus("confirming", `⛓ Waiting for confirmation… (tx: ${tx.hash.slice(0, 10)}…)`);
      const receipt = await tx.wait();

      // Parse RecordAdded event to get the assigned recordId
      const iface = contract.interface;
      const recordAddedEvent = receipt.logs
        .map((log) => { try { return iface.parseLog(log); } catch { return null; } })
        .find((e) => e && e.name === "RecordAdded");

      const recordId = recordAddedEvent ? recordAddedEvent.args.recordId.toString() : "?";

      // ── Step 9: Update envelope with real recordId ────────────────────────
      if (recordId !== "?") {
        await fetch(`${BACKEND_URL}/key-envelope`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recordId: recordId,
            hospitalAddress: account,
            patientAddress: patientAddress,
            recordType: recordType,
            wrappedKey: wrappedKeyForPatient,
          }),
        });
      }

      setLastRecord({ recordId, cid, recordHash, txHash: tx.hash });
      setStatus(
        "success",
        `✅ Record #${recordId} added on-chain. CID: ${cid.slice(0, 20)}… | Tx: ${tx.hash.slice(0, 10)}…`
      );

      // Reset form
      setFile(null);
      setPatientAddress("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      onSuccess?.({ recordId, cid, recordHash });
    } catch (err) {
      console.error("[UploadRecord] Error:", err);
      setStatus("error", `Error: ${err.reason || err.message}`);
    }
  };

  const isDisabled = txStatus.status === "encrypting" ||
                     txStatus.status === "uploading" ||
                     txStatus.status === "confirming";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Encryption assurance banner */}
      <div className="flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/25 text-emerald-300 text-xs font-medium">
        <Lock className="w-4 h-4 flex-shrink-0" />
        <span>Encrypted in your browser before upload — the server never sees plaintext medical data</span>
      </div>

      {/* Patient address */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-300">Patient Wallet Address</label>
        <input
          type="text"
          placeholder="0x..."
          value={patientAddress}
          onChange={(e) => setPatientAddress(e.target.value.trim())}
          required
          disabled={isDisabled}
          className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 placeholder-slate-600 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-50 font-mono"
        />
      </div>

      {/* Record type */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-300">Record Type</label>
        <select
          value={recordType}
          onChange={(e) => setRecordType(Number(e.target.value))}
          disabled={isDisabled}
          className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
        >
          {RECORD_TYPES.map((rt) => (
            <option key={rt.value} value={rt.value}>{rt.label}</option>
          ))}
        </select>
      </div>

      {/* File picker */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-300">Medical Record File</label>
        <div
          className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer
            ${file ? "border-emerald-500/60 bg-emerald-950/20" : "border-slate-700 hover:border-slate-500"}
            ${isDisabled ? "opacity-50 pointer-events-none" : ""}`}
          onClick={() => fileInputRef.current?.click()}
        >
          <FileUp className={`w-8 h-8 mx-auto mb-2 ${file ? "text-emerald-400" : "text-slate-600"}`} />
          {file ? (
            <div>
              <p className="text-sm font-medium text-emerald-400">{file.name}</p>
              <p className="text-xs text-slate-500 mt-0.5">{(file.size / 1024).toFixed(1)} KB</p>
            </div>
          ) : (
            <div>
              <p className="text-sm text-slate-400">Click to select a file</p>
              <p className="text-xs text-slate-600 mt-0.5">PDF, JPEG, PNG, DICOM — max 25 MB</p>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.dcm"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </div>
      </div>

      {/* Transaction status */}
      <TxStatus status={txStatus.status} message={txStatus.message} />

      {/* Submit */}
      <button
        type="submit"
        disabled={isDisabled || !file || !patientAddress || !contract}
        className="w-full flex items-center justify-center space-x-2 py-3 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 shadow-lg shadow-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
      >
        <ShieldCheck className="w-4 h-4" />
        <span>
          {isDisabled ? "Processing…" : "Encrypt & Upload Record"}
        </span>
      </button>

      {/* Not a hospital warning */}
      {!contract && (
        <p className="text-xs text-center text-amber-400">Connect MetaMask to continue</p>
      )}
    </form>
  );
}

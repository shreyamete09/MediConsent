/**
 * @file PatientPage.jsx
 * @notice Patient dashboard for MediConsent.
 * Phase 4B-2A (Piece 1):
 *   - Role guard (Patient role check + 1-click self-registration if unregistered).
 *   - Local keystore (RSA-OAEP 2048-bit key pair, backup download, key import).
 *   - On-chain public key registration via setPatientPublicKey.
 *   - Warning if key is registered/changed after records were already uploaded.
 *   - List of patient's medical records retrieved from on-chain RecordAdded events.
 *   - Full transaction status tracking (TxStatus) with loading/empty states.
 */

import React, { useState, useEffect, useCallback } from "react";
import { useWeb3 } from "../context/Web3Context";
import { useKeystore } from "../hooks/useKeystore.js";
import { useContractEvents, recordTypeLabel } from "../hooks/useContractEvents.js";
import KeystoreManager from "../components/KeystoreManager.jsx";
import PendingRequestsPanel from "../components/PendingRequestsPanel.jsx";
import ActiveConsentsPanel from "../components/ActiveConsentsPanel.jsx";
import TxStatus from "../components/TxStatus.jsx";
import {
  User,
  KeyRound,
  FileText,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Building2,
  Hash,
  ExternalLink,
  Copy,
  RefreshCw,
} from "lucide-react";

export default function PatientPage() {
  const { account, role, contract, refreshRole } = useWeb3();
  const {
    publicKey,
    privateKey,
    publicKeyB64,
    isLoading: isKeyLoading,
    error: keyError,
    downloadBackup,
    importFromFile,
  } = useKeystore(account);

  const [onChainPublicKey, setOnChainPublicKey] = useState(null);
  const [isLoadingOnChainKey, setIsLoadingOnChainKey] = useState(false);
  const [txStatus, setTxStatus] = useState({ status: "idle", message: "" });
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [copiedField, setCopiedField] = useState(null);

  const setStatus = (status, message) => setTxStatus({ status, message });

  // Query all RecordAdded events where indexed patient == account
  const {
    events: recordEvents,
    isLoading: recordsLoading,
    error: recordsError,
    refetch: refetchRecords,
  } = useContractEvents(
    contract,
    "RecordAdded",
    account ? [null, account] : [],
    [account, refreshTrigger]
  );

  // Fetch on-chain public key for connected patient
  const fetchOnChainKey = useCallback(async () => {
    if (!contract || !account) return;
    setIsLoadingOnChainKey(true);
    try {
      const key = await contract.patientPublicKeys(account);
      setOnChainPublicKey(key || "");
    } catch (err) {
      console.warn("Error fetching on-chain public key:", err);
      setOnChainPublicKey("");
    } finally {
      setIsLoadingOnChainKey(false);
    }
  }, [contract, account]);

  useEffect(() => {
    fetchOnChainKey();
  }, [fetchOnChainKey, refreshTrigger]);

  // Copy helper
  const handleCopy = (text, fieldId) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Self-register as patient if unregistered
  const handleRegisterPatient = async () => {
    if (!contract) return;
    try {
      setStatus("confirming", "⛓ Registering as a patient on-chain… Please confirm in MetaMask");
      const tx = await contract.registerPatient();
      setStatus("confirming", `⛓ Waiting for block confirmation… (tx: ${tx.hash.slice(0, 10)}…)`);
      await tx.wait();
      setStatus("success", "✅ Successfully registered as a Patient on-chain!");
      await refreshRole();
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error("Patient registration error:", err);
      setStatus("error", `Registration failed: ${err.reason || err.message}`);
    }
  };

  // Register local RSA public key on-chain
  const handleRegisterPublicKey = async () => {
    if (!contract || !publicKeyB64) return;
    try {
      setStatus("confirming", "⛓ Registering your RSA public key on-chain… Please confirm in MetaMask");
      const tx = await contract.setPatientPublicKey(publicKeyB64);
      setStatus("confirming", `⛓ Waiting for block confirmation… (tx: ${tx.hash.slice(0, 10)}…)`);
      await tx.wait();
      setStatus(
        "success",
        `✅ Public key registered on-chain! Hospitals can now wrap medical record keys for you.`
      );
      await fetchOnChainKey();
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error("Key registration error:", err);
      setStatus("error", `Key registration failed: ${err.reason || err.message}`);
    }
  };

  const isTxBusy =
    txStatus.status === "confirming" || txStatus.status === "uploading";

  const isKeyRegisteredOnChain =
    Boolean(onChainPublicKey) && onChainPublicKey.length > 0;
  const isKeySynced =
    isKeyRegisteredOnChain && onChainPublicKey === publicKeyB64;
  const hasExistingRecords = recordEvents && recordEvents.length > 0;

  // ── Access guard: No wallet connected ──────────────────────────────────────
  if (!account) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-20 text-center space-y-4">
        <User className="w-14 h-14 text-slate-700 mx-auto" />
        <h2 className="text-xl font-bold text-slate-300">Connect Your Wallet</h2>
        <p className="text-slate-400 text-sm max-w-md mx-auto">
          Please connect MetaMask to access your patient medical records, manage consent, and review access logs.
        </p>
      </div>
    );
  }

  // ── Access guard: Connected as Hospital ─────────────────────────────────────
  if (role === "Hospital") {
    return (
      <div className="max-w-4xl mx-auto px-6 py-20 text-center space-y-4">
        <AlertTriangle className="w-14 h-14 text-amber-400 mx-auto" />
        <h2 className="text-xl font-bold text-slate-200">Hospital Account Detected</h2>
        <p className="text-slate-400 text-sm max-w-md mx-auto">
          You are currently connected with a verified Hospital account. Please switch to your personal patient account in MetaMask to view the Patient Dashboard.
        </p>
        <p className="text-xs font-mono text-slate-500">Connected: {account}</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 space-y-8">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-950/80 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-500/10">
            <User className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center space-x-2">
              <span>Patient Dashboard</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-500/30 font-mono font-medium">
                Self-Sovereign
              </span>
            </h1>
            <p className="text-xs text-slate-400 font-mono mt-0.5">{account}</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => {
              fetchOnChainKey();
              refetchRecords();
            }}
            disabled={recordsLoading || isLoadingOnChainKey}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-slate-900 border border-slate-700 text-slate-300 hover:text-white hover:border-slate-600 transition-colors disabled:opacity-50"
            title="Refresh on-chain data"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${
                recordsLoading || isLoadingOnChainKey ? "animate-spin" : ""
              }`}
            />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* ── Unregistered Patient Banner ──────────────────────────────────── */}
      {role === "Unregistered" && (
        <div className="glass-panel p-6 rounded-2xl border border-amber-500/40 bg-amber-950/20 space-y-3">
          <div className="flex items-center space-x-2 text-amber-300 font-semibold text-sm">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>Registration Required</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Your address is not yet registered on the MediConsent smart contract.
            Patients must self-register once to be eligible to receive records and grant consent.
          </p>
          <button
            onClick={handleRegisterPatient}
            disabled={isTxBusy}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md transition-colors disabled:opacity-50"
          >
            {isTxBusy ? "Processing…" : "Register as Patient On-Chain (1-Click)"}
          </button>
        </div>
      )}

      {/* ── Transaction Status Banner ────────────────────────────────────── */}
      <TxStatus status={txStatus.status} message={txStatus.message} />

      {/* ── Top Grid: Cryptographic Identity & Public Key Registration ─────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Local Keystore Manager */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-300 flex items-center space-x-2">
            <KeyRound className="w-4 h-4 text-emerald-400" />
            <span>Client-Side RSA Keystore</span>
          </h3>
          <KeystoreManager
            publicKeyB64={publicKeyB64}
            isLoading={isKeyLoading}
            error={keyError}
            downloadBackup={downloadBackup}
            importFromFile={importFromFile}
          />
        </div>

        {/* Right 2 Columns: On-Chain Public Key PKI Status */}
        <div className="lg:col-span-2">
          <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <span>On-Chain Public Key Registry</span>
              </h3>

              {isLoadingOnChainKey ? (
                <span className="text-xs text-slate-400 animate-pulse">
                  Querying contract…
                </span>
              ) : isKeySynced ? (
                <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-950/70 text-emerald-300 border border-emerald-500/30">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Key Synchronized On-Chain</span>
                </span>
              ) : isKeyRegisteredOnChain ? (
                <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-950/70 text-amber-300 border border-amber-500/30">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Key Differs from Local Browser</span>
                </span>
              ) : (
                <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-950/70 text-rose-300 border border-rose-500/30">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Not Registered On-Chain</span>
                </span>
              )}
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Hospitals encrypt each medical file with a symmetric AES-256-GCM key and wrap that key with your
              public key. To receive encrypted records from hospitals, your RSA public key must be published
              to the MediConsent smart contract.
            </p>

            {/* Warning: If records already exist and key is being changed/registered */}
            {hasExistingRecords && !isKeySynced && (
              <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/30 text-xs text-amber-300 space-y-1">
                <p className="font-semibold flex items-center space-x-1.5">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>Important Key Continuity Notice</span>
                </p>
                <p className="text-amber-200/90 text-[11px]">
                  You already have {recordEvents.length} medical record(s) on-chain. Each record's AES key was wrapped
                  using the public key registered at the time of upload. If you register a different key, you will not
                  be able to unwrap or re-share previous records unless you restore the matching private key from backup.
                </p>
              </div>
            )}

            {/* On-Chain Key Display or Action */}
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">On-Chain Key Value:</span>
                {isKeyRegisteredOnChain && (
                  <button
                    onClick={() => handleCopy(onChainPublicKey, "onChainKey")}
                    className="text-[11px] text-slate-400 hover:text-emerald-400 flex items-center space-x-1 transition-colors"
                  >
                    <Copy className="w-3 h-3" />
                    <span>{copiedField === "onChainKey" ? "Copied!" : "Copy"}</span>
                  </button>
                )}
              </div>

              {isKeyRegisteredOnChain ? (
                <p className="font-mono text-[10px] text-slate-400 break-all bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
                  {onChainPublicKey}
                </p>
              ) : (
                <p className="text-xs text-slate-500 italic">
                  No public key currently recorded on-chain for this address.
                </p>
              )}

              {/* Action Button */}
              {(!isKeyRegisteredOnChain || !isKeySynced) && (
                <button
                  onClick={handleRegisterPublicKey}
                  disabled={isTxBusy || !publicKeyB64 || role !== "Patient"}
                  className="w-full flex items-center justify-center space-x-2 py-2.5 rounded-xl font-semibold text-xs text-white bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 shadow-md shadow-emerald-500/15 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  <KeyRound className="w-4 h-4" />
                  <span>
                    {isTxBusy
                      ? "Submitting to Blockchain…"
                      : isKeyRegisteredOnChain
                      ? "Update On-Chain Public Key to Match Local Key"
                      : "Register My Public Key On-Chain"}
                  </span>
                </button>
              )}

              {role !== "Patient" && (
                <p className="text-[11px] text-amber-400 text-center">
                  Register as a patient first to publish your public key.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Section: Pending Access Requests & Approval ──────────────────── */}
      {role === "Patient" && (
        <PendingRequestsPanel
          privateKey={privateKey}
          recordEvents={recordEvents}
          onConsentGranted={() => setRefreshTrigger((prev) => prev + 1)}
        />
      )}

      {/* ── Section: Active & Granted Consents (Revocation) ──────────────── */}
      {role === "Patient" && (
        <ActiveConsentsPanel
          refreshTrigger={refreshTrigger}
          onConsentRevoked={() => setRefreshTrigger((prev) => prev + 1)}
        />
      )}

      {/* ── Section: Patient's Medical Records ────────────────────────────── */}
      <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center space-x-2">
              <FileText className="w-5 h-5 text-blue-400" />
              <span>My Medical Records</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-950 text-blue-300 border border-blue-500/30">
                {recordEvents ? recordEvents.length : 0}
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Encrypted records uploaded by verified hospitals. Plaintext files are never stored on-chain.
            </p>
          </div>
        </div>

        {/* Loading State */}
        {recordsLoading && (
          <div className="py-12 text-center space-y-3">
            <RefreshCw className="w-6 h-6 text-emerald-400 animate-spin mx-auto" />
            <p className="text-xs text-slate-400">Querying on-chain record events…</p>
          </div>
        )}

        {/* Error State */}
        {recordsError && (
          <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-500/30 text-xs text-rose-300">
            Error loading records: {recordsError}
          </div>
        )}

        {/* Empty State */}
        {!recordsLoading && !recordsError && (!recordEvents || recordEvents.length === 0) && (
          <div className="glass-card rounded-xl p-10 text-center border border-slate-800 space-y-3">
            <FileText className="w-10 h-10 text-slate-700 mx-auto" />
            <h4 className="text-sm font-semibold text-slate-300">No Records Found</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
              No hospital has uploaded medical records for this patient wallet yet.
              When a hospital uploads a record, it will appear here with its tamper-proof hash and IPFS CID.
            </p>
          </div>
        )}

        {/* Records Table / Cards */}
        {!recordsLoading && recordEvents && recordEvents.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {recordEvents.map((evt, idx) => {
              const recordId = evt.args?.recordId?.toString() || `#${idx + 1}`;
              const hospitalAddr = evt.args?.hospital || "";
              const recordTypeNum = evt.args?.recordType;
              const typeName = recordTypeLabel(recordTypeNum);
              const ipfsCid = evt.args?.ipfsCid || "";
              const recordHash = evt.args?.recordHash || "";
              const timestampSec = Number(evt.args?.timestamp || 0);
              const formattedDate = timestampSec
                ? new Date(timestampSec * 1000).toLocaleString()
                : "Block timestamp";

              return (
                <div
                  key={evt.transactionHash + recordId}
                  className="glass-card rounded-xl p-4 border border-slate-800/80 hover:border-slate-700 transition-all space-y-3"
                >
                  {/* Top: Record ID & Type */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-white px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700">
                        Record #{recordId}
                      </span>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-500/25">
                        {typeName}
                      </span>
                    </div>

                    <div className="flex items-center space-x-1 text-[11px] text-slate-400">
                      <Clock className="w-3 h-3" />
                      <span>{formattedDate}</span>
                    </div>
                  </div>

                  {/* Uploading Hospital */}
                  <div className="flex items-center justify-between text-xs bg-slate-950/40 p-2 rounded-lg border border-slate-800/60">
                    <span className="text-slate-400 flex items-center space-x-1.5">
                      <Building2 className="w-3.5 h-3.5 text-blue-400" />
                      <span>Hospital:</span>
                    </span>
                    <span className="font-mono text-slate-300 text-[11px]">
                      {hospitalAddr.slice(0, 8)}…{hospitalAddr.slice(-6)}
                    </span>
                  </div>

                  {/* IPFS CID */}
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">Encrypted IPFS CID:</span>
                      <button
                        onClick={() => handleCopy(ipfsCid, `cid-${recordId}`)}
                        className="text-slate-500 hover:text-emerald-400 flex items-center space-x-0.5 transition-colors"
                      >
                        <Copy className="w-2.5 h-2.5" />
                        <span>{copiedField === `cid-${recordId}` ? "Copied" : "Copy"}</span>
                      </button>
                    </div>
                    <p className="font-mono text-[10px] text-slate-400 truncate bg-slate-900/60 px-2 py-1 rounded border border-slate-800">
                      {ipfsCid}
                    </p>
                  </div>

                  {/* Integrity Hash */}
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400 flex items-center space-x-1">
                        <Hash className="w-3 h-3 text-emerald-400" />
                        <span>On-Chain SHA-256:</span>
                      </span>
                      <button
                        onClick={() => handleCopy(recordHash, `hash-${recordId}`)}
                        className="text-slate-500 hover:text-emerald-400 flex items-center space-x-0.5 transition-colors"
                      >
                        <Copy className="w-2.5 h-2.5" />
                        <span>{copiedField === `hash-${recordId}` ? "Copied" : "Copy"}</span>
                      </button>
                    </div>
                    <p className="font-mono text-[10px] text-slate-400 truncate bg-slate-900/60 px-2 py-1 rounded border border-slate-800">
                      {recordHash}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

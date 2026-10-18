/**
 * @file PendingRequestsPanel.jsx
 * @notice Renders pending access requests for the connected patient with the full
 *         client-side unwrap/re-wrap/grantConsent approval flow.
 *
 * SECURITY:
 *   - The patient's RSA private key never leaves the browser.
 *   - The hospital's RSA public key is fetched from the smart contract.
 *   - AES keys are decrypted (unwrapped) and re-encrypted (re-wrapped) entirely in browser memory.
 *   - Backend only receives the newly wrapped key envelope for the recipient hospital.
 */

import React, { useState, useEffect, useMemo } from "react";
import { ethers } from "ethers";
import { useWeb3 } from "../context/Web3Context";
import {
  useContractEvents,
  recordTypeLabel,
  deriveRequestDetails,
} from "../hooks/useContractEvents.js";
import { importPublicKey, wrapAesKey, unwrapAesKey } from "../crypto/rsa.js";
import TxStatus from "./TxStatus.jsx";
import {
  Inbox,
  Building2,
  Clock,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileText,
  Lock,
  RefreshCw,
  Copy,
} from "lucide-react";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:5001";

const EXPIRY_OPTIONS = [
  { label: "1 Hour", seconds: 3600 },
  { label: "24 Hours (1 Day)", seconds: 86400 },
  { label: "7 Days (1 Week)", seconds: 604800 },
];

export default function PendingRequestsPanel({
  privateKey,
  recordEvents,
  onConsentGranted,
}) {
  const { account, contract } = useWeb3();

  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [txStatus, setTxStatus] = useState({ status: "idle", message: "" });
  const [selectedExpiries, setSelectedExpiries] = useState({});
  const [dismissedRequests, setDismissedRequests] = useState(() => {
    try {
      const stored = localStorage.getItem(`mediconsent_dismissed_${account}`);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const setStatus = (status, message) => setTxStatus({ status, message });

  // Query AccessRequested events where indexed patient == account
  const {
    events: requestEvents,
    isLoading: isEventsLoading,
    refetch: refetchRequests,
  } = useContractEvents(
    contract,
    "AccessRequested",
    account ? [account] : [],
    [account, refreshTrigger]
  );

  // Derive status for all requests to filter out already-approved requests
  const [requestStatuses, setRequestStatuses] = useState({});
  const [isResolving, setIsResolving] = useState(false);

  useEffect(() => {
    if (!contract || !account || !requestEvents || requestEvents.length === 0) {
      setRequestStatuses({});
      return;
    }

    let isMounted = true;
    (async () => {
      setIsResolving(true);
      const statusMap = {};

      for (const evt of requestEvents) {
        const hospital = evt.args?.hospital;
        const types = evt.args?.recordTypes || [];
        const key = `${evt.transactionHash}_${hospital}`;

        try {
          const details = await deriveRequestDetails(contract, account, hospital, types);
          statusMap[key] = details;
        } catch {
          statusMap[key] = { status: "pending", expiry: 0n };
        }
      }

      if (isMounted) {
        setRequestStatuses(statusMap);
        setIsResolving(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [contract, account, requestEvents, refreshTrigger]);

  // Filter pending requests: exclude dismissed and exclude already active/approved consents
  const pendingRequests = useMemo(() => {
    if (!requestEvents) return [];
    return requestEvents.filter((evt) => {
      const hospital = evt.args?.hospital;
      const key = `${evt.transactionHash}_${hospital}`;
      if (dismissedRequests.includes(key)) return false;
      const details = requestStatuses[key];
      // Hide if consent is currently active / approved
      if (details && details.status === "approved") return false;
      return true;
    });
  }, [requestEvents, dismissedRequests, requestStatuses]);

  // Handle Reject (UI-only dismiss)
  const handleReject = (key) => {
    const updated = [...dismissedRequests, key];
    setDismissedRequests(updated);
    try {
      localStorage.setItem(`mediconsent_dismissed_${account}`, JSON.stringify(updated));
    } catch {}
  };

  // ── APPROVE FLOW ────────────────────────────────────────────────────────────
  const handleApprove = async (evt) => {
    if (!contract || !account) return;

    const hospitalAddress = evt.args?.hospital;
    const requestedTypes = (evt.args?.recordTypes || []).map((t) => Number(t));
    const reqKey = `${evt.transactionHash}_${hospitalAddress}`;
    const durationSeconds = selectedExpiries[reqKey] || 86400; // default 24h

    try {
      // 1. Private key check
      if (!privateKey) {
        throw new Error(
          "Your patient RSA private key is not loaded in this browser. Please import your keystore backup to approve requests."
        );
      }

      // 2. Identify patient records matching requested categories
      setStatus("encrypting", "🔒 Locating patient records in requested categories…");
      const matchingRecords = (recordEvents || []).filter((r) => {
        const recType = Number(r.args?.recordType);
        return requestedTypes.includes(recType);
      });

      if (matchingRecords.length === 0) {
        setStatus(
          "error",
          `No records found in requested categories (${requestedTypes.map((t) => recordTypeLabel(t)).join(", ")}). Consent cannot be granted without matching records.`
        );
        return;
      }

      // 3. Read hospital's on-chain public key
      setStatus("encrypting", "🔒 Fetching hospital's RSA public key from smart contract…");
      const hospitalInfo = await contract.hospitals(hospitalAddress);
      if (!hospitalInfo || !hospitalInfo.isRegistered || !hospitalInfo.rsaPublicKey) {
        throw new Error(
          `Hospital (${hospitalAddress.slice(0, 8)}…) does not have an active RSA public key registered on-chain.`
        );
      }

      const hospitalRsaPublicKey = await importPublicKey(hospitalInfo.rsaPublicKey);

      // 4. Unwrap & Re-wrap AES key for each matching record
      for (let i = 0; i < matchingRecords.length; i++) {
        const rec = matchingRecords[i];
        const recordId = rec.args?.recordId?.toString();
        const recType = Number(rec.args?.recordType);

        setStatus(
          "encrypting",
          `🔒 [${i + 1}/${matchingRecords.length}] Fetching patient envelope for Record #${recordId}…`
        );

        const envRes = await fetch(
          `${BACKEND_URL}/key-envelope/patient/${recordId}?patientAddress=${account}`
        );
        if (!envRes.ok) {
          const err = await envRes.json().catch(() => ({}));
          throw new Error(
            `Failed to fetch patient key envelope for Record #${recordId}: ${err.error || envRes.statusText}`
          );
        }

        const { wrappedKey: patientWrappedKey } = await envRes.json();

        setStatus(
          "encrypting",
          `🔒 [${i + 1}/${matchingRecords.length}] Decrypting AES key with your private key in browser…`
        );
        const aesKey = await unwrapAesKey(patientWrappedKey, privateKey);

        setStatus(
          "encrypting",
          `🔒 [${i + 1}/${matchingRecords.length}] Re-wrapping AES key with hospital's RSA public key…`
        );
        const wrappedKeyForHospital = await wrapAesKey(aesKey, hospitalRsaPublicKey);

        setStatus(
          "uploading",
          `⬆ [${i + 1}/${matchingRecords.length}] Storing re-wrapped key envelope on relay…`
        );
        const postRes = await fetch(`${BACKEND_URL}/key-envelope`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recordId,
            hospitalAddress,
            patientAddress: account,
            recordType: recType,
            wrappedKey: wrappedKeyForHospital,
            recipient: hospitalAddress,
          }),
        });

        if (!postRes.ok) {
          const err = await postRes.json().catch(() => ({}));
          throw new Error(
            `Failed to store hospital key envelope for Record #${recordId}: ${err.error || postRes.statusText}`
          );
        }
      }

      // 5. Submit grantConsent on-chain
      const expiryTimestamp = Math.floor(Date.now() / 1000) + durationSeconds;
      setStatus(
        "confirming",
        "⛓ Submitting grantConsent transaction on-chain… Please confirm in MetaMask"
      );

      const tx = await contract.grantConsent(
        hospitalAddress,
        requestedTypes,
        expiryTimestamp
      );

      setStatus("confirming", `⛓ Waiting for block confirmation… (tx: ${tx.hash.slice(0, 10)}…)`);
      await tx.wait();

      setStatus(
        "success",
        `✅ Consent granted to hospital ${hospitalAddress.slice(0, 8)}… for ${matchingRecords.length} record(s) until ${new Date(
          expiryTimestamp * 1000
        ).toLocaleString()}!`
      );

      setRefreshTrigger((prev) => prev + 1);
      onConsentGranted?.();
    } catch (err) {
      console.error("Approve consent error:", err);
      setStatus("error", `Approval failed: ${err.reason || err.message}`);
    }
  };

  const isTxBusy = txStatus.status === "confirming" || txStatus.status === "uploading" || txStatus.status === "encrypting";

  return (
    <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center space-x-2">
            <Inbox className="w-5 h-5 text-indigo-400" />
            <span>Pending Access Requests</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-500/30">
              {pendingRequests.length}
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Incoming requests from registered hospitals. Approve to re-wrap AES keys and grant time-bound access.
          </p>
        </div>

        <button
          onClick={() => {
            refetchRequests();
            setRefreshTrigger((prev) => prev + 1);
          }}
          disabled={isEventsLoading || isResolving}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-slate-900 border border-slate-700 text-slate-300 hover:text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isEventsLoading || isResolving ? "animate-spin" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Transaction Status Banner */}
      <TxStatus status={txStatus.status} message={txStatus.message} />

      {/* Loading State */}
      {(isEventsLoading || isResolving) && (
        <div className="py-10 text-center space-y-2">
          <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin mx-auto" />
          <p className="text-xs text-slate-400">Loading pending requests & checking consent status…</p>
        </div>
      )}

      {/* Empty State */}
      {!isEventsLoading && !isResolving && pendingRequests.length === 0 && (
        <div className="glass-card rounded-xl p-8 text-center border border-slate-800 space-y-2">
          <CheckCircle2 className="w-8 h-8 text-emerald-500/80 mx-auto" />
          <h4 className="text-sm font-semibold text-slate-300">All Caught Up</h4>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            No pending access requests. When a hospital requests access to your medical records, it will appear here for review.
          </p>
        </div>
      )}

      {/* Pending Requests Cards */}
      {!isEventsLoading && pendingRequests.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {pendingRequests.map((evt) => {
            const hospitalAddress = evt.args?.hospital || "";
            const requestedTypes = (evt.args?.recordTypes || []).map((t) => Number(t));
            const timestampSec = Number(evt.args?.timestamp || 0);
            const reqKey = `${evt.transactionHash}_${hospitalAddress}`;
            const chosenExpiry = selectedExpiries[reqKey] || 86400;

            // Matching records count
            const matchingCount = (recordEvents || []).filter((r) =>
              requestedTypes.includes(Number(r.args?.recordType))
            ).length;

            return (
              <div
                key={reqKey}
                className="glass-card rounded-xl p-4 border border-indigo-950/80 hover:border-indigo-500/30 transition-all space-y-3"
              >
                {/* Top: Hospital & Timestamp */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 text-xs text-slate-300 font-semibold">
                    <Building2 className="w-4 h-4 text-indigo-400" />
                    <span>Hospital Request</span>
                  </div>
                  <span className="text-[10px] text-slate-500 flex items-center space-x-1">
                    <Clock className="w-3 h-3" />
                    <span>
                      {timestampSec ? new Date(timestampSec * 1000).toLocaleString() : ""}
                    </span>
                  </span>
                </div>

                {/* Hospital Address */}
                <div className="flex items-center justify-between text-xs bg-slate-950/50 p-2 rounded-lg border border-slate-800">
                  <span className="text-slate-400 text-[11px]">Requesting Address:</span>
                  <span className="font-mono text-slate-200 text-[11px]">
                    {hospitalAddress.slice(0, 8)}…{hospitalAddress.slice(-6)}
                  </span>
                </div>

                {/* Requested Categories */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400 font-medium">Requested Categories:</span>
                    <span
                      className={`text-[10px] font-semibold ${
                        matchingCount > 0 ? "text-emerald-400" : "text-amber-400"
                      }`}
                    >
                      {matchingCount} matching record(s) found
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {requestedTypes.map((t) => (
                      <span
                        key={t}
                        className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-950/60 text-indigo-300 border border-indigo-500/25"
                      >
                        {recordTypeLabel(t)}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Warning if no matching records */}
                {matchingCount === 0 && (
                  <p className="text-[11px] text-amber-400/90 bg-amber-950/20 p-2 rounded-lg border border-amber-500/20">
                    ⚠ You have no uploaded records in these categories. You can reject or upload records first.
                  </p>
                )}

                {/* Expiry Selector */}
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-slate-400">
                    Consent Expiration Duration:
                  </label>
                  <select
                    value={chosenExpiry}
                    onChange={(e) =>
                      setSelectedExpiries((prev) => ({
                        ...prev,
                        [reqKey]: Number(e.target.value),
                      }))
                    }
                    disabled={isTxBusy}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
                  >
                    {EXPIRY_OPTIONS.map((opt) => (
                      <option key={opt.seconds} value={opt.seconds}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center space-x-2 pt-1">
                  <button
                    onClick={() => handleApprove(evt)}
                    disabled={isTxBusy || matchingCount === 0}
                    className="flex-1 flex items-center justify-center space-x-1.5 py-2 rounded-lg font-semibold text-xs text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-md shadow-emerald-500/15 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Approve & Grant</span>
                  </button>

                  <button
                    onClick={() => handleReject(reqKey)}
                    disabled={isTxBusy}
                    className="px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700 transition-colors"
                  >
                    Reject
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

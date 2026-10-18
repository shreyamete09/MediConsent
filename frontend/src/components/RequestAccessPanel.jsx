/**
 * @file RequestAccessPanel.jsx
 * @notice Hospital portal panel for requesting access to patient records.
 *
 * Requirements:
 * 1. Patient search with address validation and name-less summary (registered status,
 *    public key on-chain status, total record count).
 * 2. Record type checkboxes (from contract's enum). At least one must be selected.
 * 3. "Request Access" button calling contract.requestAccess(patient, recordTypes).
 * 4. TxStatus banner tracking transactions.
 * 5. "My Requests" list with live status: Pending, Approved (with countdown), Expired, Revoked.
 * 6. Guard blocking submission if caller is not a registered hospital.
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { ethers } from "ethers";
import { useWeb3 } from "../context/Web3Context";
import {
  useContractEvents,
  recordTypeLabel,
  formatCountdown,
  deriveRequestDetails,
  RECORD_TYPE_LABELS,
} from "../hooks/useContractEvents.js";
import TxStatus from "./TxStatus.jsx";
import {
  Search,
  Send,
  User,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  RefreshCw,
  FileText,
  KeyRound,
  CheckSquare,
  Square,
} from "lucide-react";

export default function RequestAccessPanel({ isHospitalRegistered }) {
  const { account, contract } = useWeb3();

  // Search & Form State
  const [patientInput, setPatientInput] = useState("");
  const [searchedPatient, setSearchedPatient] = useState(null);
  const [patientSummary, setPatientSummary] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);

  // Record types selection: default General (0) selected
  const [selectedTypes, setSelectedTypes] = useState([0]);

  // TxStatus & Refresh
  const [txStatus, setTxStatus] = useState({ status: "idle", message: "" });
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Live countdown timer state (ticks every second)
  const [nowSec, setNowSec] = useState(Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const setStatus = (status, message) => setTxStatus({ status, message });

  // ── 1. Search Patient on-chain ──────────────────────────────────────────────
  const handleSearchPatient = useCallback(
    async (addressToSearch) => {
      const addr = (addressToSearch || patientInput).trim();
      setSearchError(null);
      setPatientSummary(null);
      setSearchedPatient(null);

      if (!addr) return;

      if (!ethers.isAddress(addr)) {
        setSearchError("Invalid Ethereum address format. Must be a 42-character 0x-prefixed hex string.");
        return;
      }

      if (!contract) return;

      setIsSearching(true);
      try {
        const [isRegistered, pubKey] = await Promise.all([
          contract.isPatientRegistered(addr),
          contract.patientPublicKeys(addr),
        ]);

        let recordCount = 0;
        if (isRegistered) {
          try {
            const ids = await contract.getPatientRecordIds(addr);
            recordCount = ids ? ids.length : 0;
          } catch {
            recordCount = 0;
          }
        }

        setSearchedPatient(addr);
        setPatientSummary({
          address: addr,
          isRegistered,
          hasPublicKey: Boolean(pubKey && pubKey.length > 0),
          publicKeySnippet: pubKey ? `${pubKey.slice(0, 28)}…` : null,
          recordCount,
        });
      } catch (err) {
        console.error("Patient search error:", err);
        setSearchError(`Failed to fetch patient data: ${err.message}`);
      } finally {
        setIsSearching(false);
      }
    },
    [contract, patientInput]
  );

  // Auto-search when valid address is pasted/entered
  useEffect(() => {
    const trimmed = patientInput.trim();
    if (ethers.isAddress(trimmed) && trimmed !== searchedPatient) {
      handleSearchPatient(trimmed);
    }
  }, [patientInput, searchedPatient, handleSearchPatient]);

  // ── 2. Toggle record type checkbox ──────────────────────────────────────────
  const toggleRecordType = (typeIndex) => {
    setSelectedTypes((prev) =>
      prev.includes(typeIndex)
        ? prev.filter((t) => t !== typeIndex)
        : [...prev, typeIndex].sort((a, b) => a - b)
    );
  };

  // ── 3. Submit requestAccess on-chain ─────────────────────────────────────────
  const handleRequestAccess = async (e) => {
    e.preventDefault();
    if (!contract || !account || !searchedPatient || selectedTypes.length === 0) return;

    if (!isHospitalRegistered) {
      setStatus("error", "Only verified hospitals registered on-chain can request access.");
      return;
    }

    try {
      setStatus(
        "confirming",
        `⛓ Requesting access for ${selectedTypes.length} record type(s)… Please confirm in MetaMask`
      );
      const tx = await contract.requestAccess(searchedPatient, selectedTypes);
      setStatus("confirming", `⛓ Waiting for block confirmation… (tx: ${tx.hash.slice(0, 10)}…)`);
      await tx.wait();

      setStatus(
        "success",
        `✅ Access request submitted on-chain for patient ${searchedPatient.slice(0, 8)}…!`
      );
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error("Request access error:", err);
      setStatus("error", `Access request failed: ${err.reason || err.message}`);
    }
  };

  // ── 4. Query AccessRequested events for connected hospital ──────────────────
  const {
    events: requestEvents,
    isLoading: isRequestsLoading,
    refetch: refetchRequests,
  } = useContractEvents(
    contract,
    "AccessRequested",
    account ? [null, account] : [],
    [account, refreshTrigger]
  );

  // Map request statuses using live contract views
  const [requestStatuses, setRequestStatuses] = useState({});
  const [isResolvingStatuses, setIsResolvingStatuses] = useState(false);

  useEffect(() => {
    if (!contract || !requestEvents || requestEvents.length === 0) {
      setRequestStatuses({});
      return;
    }

    let isMounted = true;
    (async () => {
      setIsResolvingStatuses(true);
      const statusMap = {};

      for (const evt of requestEvents) {
        const patient = evt.args?.patient;
        const types = evt.args?.recordTypes || [];
        const key = `${evt.transactionHash}_${patient}`;

        try {
          const details = await deriveRequestDetails(contract, patient, account, types);
          statusMap[key] = details;
        } catch {
          statusMap[key] = { status: "pending", expiry: 0n };
        }
      }

      if (isMounted) {
        setRequestStatuses(statusMap);
        setIsResolvingStatuses(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [contract, account, requestEvents, refreshTrigger]);

  const isTxBusy = txStatus.status === "confirming" || txStatus.status === "uploading";

  return (
    <div className="space-y-8">
      {/* ── Form: Request Access ───────────────────────────────────────────── */}
      <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-5">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center space-x-2">
            <Send className="w-5 h-5 text-blue-400" />
            <span>Request Patient Access</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            Search for a patient address, select the clinical categories you need, and submit an on-chain
            consent request. The patient must approve and wrap the encryption keys for your hospital before access is granted.
          </p>
        </div>

        {/* Not registered warning */}
        {isHospitalRegistered === false && (
          <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/30 text-xs text-rose-300 flex items-start space-x-2">
            <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              Your wallet is not registered as a hospital on the smart contract. Access requests can only be sent by registered hospitals.
            </span>
          </div>
        )}

        <form onSubmit={handleRequestAccess} className="space-y-5">
          {/* Patient Search Input */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-300">
              Patient Wallet Address
            </label>
            <div className="flex space-x-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="0x..."
                  value={patientInput}
                  onChange={(e) => setPatientInput(e.target.value.trim())}
                  disabled={isTxBusy || !isHospitalRegistered}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 placeholder-slate-600 text-xs font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>
              <button
                type="button"
                onClick={() => handleSearchPatient()}
                disabled={isSearching || isTxBusy || !patientInput || !isHospitalRegistered}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium flex items-center space-x-1.5 disabled:opacity-50 transition-colors"
              >
                <Search className={`w-3.5 h-3.5 ${isSearching ? "animate-spin" : ""}`} />
                <span>{isSearching ? "Checking…" : "Lookup"}</span>
              </button>
            </div>

            {searchError && (
              <p className="text-xs text-rose-400 flex items-center space-x-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>{searchError}</span>
              </p>
            )}

            {/* Patient Name-less Summary Card */}
            {patientSummary && (
              <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-700/80 space-y-2.5 animate-fadeIn">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-200 flex items-center space-x-1.5">
                    <User className="w-3.5 h-3.5 text-blue-400" />
                    <span>Patient Profile Summary</span>
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">
                    {patientSummary.address.slice(0, 10)}…{patientSummary.address.slice(-6)}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                  {/* Registration Status */}
                  <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
                    <span className="text-slate-400 block text-[10px]">On-Chain Registration</span>
                    {patientSummary.isRegistered ? (
                      <span className="inline-flex items-center space-x-1 text-emerald-400 font-semibold">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Registered Patient</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center space-x-1 text-rose-400 font-semibold">
                        <XCircle className="w-3 h-3" />
                        <span>Not Registered</span>
                      </span>
                    )}
                  </div>

                  {/* Public Key Status */}
                  <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
                    <span className="text-slate-400 block text-[10px]">RSA Public Key</span>
                    {patientSummary.hasPublicKey ? (
                      <span className="inline-flex items-center space-x-1 text-emerald-400 font-semibold truncate">
                        <KeyRound className="w-3 h-3 flex-shrink-0" />
                        <span>Registered</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center space-x-1 text-amber-400 font-semibold">
                        <AlertTriangle className="w-3 h-3" />
                        <span>Not Published</span>
                      </span>
                    )}
                  </div>

                  {/* Record Count */}
                  <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
                    <span className="text-slate-400 block text-[10px]">Uploaded Records</span>
                    <span className="inline-flex items-center space-x-1 text-blue-300 font-semibold">
                      <FileText className="w-3 h-3" />
                      <span>{patientSummary.recordCount} Record(s)</span>
                    </span>
                  </div>
                </div>

                {!patientSummary.isRegistered && (
                  <p className="text-[11px] text-rose-400">
                    ⚠ This address has not registered on MediConsent. Requests will fail until the patient self-registers.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Record Type Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-slate-300">
                Requested Record Categories (Select at least 1)
              </label>
              <span className="text-[11px] text-slate-400">
                {selectedTypes.length} of {RECORD_TYPE_LABELS.length} selected
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {RECORD_TYPE_LABELS.map((label, idx) => {
                const isSelected = selectedTypes.includes(idx);
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleRecordType(idx)}
                    disabled={isTxBusy || !isHospitalRegistered}
                    className={`flex items-center space-x-2 p-2.5 rounded-xl border text-left text-xs font-medium transition-all ${
                      isSelected
                        ? "bg-blue-950/50 border-blue-500/50 text-blue-200 shadow-sm"
                        : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700"
                    } disabled:opacity-50`}
                  >
                    {isSelected ? (
                      <CheckSquare className="w-4 h-4 text-blue-400 flex-shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-600 flex-shrink-0" />
                    )}
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>

            {selectedTypes.length === 0 && (
              <p className="text-[11px] text-rose-400">
                Please select at least one record category to request.
              </p>
            )}
          </div>

          {/* Status banner */}
          <TxStatus status={txStatus.status} message={txStatus.message} />

          {/* Submit button */}
          <button
            type="submit"
            disabled={
              isTxBusy ||
              !searchedPatient ||
              selectedTypes.length === 0 ||
              !isHospitalRegistered ||
              !patientSummary?.isRegistered
            }
            className="w-full flex items-center justify-center space-x-2 py-3 rounded-xl font-semibold text-xs text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-lg shadow-blue-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <Send className="w-4 h-4" />
            <span>{isTxBusy ? "Submitting Request…" : "Submit Access Request"}</span>
          </button>
        </form>
      </div>

      {/* ── Section: My Requests ───────────────────────────────────────────── */}
      <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center space-x-2">
              <Clock className="w-5 h-5 text-blue-400" />
              <span>Outgoing Access Requests</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-950 text-blue-300 border border-blue-500/30">
                {requestEvents ? requestEvents.length : 0}
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Live status of consent requests sent from this hospital wallet.
            </p>
          </div>

          <button
            onClick={() => {
              refetchRequests();
              setRefreshTrigger((prev) => prev + 1);
            }}
            disabled={isRequestsLoading}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-slate-900 border border-slate-700 text-slate-300 hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRequestsLoading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>

        {/* Loading State */}
        {(isRequestsLoading || isResolvingStatuses) && (
          <div className="py-10 text-center space-y-2">
            <RefreshCw className="w-6 h-6 text-blue-400 animate-spin mx-auto" />
            <p className="text-xs text-slate-400">Loading access requests & deriving on-chain consent states…</p>
          </div>
        )}

        {/* Empty State */}
        {!isRequestsLoading && !isResolvingStatuses && (!requestEvents || requestEvents.length === 0) && (
          <div className="glass-card rounded-xl p-8 text-center border border-slate-800 space-y-2">
            <Clock className="w-8 h-8 text-slate-700 mx-auto" />
            <h4 className="text-sm font-semibold text-slate-300">No Access Requests</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Your hospital has not submitted any access requests yet. Use the form above to search for a patient and request records.
            </p>
          </div>
        )}

        {/* Requests Cards */}
        {!isRequestsLoading && requestEvents && requestEvents.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {requestEvents.map((evt, idx) => {
              const patientAddr = evt.args?.patient || "";
              const types = (evt.args?.recordTypes || []).map((t) => Number(t));
              const timestampSec = Number(evt.args?.timestamp || 0);
              const key = `${evt.transactionHash}_${patientAddr}`;
              const details = requestStatuses[key] || { status: "pending", expiry: 0n };

              const expiryTimestamp = Number(details.expiry || 0);
              const countdown = expiryTimestamp ? formatCountdown(expiryTimestamp) : null;

              // Status badge config
              const badgeConfigs = {
                pending: {
                  label: "Pending Patient Consent",
                  bg: "bg-amber-950/70 border-amber-500/30 text-amber-300",
                  icon: <Clock className="w-3.5 h-3.5" />,
                },
                approved: {
                  label: "Consent Approved",
                  bg: "bg-emerald-950/70 border-emerald-500/30 text-emerald-300",
                  icon: <CheckCircle2 className="w-3.5 h-3.5" />,
                },
                expired: {
                  label: "Consent Expired",
                  bg: "bg-slate-900 border-slate-700 text-slate-400",
                  icon: <AlertTriangle className="w-3.5 h-3.5" />,
                },
                revoked: {
                  label: "Consent Revoked",
                  bg: "bg-rose-950/70 border-rose-500/30 text-rose-300",
                  icon: <XCircle className="w-3.5 h-3.5" />,
                },
              };

              const currentBadge = badgeConfigs[details.status] || badgeConfigs.pending;

              return (
                <div
                  key={evt.transactionHash + idx}
                  className="glass-card rounded-xl p-4 border border-slate-800 space-y-3 hover:border-slate-700 transition-all"
                >
                  {/* Top: Status Badge + Requested Date */}
                  <div className="flex items-center justify-between">
                    <span
                      className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${currentBadge.bg}`}
                    >
                      {currentBadge.icon}
                      <span>{currentBadge.label}</span>
                    </span>

                    <span className="text-[10px] text-slate-500">
                      {timestampSec ? new Date(timestampSec * 1000).toLocaleDateString() : ""}
                    </span>
                  </div>

                  {/* Target Patient */}
                  <div className="flex items-center justify-between text-xs bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/80">
                    <span className="text-slate-400 flex items-center space-x-1.5">
                      <User className="w-3.5 h-3.5 text-blue-400" />
                      <span>Target Patient:</span>
                    </span>
                    <span className="font-mono text-slate-200 text-[11px]">
                      {patientAddr.slice(0, 8)}…{patientAddr.slice(-6)}
                    </span>
                  </div>

                  {/* Requested Categories */}
                  <div className="space-y-1">
                    <span className="text-[11px] text-slate-400 block font-medium">
                      Requested Categories:
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {types.map((t) => (
                        <span
                          key={t}
                          className="text-[10px] px-2 py-0.5 rounded-md bg-slate-800/90 text-slate-300 border border-slate-700"
                        >
                          {recordTypeLabel(t)}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Approved Expiry & Live Countdown */}
                  {details.status === "approved" && expiryTimestamp > 0 && (
                    <div className="p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-500/20 text-xs text-emerald-300 space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-emerald-400/80 font-medium">Access Expires:</span>
                        <span className="font-mono font-bold text-emerald-300">
                          {countdown}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400">
                        {new Date(expiryTimestamp * 1000).toLocaleString()}
                      </p>
                    </div>
                  )}

                  {details.status === "revoked" && (
                    <p className="text-[11px] text-rose-400/90 italic">
                      The patient revoked access for your hospital.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

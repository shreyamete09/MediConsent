/**
 * @file ActiveConsentsPanel.jsx
 * @notice Displays granted patient consents with live 1-second countdowns and O(1) one-click revocation.
 *
 * Requirements:
 * 1. Active consents list built from ConsentGranted events and validated with checkAccess.
 * 2. Live countdown updating every second without requiring page reload.
 * 3. Automatic transition to "Expired" state when time elapses (greyed out, no Revoke button).
 * 4. One-click Revoke button calling contract.revokeConsent(hospital) with confirmation dialog:
 *    "This stops future access. A hospital that already decrypted a record keeps its copy."
 * 5. Immediate transition to "Revoked" state upon revocation.
 * 6. Guard against double-submits and handle multiple consents per hospital.
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useWeb3 } from "../context/Web3Context";
import {
  useContractEvents,
  recordTypeLabel,
  formatCountdown,
} from "../hooks/useContractEvents.js";
import TxStatus from "./TxStatus.jsx";
import {
  Shield,
  ShieldAlert,
  Building2,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Copy,
  Lock,
} from "lucide-react";

export default function ActiveConsentsPanel({ refreshTrigger, onConsentRevoked }) {
  const { account, contract } = useWeb3();

  const [localRefresh, setLocalRefresh] = useState(0);
  const [txStatus, setTxStatus] = useState({ status: "idle", message: "" });
  const [copiedField, setCopiedField] = useState(null);

  // Confirmation dialog state
  const [confirmRevokeHospital, setConfirmRevokeHospital] = useState(null);
  const [isRevoking, setIsRevoking] = useState(false);
  const [revokingHospital, setRevokingHospital] = useState(null);

  // Live 1-second timer ticker
  const [nowSec, setNowSec] = useState(Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const setStatus = (status, message) => setTxStatus({ status, message });

  // Query all ConsentGranted events where indexed patient == account
  const {
    events: grantEvents,
    isLoading: isEventsLoading,
    refetch: refetchGrants,
  } = useContractEvents(
    contract,
    "ConsentGranted",
    account ? [account] : [],
    [account, refreshTrigger, localRefresh]
  );

  // Resolved consent state map: key -> { status, expiry, revokedAt, grantedAt, hasAccess, hospitalName }
  const [consentDetailsMap, setConsentDetailsMap] = useState({});
  const [isResolving, setIsResolving] = useState(false);

  // Resolve on-chain checkAccess & lastRevokedTimestamp for all grants
  useEffect(() => {
    if (!contract || !account || !grantEvents || grantEvents.length === 0) {
      setConsentDetailsMap({});
      return;
    }

    let isMounted = true;
    (async () => {
      setIsResolving(true);
      const detailMap = {};

      for (const evt of grantEvents) {
        const hospital = evt.args?.hospital;
        const types = (evt.args?.recordTypes || []).map((t) => Number(t));
        const evtExpiry = Number(evt.args?.expiryTimestamp || 0);
        const evtGrantedAt = Number(evt.args?.timestamp || 0);
        const key = `${evt.transactionHash}_${hospital}`;

        try {
          const firstType = types[0] !== undefined ? types[0] : 0;
          const [revokedAtBn, grantedAtBn, hasAccess, hospitalInfo] = await Promise.all([
            contract.lastRevokedTimestamp(account, hospital),
            contract.consentGrantedAt(account, hospital, firstType),
            contract.checkAccess(account, hospital, firstType).catch(() => false),
            contract.hospitals(hospital).catch(() => ({ name: "" })),
          ]);

          const revokedAt = Number(revokedAtBn);
          const grantedAt = Number(grantedAtBn) || evtGrantedAt;

          detailMap[key] = {
            revokedAt,
            grantedAt,
            hasAccess,
            expiry: evtExpiry,
            hospitalName: hospitalInfo?.name || "",
          };
        } catch (err) {
          console.warn("Failed resolving consent details:", err);
          detailMap[key] = {
            revokedAt: 0,
            grantedAt: evtGrantedAt,
            hasAccess: false,
            expiry: evtExpiry,
            hospitalName: "",
          };
        }
      }

      if (isMounted) {
        setConsentDetailsMap(detailMap);
        setIsResolving(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [contract, account, grantEvents, refreshTrigger, localRefresh]);

  // Copy helper
  const handleCopy = (text, fieldId) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // ── REVOKE CONSENT ─────────────────────────────────────────────────────────
  const handleConfirmRevoke = async () => {
    if (!contract || !confirmRevokeHospital || isRevoking) return;

    const targetHospital = confirmRevokeHospital;
    setIsRevoking(true);
    setRevokingHospital(targetHospital);

    try {
      setStatus(
        "confirming",
        `⛓ Revoking all active consent for hospital ${targetHospital.slice(0, 8)}… Please confirm in MetaMask`
      );

      const tx = await contract.revokeConsent(targetHospital);
      setStatus("confirming", `⛓ Waiting for block confirmation… (tx: ${tx.hash.slice(0, 10)}…)`);
      await tx.wait();

      setStatus(
        "success",
        `✅ Consent revoked immediately for hospital ${targetHospital.slice(0, 8)}… on-chain!`
      );

      setConfirmRevokeHospital(null);
      setLocalRefresh((prev) => prev + 1);
      onConsentRevoked?.();
    } catch (err) {
      console.error("Revoke error:", err);
      setStatus("error", `Revocation failed: ${err.reason || err.message}`);
    } finally {
      setIsRevoking(false);
      setRevokingHospital(null);
    }
  };

  // Process and sort consents
  const processedConsents = useMemo(() => {
    if (!grantEvents) return [];

    return grantEvents.map((evt) => {
      const hospital = evt.args?.hospital || "";
      const recordTypes = (evt.args?.recordTypes || []).map((t) => Number(t));
      const key = `${evt.transactionHash}_${hospital}`;
      const details = consentDetailsMap[key] || {
        revokedAt: 0,
        grantedAt: Number(evt.args?.timestamp || 0),
        hasAccess: false,
        expiry: Number(evt.args?.expiryTimestamp || 0),
        hospitalName: "",
      };

      const expiryTimestamp = details.expiry;
      const isRevoked = details.revokedAt > 0 && details.revokedAt >= details.grantedAt;
      const isExpired = expiryTimestamp > 0 && expiryTimestamp <= nowSec;
      const isActive = !isRevoked && !isExpired && details.hasAccess;

      let status = "expired";
      if (isRevoked) status = "revoked";
      else if (isActive) status = "active";
      else if (isExpired) status = "expired";

      return {
        key,
        evt,
        hospital,
        hospitalName: details.hospitalName,
        recordTypes,
        expiryTimestamp,
        grantedAt: details.grantedAt,
        status,
      };
    });
  }, [grantEvents, consentDetailsMap, nowSec]);

  // Count active consents
  const activeCount = useMemo(
    () => processedConsents.filter((c) => c.status === "active").length,
    [processedConsents]
  );

  return (
    <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-4">
      {/* ── Section Header ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center space-x-2">
            <Shield className="w-5 h-5 text-emerald-400" />
            <span>Active & Granted Consents</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-500/30">
              {activeCount} active
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage granular, time-limited permissions. You can revoke hospital access at any time in O(1) gas.
          </p>
        </div>

        <button
          onClick={() => {
            refetchGrants();
            setLocalRefresh((prev) => prev + 1);
          }}
          disabled={isEventsLoading || isResolving}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-slate-900 border border-slate-700 text-slate-300 hover:text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isEventsLoading || isResolving ? "animate-spin" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Transaction status */}
      <TxStatus status={txStatus.status} message={txStatus.message} />

      {/* Loading state */}
      {(isEventsLoading || isResolving) && (
        <div className="py-10 text-center space-y-2">
          <RefreshCw className="w-6 h-6 text-emerald-400 animate-spin mx-auto" />
          <p className="text-xs text-slate-400">Loading consent grants & verifying on-chain access…</p>
        </div>
      )}

      {/* Empty state */}
      {!isEventsLoading && !isResolving && processedConsents.length === 0 && (
        <div className="glass-card rounded-xl p-8 text-center border border-slate-800 space-y-2">
          <Shield className="w-8 h-8 text-slate-700 mx-auto" />
          <h4 className="text-sm font-semibold text-slate-300">No Consents Granted</h4>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            You have not granted access to any hospital yet. Incoming requests will appear in the Pending Requests section above.
          </p>
        </div>
      )}

      {/* Consents Grid */}
      {!isEventsLoading && processedConsents.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {processedConsents.map((consent) => {
            const isCurrentlyRevoking = isRevoking && revokingHospital === consent.hospital;
            const countdownText = formatCountdown(consent.expiryTimestamp);

            return (
              <div
                key={consent.key}
                className={`glass-card rounded-xl p-4 border transition-all space-y-3 ${
                  consent.status === "active"
                    ? "border-emerald-500/30 bg-emerald-950/10 shadow-sm"
                    : consent.status === "revoked"
                    ? "border-rose-900/40 bg-rose-950/5 opacity-75"
                    : "border-slate-800 bg-slate-950/30 opacity-60"
                }`}
              >
                {/* Top: Status badge + Countdown / Expired / Revoked */}
                <div className="flex items-center justify-between">
                  {consent.status === "active" && (
                    <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-500/30">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span>Active Access</span>
                    </span>
                  )}
                  {consent.status === "revoked" && (
                    <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-950/80 text-rose-300 border border-rose-500/30">
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Consent Revoked</span>
                    </span>
                  )}
                  {consent.status === "expired" && (
                    <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                      <Clock className="w-3.5 h-3.5" />
                      <span>Consent Expired</span>
                    </span>
                  )}

                  {/* Countdown or status label */}
                  {consent.status === "active" && (
                    <div className="flex items-center space-x-1 text-xs font-mono font-bold text-emerald-400">
                      <Clock className="w-3.5 h-3.5" />
                      <span>{countdownText}</span>
                    </div>
                  )}
                </div>

                {/* Hospital info */}
                <div className="p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 flex items-center space-x-1.5">
                      <Building2 className="w-3.5 h-3.5 text-blue-400" />
                      <span>Hospital:</span>
                    </span>
                    <button
                      onClick={() => handleCopy(consent.hospital, `hosp-${consent.key}`)}
                      className="text-[10px] text-slate-400 hover:text-emerald-400 flex items-center space-x-1 transition-colors"
                    >
                      <Copy className="w-2.5 h-2.5" />
                      <span>{copiedField === `hosp-${consent.key}` ? "Copied" : "Copy"}</span>
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200 text-xs truncate">
                      {consent.hospitalName || "Registered Hospital"}
                    </span>
                    <span className="font-mono text-[11px] text-slate-400">
                      {consent.hospital.slice(0, 8)}…{consent.hospital.slice(-6)}
                    </span>
                  </div>
                </div>

                {/* Shared categories */}
                <div className="space-y-1">
                  <span className="text-[11px] text-slate-400 block font-medium">
                    Consented Categories:
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {consent.recordTypes.map((t) => (
                      <span
                        key={t}
                        className={`text-[10px] px-2 py-0.5 rounded-md border ${
                          consent.status === "active"
                            ? "bg-emerald-950/60 text-emerald-300 border-emerald-500/25"
                            : "bg-slate-900 text-slate-400 border-slate-800"
                        }`}
                      >
                        {recordTypeLabel(t)}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Expiry details */}
                <div className="text-[11px] text-slate-400 flex items-center justify-between pt-0.5">
                  <span>Expiration Date:</span>
                  <span className="font-medium text-slate-300">
                    {new Date(consent.expiryTimestamp * 1000).toLocaleString()}
                  </span>
                </div>

                {/* Revoke Action */}
                {consent.status === "active" && (
                  <button
                    onClick={() => setConfirmRevokeHospital(consent.hospital)}
                    disabled={isRevoking}
                    className="w-full flex items-center justify-center space-x-1.5 py-2 rounded-lg font-semibold text-xs text-rose-300 bg-rose-950/50 hover:bg-rose-900/60 border border-rose-500/30 hover:border-rose-500/50 transition-colors disabled:opacity-40"
                  >
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>
                      {isCurrentlyRevoking ? "Revoking On-Chain…" : "Revoke Access Immediately"}
                    </span>
                  </button>
                )}

                {consent.status === "revoked" && (
                  <p className="text-[11px] text-rose-400/80 italic text-center">
                    Access revoked. The hospital cannot query keys or decrypt new records.
                  </p>
                )}

                {consent.status === "expired" && (
                  <p className="text-[11px] text-slate-500 italic text-center">
                    Consent window has closed. The hospital must request new access.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Confirmation Modal ────────────────────────────────────────────── */}
      {confirmRevokeHospital && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="glass-panel max-w-md w-full p-6 rounded-2xl border border-rose-500/40 bg-slate-950/95 space-y-4 shadow-2xl">
            <div className="flex items-center space-x-3 text-rose-400">
              <div className="w-10 h-10 rounded-xl bg-rose-950 border border-rose-500/30 flex items-center justify-center">
                <ShieldAlert className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Revoke Hospital Access?</h3>
                <p className="text-xs text-slate-400">Immediate on-chain consent invalidation</p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/25 text-xs text-amber-300 leading-relaxed">
              <span className="font-semibold block mb-1">Security Notice:</span>
              "This stops future access. A hospital that already decrypted a record keeps its copy."
            </div>

            <div className="space-y-1 text-xs">
              <span className="text-slate-400">Target Hospital Address:</span>
              <p className="font-mono text-slate-200 text-[11px] bg-slate-900 p-2 rounded-lg border border-slate-800 break-all">
                {confirmRevokeHospital}
              </p>
            </div>

            <div className="flex items-center space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmRevokeHospital(null)}
                disabled={isRevoking}
                className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRevoke}
                disabled={isRevoking}
                className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 shadow-lg shadow-rose-600/20 transition-all disabled:opacity-50 flex items-center justify-center space-x-1.5"
              >
                <ShieldAlert className="w-4 h-4" />
                <span>{isRevoking ? "Revoking…" : "Yes, Revoke Consent"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

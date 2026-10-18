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
    <div className="bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-8 shadow-sm space-y-6">
      {/* ── Section Header ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-2xl bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-700">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
              <span>Active & Granted Consents</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                {activeCount} active
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Live delegations with real-time countdown clocks. You retain perpetual right of immediate cryptographic revocation.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {activeCount > 0 && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              {activeCount} Delegations Active
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              refetchGrants();
              setLocalRefresh((prev) => prev + 1);
            }}
            disabled={isEventsLoading || isResolving}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 border border-slate-200 text-slate-700 hover:bg-slate-200 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isEventsLoading || isResolving ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Transaction status */}
      <TxStatus status={txStatus.status} message={txStatus.message} />

      {/* Loading state */}
      {(isEventsLoading || isResolving) && (
        <div className="py-10 text-center space-y-2">
          <RefreshCw className="w-6 h-6 text-teal-700 animate-spin mx-auto" />
          <p className="text-xs text-slate-500">Loading consent grants & verifying on-chain access…</p>
        </div>
      )}

      {/* Empty state */}
      {!isEventsLoading && !isResolving && processedConsents.length === 0 && (
        <div className="rounded-2xl p-8 text-center border border-dashed border-slate-200 bg-slate-50/50 space-y-2">
          <Shield className="w-8 h-8 text-slate-400 mx-auto" />
          <h4 className="text-sm font-bold text-slate-800">No Consents Granted</h4>
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
                className={`rounded-2xl p-5 sm:p-6 border transition-all space-y-4 shadow-sm ${
                  consent.status === "active"
                    ? "bg-slate-50 border-slate-200/90 hover:border-slate-300"
                    : consent.status === "revoked"
                    ? "bg-rose-50/40 border-rose-200 opacity-80"
                    : "bg-slate-50 border-slate-200 opacity-60"
                }`}
              >
                {/* Top: Category Badge + Countdown / Status */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 pb-3">
                  <div className="flex flex-wrap gap-1">
                    {consent.recordTypes.map((t) => (
                      <span
                        key={t}
                        className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-teal-50 text-teal-800 border border-teal-200"
                      >
                        {recordTypeLabel(t)}
                      </span>
                    ))}
                  </div>

                  {/* Countdown or status pill */}
                  {consent.status === "active" && (
                    <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span>{countdownText} remaining</span>
                    </span>
                  )}
                  {consent.status === "revoked" && (
                    <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Consent Revoked</span>
                    </span>
                  )}
                  {consent.status === "expired" && (
                    <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500 border border-slate-200">
                      <Clock className="w-3.5 h-3.5" />
                      <span>Consent Expired</span>
                    </span>
                  )}
                </div>

                {/* Hospital info box */}
                <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-900 text-sm">
                      {consent.hospitalName || "Registered Hospital"}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(consent.hospital, `hosp-${consent.key}`)}
                      className="text-[11px] text-slate-500 hover:text-teal-700 flex items-center space-x-1 transition-colors"
                    >
                      <Copy className="w-3 h-3" />
                      <span>{copiedField === `hosp-${consent.key}` ? "Copied" : "Copy"}</span>
                    </button>
                  </div>
                  <p className="font-mono text-xs text-slate-600">
                    {consent.hospital.slice(0, 10)}…{consent.hospital.slice(-6)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Authorized Scope: {consent.recordTypes.map(recordTypeLabel).join(", ")}
                  </p>
                </div>

                {/* Envelope spec & Expiration Details */}
                <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-500 pt-1">
                  <span className="flex items-center space-x-1 font-medium text-teal-800">
                    <Lock className="w-3.5 h-3.5 text-teal-700" />
                    <span>Client-side AES-256-GCM envelope</span>
                  </span>
                  <span className="font-mono text-[10px]">
                    Expires: {new Date(consent.expiryTimestamp * 1000).toLocaleDateString()}
                  </span>
                </div>

                {/* Revoke Action */}
                {consent.status === "active" && (
                  <button
                    type="button"
                    onClick={() => setConfirmRevokeHospital(consent.hospital)}
                    disabled={isRevoking}
                    className="w-full flex items-center justify-center space-x-2 py-2.5 rounded-xl font-semibold text-xs text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors shadow-sm disabled:opacity-40"
                  >
                    <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
                    <span>
                      {isCurrentlyRevoking ? "Revoking On-Chain…" : "Revoke Consent Instantly"}
                    </span>
                  </button>
                )}

                {consent.status === "revoked" && (
                  <p className="text-[11px] text-rose-600 italic text-center pt-1 font-medium">
                    Access revoked. The hospital cannot query keys or decrypt records.
                  </p>
                )}

                {consent.status === "expired" && (
                  <p className="text-[11px] text-slate-500 italic text-center pt-1">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="max-w-md w-full p-6 sm:p-7 rounded-3xl border border-slate-200 bg-white space-y-4 shadow-2xl">
            <div className="flex items-center space-x-3 text-rose-700">
              <div className="w-11 h-11 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center">
                <ShieldAlert className="w-6 h-6 text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Revoke Hospital Access?</h3>
                <p className="text-xs text-slate-500">Immediate on-chain consent invalidation</p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed">
              <span className="font-bold block mb-1">Security Notice:</span>
              "This stops future access. A hospital that already decrypted a record keeps its copy."
            </div>

            <div className="space-y-1 text-xs">
              <span className="text-slate-600 font-semibold text-[11px]">Target Hospital Address:</span>
              <p className="font-mono text-slate-900 text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-200 break-all">
                {confirmRevokeHospital}
              </p>
            </div>

            <div className="flex items-center space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmRevokeHospital(null)}
                disabled={isRevoking}
                className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRevoke}
                disabled={isRevoking}
                className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 shadow-sm transition-all disabled:opacity-50 flex items-center justify-center space-x-1.5"
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

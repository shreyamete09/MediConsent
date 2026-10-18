/**
 * @file useContractEvents.js
 * @notice Helper hook to query historical events from the MediConsent contract.
 *
 * Uses ethers v6 queryFilter with a block range of 0 → "latest".
 * For production with Polygon Amoy use a subgraph or an indexed RPC to avoid
 * hitting node rate limits — this pattern is fine for a local Hardhat node.
 */

import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";

const RECORD_TYPE_LABELS = ["General", "Cardiology", "Radiology", "Pathology", "Neurology", "Oncology"];

export function recordTypeLabel(n) {
  return RECORD_TYPE_LABELS[Number(n)] ?? `Type(${n})`;
}

/**
 * useContractEvents
 * Queries a specific contract event filter and returns an array of parsed log objects.
 *
 * @param {ethers.Contract|null} contract
 * @param {string} eventName  - e.g. "AccessRequested"
 * @param {Array}  filterArgs - positional args for contract.filters[eventName](...filterArgs)
 * @param {Array}  deps       - extra useEffect deps that should trigger a re-fetch
 */
export function useContractEvents(contract, eventName, filterArgs = [], deps = []) {
  const [events, setEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    if (!contract) return;
    setIsLoading(true);
    setError(null);
    try {
      const filter = contract.filters[eventName](...filterArgs);
      const raw = await contract.queryFilter(filter, 0, "latest");
      // Map to plain objects so components don't hold live ethers objects
      const parsed = raw.map((e) => ({
        blockNumber: e.blockNumber,
        transactionHash: e.transactionHash,
        args: e.args,
        // Convenience: timestamp will be fetched lazily by components
      }));
      setEvents(parsed.reverse()); // newest first
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [contract, eventName, JSON.stringify(filterArgs)]); // eslint-disable-line

  useEffect(() => {
    fetch();
  }, [fetch, ...deps]); // eslint-disable-line

  return { events, isLoading, error, refetch: fetch };
}

/** Utility: convert seconds to human-readable countdown */
export function formatCountdown(expiryTimestamp) {
  const now = Math.floor(Date.now() / 1000);
  const diff = Number(expiryTimestamp) - now;
  if (diff <= 0) return "Expired";
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

/** Derive the status of an access request from on-chain data */
export async function deriveRequestStatus(contract, patient, hospital, recordTypes) {
  const details = await deriveRequestDetails(contract, patient, hospital, recordTypes);
  return details.status;
}

/** Derive detailed status including expiry timestamp and access check */
export async function deriveRequestDetails(contract, patient, hospital, recordTypes) {
  if (!contract || !recordTypes || recordTypes.length === 0) {
    return { status: "pending", expiry: 0n, hasAccess: false };
  }

  const type = Number(recordTypes[0]);
  const [expiry, grantedAt, revokedAt, hasAccess] = await Promise.all([
    contract.consentExpiry(patient, hospital, type),
    contract.consentGrantedAt(patient, hospital, type),
    contract.lastRevokedTimestamp(patient, hospital),
    contract.checkAccess(patient, hospital, type).catch(() => false),
  ]);

  const now = BigInt(Math.floor(Date.now() / 1000));
  const isGranted = grantedAt > 0n;
  const isRevoked = grantedAt > 0n && revokedAt >= grantedAt;
  const isExpired = expiry > 0n && expiry <= now;

  let status = "pending";
  if (!isGranted) {
    status = "pending";
  } else if (isRevoked) {
    status = "revoked";
  } else if (hasAccess && expiry > now) {
    status = "approved";
  } else if (isExpired) {
    status = "expired";
  } else {
    status = "expired";
  }

  return { status, expiry, grantedAt, revokedAt, hasAccess };
}

export { RECORD_TYPE_LABELS };

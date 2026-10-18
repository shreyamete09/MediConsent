/**
 * @file AuditPage.jsx
 * @notice Immutable Audit Trail & Governance Explorer for MediConsent.
 * Restyled in clean light theme matching UI design:
 *   - Real network name and live latest block height from blockchain consensus.
 *   - 4 real stat tiles computed strictly from loaded on-chain events:
 *     Total Events, Record Accesses, Consents Granted, Smart Revocations.
 *   - Role-aware filtering:
 *       * Patient sees events involving their address.
 *       * Hospital sees events it caused or that involve it.
 *       * Admin sees system-wide logs.
 *       * Unregistered wallets receive a clear security/privacy guard.
 *   - Live event subscriptions without reload (contract.on listeners).
 *   - Filters: Event Type, Record ID (?recordId= URL parameter supported), and Address/Tx search.
 *   - Real Consents by Category distribution chart (computed from ConsentGranted events).
 *   - Export CSV button with complete metadata.
 *   - Real pagination with exact event counts.
 *
 * STRICT RULES PRESERVED:
 *   - Zero mock data or fabricated statistics.
 *   - Zero overclaims (no ZK, no Merkle tree verify, no ERC-4337, no Enclave key shredded).
 *   - Read-only: zero transactions or private keys.
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useWeb3 } from "../context/Web3Context";
import { recordTypeLabel } from "../hooks/useContractEvents.js";
import {
  ShieldAlert,
  ShieldCheck,
  FileText,
  Clock,
  Search,
  Filter,
  Download,
  Copy,
  ExternalLink,
  RefreshCw,
  Activity,
  User,
  Building2,
  Lock,
  KeyRound,
  Radio,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Eye,
  Check,
  PieChart,
  Layers,
  Database,
} from "lucide-react";

// Shorten address utility
function shorten(addr) {
  if (!addr) return "N/A";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// Generate plain-language description for audit events
function generateSentence(type, args) {
  const patient = args?.patient ? shorten(args.patient) : "unknown patient";
  const hospital = args?.hospital ? shorten(args.hospital) : "unknown hospital";
  const recordId = args?.recordId !== undefined ? `#REC-${args.recordId.toString()}` : "";

  switch (type) {
    case "RecordAdded": {
      const cat = args?.recordType !== undefined ? recordTypeLabel(args.recordType) : "record";
      return `Hospital ${hospital} uploaded encrypted ${cat} record ${recordId} for patient ${patient}.`;
    }
    case "AccessRequested": {
      const cats =
        (args?.recordTypes || []).map((t) => recordTypeLabel(t)).join(", ") || "medical records";
      return `Hospital ${hospital} requested access to ${cats} for patient ${patient}.`;
    }
    case "ConsentGranted": {
      const cats =
        (args?.recordTypes || []).map((t) => recordTypeLabel(t)).join(", ") || "medical records";
      const expiry = args?.expiryTimestamp
        ? new Date(Number(args.expiryTimestamp) * 1000).toLocaleString()
        : "specified duration";
      return `Patient ${patient} granted access consent to hospital ${hospital} for ${cats} until ${expiry}.`;
    }
    case "ConsentRevoked":
      return `Consent revoked on-chain: future access blocked for hospital ${hospital} by patient ${patient}.`;
    case "RecordAccessed":
      return `Hospital ${hospital} decrypted and accessed record ${recordId} following active patient consent.`;
    case "PatientKeyUpdated":
      return `Patient ${patient} registered/updated their RSA public key on the blockchain registry.`;
    case "PatientRegistered":
      return `Patient ${patient} self-registered as a sovereign participant on the smart contract.`;
    case "HospitalRegistered":
      return `Hospital ${hospital} (${args?.name || "Hospital"}) was registered and approved on-chain.`;
    default:
      return `System event ${type} executed on-chain.`;
  }
}

// Event badge & icon styling
const EVENT_CONFIGS = {
  RecordAdded: {
    label: "Record Added",
    badge: "bg-sky-50 text-sky-700 border-sky-200",
    dot: "bg-sky-500",
    nodeBorder: "border-sky-500",
    iconBg: "bg-sky-100 text-sky-700",
    statusBadge: "Stored Off-Chain (AES-256-GCM)",
    icon: FileText,
  },
  AccessRequested: {
    label: "Access Requested",
    badge: "bg-amber-50 text-amber-700 border-amber-200",
    dot: "bg-amber-500",
    nodeBorder: "border-amber-500",
    iconBg: "bg-amber-100 text-amber-700",
    statusBadge: "Awaiting Patient Approval",
    icon: Clock,
  },
  ConsentGranted: {
    label: "Consent Granted",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dot: "bg-emerald-500",
    nodeBorder: "border-emerald-500",
    iconBg: "bg-emerald-100 text-emerald-700",
    statusBadge: "Smart Contract Consent Active",
    icon: CheckCircle2,
  },
  ConsentRevoked: {
    label: "Consent Revoked",
    badge: "bg-rose-50 text-rose-700 border-rose-200",
    dot: "bg-rose-500",
    nodeBorder: "border-rose-500",
    iconBg: "bg-rose-100 text-rose-700",
    statusBadge: "Access Blocked On-Chain",
    icon: XCircle,
  },
  RecordAccessed: {
    label: "Record Accessed",
    badge: "bg-teal-50 text-teal-800 border-teal-200",
    dot: "bg-teal-600",
    nodeBorder: "border-teal-600",
    iconBg: "bg-teal-100 text-teal-700",
    statusBadge: "On-Chain Access Verified",
    icon: Lock,
  },
  PatientKeyUpdated: {
    label: "Key Updated",
    badge: "bg-purple-50 text-purple-700 border-purple-200",
    dot: "bg-purple-500",
    nodeBorder: "border-purple-500",
    iconBg: "bg-purple-100 text-purple-700",
    statusBadge: "Public Key Synchronized",
    icon: KeyRound,
  },
};

export default function AuditPage() {
  const { account, chainId, role, contract, provider } = useWeb3();
  const [searchParams] = useSearchParams();

  // State
  const [allEvents, setAllEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copiedTx, setCopiedTx] = useState(null);
  const [liveCount, setLiveCount] = useState(0);
  const [latestBlock, setLatestBlock] = useState(null);

  // Filters
  const [selectedType, setSelectedType] = useState("ALL");
  const [recordIdFilter, setRecordIdFilter] = useState(() => searchParams.get("recordId") || "");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const qRecordId = searchParams.get("recordId");
    if (qRecordId) {
      setRecordIdFilter(qRecordId);
    }
  }, [searchParams]);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

  // Block timestamp cache
  const blockTimeCache = useRef(new Map());

  // Copy helper
  const handleCopy = (text, id) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedTx(id);
    setTimeout(() => setCopiedTx(null), 2000);
  };

  // Real network name based on chainId
  const getNetworkName = (id) => {
    if (id === 31337) return "Hardhat Local";
    if (id === 80002) return "Polygon Amoy";
    if (id === 11155111) return "Ethereum Sepolia";
    return id ? `Chain ID: ${id}` : "Local Network";
  };

  // Helper: Resolve timestamp with in-memory caching
  const resolveTimestamp = useCallback(
    async (blockNumber, fallbackTimestamp) => {
      if (fallbackTimestamp && Number(fallbackTimestamp) > 0) {
        return Number(fallbackTimestamp);
      }
      if (blockTimeCache.current.has(blockNumber)) {
        return blockTimeCache.current.get(blockNumber);
      }
      if (provider) {
        try {
          const blk = await provider.getBlock(blockNumber);
          const t = blk ? blk.timestamp : Math.floor(Date.now() / 1000);
          blockTimeCache.current.set(blockNumber, t);
          return t;
        } catch {
          return Math.floor(Date.now() / 1000);
        }
      }
      return Math.floor(Date.now() / 1000);
    },
    [provider]
  );

  // Track latest block height from network consensus
  useEffect(() => {
    if (!provider) return;
    let isMounted = true;

    provider
      .getBlockNumber()
      .then((bn) => {
        if (isMounted) setLatestBlock(bn);
      })
      .catch(() => {});

    const onBlock = (bn) => {
      if (isMounted) setLatestBlock(bn);
    };

    provider.on("block", onBlock);
    return () => {
      isMounted = false;
      provider.off("block", onBlock);
    };
  }, [provider]);

  // ── Fetch historical events ─────────────────────────────────────────────────
  const fetchAuditEvents = useCallback(async () => {
    if (!contract) return;

    setIsLoading(true);
    setError(null);

    try {
      const eventDefs = [
        "RecordAdded",
        "AccessRequested",
        "ConsentGranted",
        "ConsentRevoked",
        "RecordAccessed",
        "PatientKeyUpdated",
      ];

      // Query all filters in parallel
      const rawFilterResults = await Promise.all(
        eventDefs.map(async (name) => {
          try {
            const filter = contract.filters[name]();
            const logs = await contract.queryFilter(filter, 0, "latest");
            return { name, logs };
          } catch (err) {
            console.warn(`Failed querying filter for ${name}:`, err);
            return { name, logs: [] };
          }
        })
      );

      const parsedEvents = [];

      for (const { name, logs } of rawFilterResults) {
        for (const log of logs) {
          const timestampSec = await resolveTimestamp(log.blockNumber, log.args?.timestamp);
          const recordIdStr =
            log.args?.recordId !== undefined ? log.args.recordId.toString() : null;

          parsedEvents.push({
            id: `${log.transactionHash}-${log.index ?? log.logIndex ?? 0}`,
            type: name,
            blockNumber: log.blockNumber,
            logIndex: log.index ?? log.logIndex ?? 0,
            transactionHash: log.transactionHash,
            timestamp: timestampSec,
            patient: log.args?.patient || null,
            hospital: log.args?.hospital || null,
            recordId: recordIdStr,
            recordType: log.args?.recordType !== undefined ? Number(log.args.recordType) : null,
            recordTypes: log.args?.recordTypes ? log.args.recordTypes.map((t) => Number(t)) : null,
            expiryTimestamp: log.args?.expiryTimestamp ? Number(log.args.expiryTimestamp) : null,
            description: generateSentence(name, log.args),
          });
        }
      }

      // Sort newest first: block number descending, then logIndex descending
      parsedEvents.sort((a, b) => {
        if (b.blockNumber !== a.blockNumber) return b.blockNumber - a.blockNumber;
        return b.logIndex - a.logIndex;
      });

      setAllEvents(parsedEvents);
    } catch (err) {
      console.error("Audit trail fetch error:", err);
      setError(err.message || "Failed to query on-chain events");
    } finally {
      setIsLoading(false);
    }
  }, [contract, resolveTimestamp]);

  useEffect(() => {
    fetchAuditEvents();
  }, [fetchAuditEvents]);

  // ── Live event subscriptions (Real-time updates without reload) ─────────────
  useEffect(() => {
    if (!contract) return;

    const eventNames = [
      "RecordAdded",
      "AccessRequested",
      "ConsentGranted",
      "ConsentRevoked",
      "RecordAccessed",
      "PatientKeyUpdated",
    ];

    const listeners = eventNames.map((name) => {
      const listener = async (...args) => {
        try {
          const eventPayload = args[args.length - 1]; // ethers EventPayload / Log
          const logArgs = eventPayload.args || {};
          const timestampSec = await resolveTimestamp(
            eventPayload.blockNumber || 0,
            logArgs?.timestamp
          );
          const recordIdStr =
            logArgs?.recordId !== undefined ? logArgs.recordId.toString() : null;

          const newEvt = {
            id: `${eventPayload.transactionHash}-${eventPayload.index ?? eventPayload.logIndex ?? 0}`,
            type: name,
            blockNumber: eventPayload.blockNumber || 0,
            logIndex: eventPayload.index ?? eventPayload.logIndex ?? 0,
            transactionHash: eventPayload.transactionHash,
            timestamp: timestampSec,
            patient: logArgs?.patient || null,
            hospital: logArgs?.hospital || null,
            recordId: recordIdStr,
            recordType: logArgs?.recordType !== undefined ? Number(logArgs.recordType) : null,
            recordTypes: logArgs?.recordTypes ? logArgs.recordTypes.map((t) => Number(t)) : null,
            expiryTimestamp: logArgs?.expiryTimestamp ? Number(logArgs.expiryTimestamp) : null,
            description: generateSentence(name, logArgs),
          };

          setAllEvents((prev) => {
            if (prev.some((e) => e.id === newEvt.id)) return prev;
            return [newEvt, ...prev];
          });
          setLiveCount((c) => c + 1);
        } catch (err) {
          console.warn(`Error handling live event ${name}:`, err);
        }
      };

      contract.on(name, listener);
      return { name, listener };
    });

    return () => {
      listeners.forEach(({ name, listener }) => {
        contract.off(name, listener);
      });
    };
  }, [contract, resolveTimestamp]);

  // ── Role-Aware Filter ───────────────────────────────────────────────────────
  const roleFilteredEvents = useMemo(() => {
    if (!account) return [];
    const userAddr = account.toLowerCase();

    return allEvents.filter((evt) => {
      if (role === "Admin") return true; // Admin can inspect system-wide audit trail
      if (role === "Patient") {
        return evt.patient && evt.patient.toLowerCase() === userAddr;
      }
      if (role === "Hospital") {
        return evt.hospital && evt.hospital.toLowerCase() === userAddr;
      }
      return false; // Unregistered wallets cannot see other users' logs
    });
  }, [allEvents, account, role]);

  // ── User UI Filters ────────────────────────────────────────────────────────
  const filteredEvents = useMemo(() => {
    return roleFilteredEvents.filter((evt) => {
      // 1. Type filter
      if (selectedType !== "ALL" && evt.type !== selectedType) {
        return false;
      }

      // 2. Record ID filter
      if (recordIdFilter.trim()) {
        const targetId = recordIdFilter.trim().replace(/^#?REC-?/i, "");
        if (evt.recordId !== targetId) return false;
      }

      // 3. Search query (matches address or tx hash)
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const matchPatient = evt.patient && evt.patient.toLowerCase().includes(query);
        const matchHospital = evt.hospital && evt.hospital.toLowerCase().includes(query);
        const matchTx = evt.transactionHash && evt.transactionHash.toLowerCase().includes(query);
        if (!matchPatient && !matchHospital && !matchTx) return false;
      }

      return true;
    });
  }, [roleFilteredEvents, selectedType, recordIdFilter, searchQuery]);

  // ── Real Statistics (Computed Strictly from Loaded Events) ──────────────────
  const stats = useMemo(() => {
    let recordAccessCount = 0;
    let consentGrantedCount = 0;
    let consentRevokedCount = 0;

    roleFilteredEvents.forEach((evt) => {
      if (evt.type === "RecordAccessed") recordAccessCount++;
      if (evt.type === "ConsentGranted") consentGrantedCount++;
      if (evt.type === "ConsentRevoked") consentRevokedCount++;
    });

    return {
      total: roleFilteredEvents.length,
      accesses: recordAccessCount,
      grants: consentGrantedCount,
      revocations: consentRevokedCount,
    };
  }, [roleFilteredEvents]);

  // ── Real Consents by Category (Computed from ConsentGranted events) ────────
  const categoryStats = useMemo(() => {
    const counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
    let total = 0;

    roleFilteredEvents.forEach((evt) => {
      if (evt.type === "ConsentGranted" && evt.recordTypes) {
        evt.recordTypes.forEach((t) => {
          if (counts[t] !== undefined) {
            counts[t]++;
            total++;
          }
        });
      }
    });

    const items = [
      { id: 0, name: "Radiology", color: "#10b981", count: counts[0] },
      { id: 1, name: "Pathology", color: "#0284c7", count: counts[1] },
      { id: 2, name: "Cardiology", color: "#0f766e", count: counts[2] },
      { id: 3, name: "General", color: "#64748b", count: counts[3] },
    ];

    return { items, total };
  }, [roleFilteredEvents]);

  // ── Pagination Slice ───────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / pageSize));
  const paginatedEvents = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredEvents.slice(start, start + pageSize);
  }, [filteredEvents, currentPage]);

  // ── Export to CSV ──────────────────────────────────────────────────────────
  const handleExportCsv = () => {
    if (filteredEvents.length === 0) return;

    const headers = [
      "Timestamp (UTC)",
      "Local Time",
      "Event Type",
      "Description",
      "Record ID",
      "Patient Address",
      "Hospital Address",
      "Transaction Hash",
      "Block Number",
    ];

    const rows = filteredEvents.map((e) => [
      new Date(e.timestamp * 1000).toISOString(),
      `"${new Date(e.timestamp * 1000).toLocaleString()}"`,
      e.type,
      `"${e.description.replace(/"/g, '""')}"`,
      e.recordId ? `#REC-${e.recordId}` : "",
      e.patient || "",
      e.hospital || "",
      e.transactionHash,
      e.blockNumber,
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mediconsent-audit-trail-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // ── Guard: Disconnected Wallet ─────────────────────────────────────────────
  if (!account) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-20 text-center space-y-4">
        <div className="w-16 h-16 rounded-3xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto border border-slate-200">
          <ShieldAlert className="w-8 h-8 text-teal-700" />
        </div>
        <h2 className="text-xl font-bold text-slate-800">Connect Wallet for Audit Trail</h2>
        <p className="text-slate-500 text-sm max-w-md mx-auto leading-relaxed">
          Please connect MetaMask to inspect your on-chain audit trail. MediConsent limits audit log visibility to authorized participants to protect patient privacy.
        </p>
      </div>
    );
  }

  // ── Guard: Unregistered Wallet ─────────────────────────────────────────────
  if (role === "Unregistered") {
    return (
      <div className="max-w-4xl mx-auto px-6 py-20 text-center space-y-4">
        <div className="w-16 h-16 rounded-3xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-200">
          <Lock className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-slate-800">Role-Restricted Audit Log</h2>
        <p className="text-slate-600 text-sm max-w-md mx-auto leading-relaxed">
          Your wallet (<span className="font-mono text-slate-800 font-semibold">{shorten(account)}</span>) is not registered as a patient or hospital. Audit logs are strictly role-aware and only reveal events involving registered participants.
        </p>
        <p className="text-xs text-slate-500 bg-slate-100 px-3 py-1.5 rounded-xl inline-block">
          Visit the Patient Portal to self-register as a Patient, or contact the admin for Hospital registration.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* ── Top Eyebrow & Page Header ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          {/* Real network & block height pill */}
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-teal-50 border border-teal-200 text-teal-800 text-[11px] font-semibold">
            <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse"></span>
            <span>{getNetworkName(chainId)}</span>
            <span className="text-teal-300">|</span>
            <span className="font-mono text-teal-700">
              Block #{latestBlock !== null ? latestBlock.toLocaleString() : "Syncing…"}
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
            Cryptographic Audit Trail & Governance
          </h1>
          <p className="text-xs text-slate-500 max-w-2xl leading-relaxed">
            An on-chain, verifiable record of every consent grant, access request, key registration and record access.
          </p>
        </div>

        {/* Header Actions */}
        <div className="flex items-center space-x-2.5 pt-2">
          <button
            type="button"
            onClick={fetchAuditEvents}
            disabled={isLoading}
            className="flex items-center space-x-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
            title="Refresh on-chain logs"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${isLoading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filteredEvents.length === 0}
            className="flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-teal-800 hover:bg-teal-700 text-white shadow-sm transition-colors disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5 text-white" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* ── Real Statistics Tiles (Strictly Computed from Events) ─────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {/* Tile 1: Total Events */}
        <div className="bg-white rounded-3xl border border-slate-200/90 p-5 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Total On-Chain Events
            </span>
            <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center border border-teal-200/60">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-slate-900">
            {stats.total.toLocaleString()}
          </div>
          <p className="text-[11px] text-slate-500 flex items-center space-x-1">
            <span>Recorded in smart contract</span>
          </p>
        </div>

        {/* Tile 2: Record Accesses */}
        <div className="bg-white rounded-3xl border border-slate-200/90 p-5 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Record Accesses
            </span>
            <div className="w-8 h-8 rounded-xl bg-sky-50 text-sky-700 flex items-center justify-center border border-sky-200/60">
              <Eye className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-slate-900">
            {stats.accesses.toLocaleString()}
          </div>
          <p className="text-[11px] text-slate-500 flex items-center space-x-1">
            <span>Audited decryption accesses</span>
          </p>
        </div>

        {/* Tile 3: Consents Granted */}
        <div className="bg-white rounded-3xl border border-slate-200/90 p-5 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Consents Granted
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center border border-emerald-200/60">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-slate-900">
            {stats.grants.toLocaleString()}
          </div>
          <p className="text-[11px] text-slate-500 flex items-center space-x-1">
            <span>Patient key delegations</span>
          </p>
        </div>

        {/* Tile 4: Smart Revocations */}
        <div className="bg-white rounded-3xl border border-slate-200/90 p-5 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Smart Revocations
            </span>
            <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center border border-rose-200/60">
              <XCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-rose-700">
            {stats.revocations.toLocaleString()}
          </div>
          <p className="text-[11px] text-slate-500 flex items-center space-x-1">
            <span>Immediate on-chain nullifications</span>
          </p>
        </div>
      </div>

      {/* ── Filters Bar ──────────────────────────────────────────────────── */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 sm:gap-4 items-end">
          {/* Event Classification */}
          <div className="md:col-span-4 space-y-1.5">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Event Classification
            </label>
            <select
              value={selectedType}
              onChange={(e) => {
                setSelectedType(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-3.5 py-2.5 rounded-2xl bg-slate-50 border border-slate-200 text-slate-800 text-xs font-medium focus:outline-none focus:border-teal-600 transition-colors"
            >
              <option value="ALL">All Events ({roleFilteredEvents.length})</option>
              <option value="RecordAdded">Record Added</option>
              <option value="AccessRequested">Access Requested</option>
              <option value="ConsentGranted">Consent Granted</option>
              <option value="ConsentRevoked">Consent Revoked</option>
              <option value="RecordAccessed">Record Accessed</option>
              <option value="PatientKeyUpdated">Patient Key Updated</option>
            </select>
          </div>

          {/* Medical Record ID */}
          <div className="md:col-span-3 space-y-1.5">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Medical Record ID
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="#REC-..."
                value={recordIdFilter}
                onChange={(e) => {
                  setRecordIdFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full px-3.5 py-2.5 rounded-2xl bg-slate-50 border border-slate-200 text-slate-800 text-xs font-mono focus:outline-none focus:border-teal-600 transition-colors"
              />
            </div>
          </div>

          {/* Hospital / Signer Address Search */}
          <div className="md:col-span-5 space-y-1.5">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Hospital / Signer Address
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="text"
                placeholder="0x... or transaction hash"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full pl-9 pr-3.5 py-2.5 rounded-2xl bg-slate-50 border border-slate-200 text-slate-800 text-xs font-mono focus:outline-none focus:border-teal-600 transition-colors"
              />
            </div>
          </div>
        </div>

        {/* Filter Info & Live Indicator */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100 text-xs">
          <div className="flex items-center space-x-2 text-slate-500">
            <span>Auditing scope:</span>
            <span className="font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-lg border border-slate-200">
              {role === "Admin" ? "System-Wide (Admin)" : `${role} Perspective`}
            </span>
            <span className="font-mono text-[11px] text-slate-400">({shorten(account)})</span>
            {(selectedType !== "ALL" || recordIdFilter || searchQuery) && (
              <button
                type="button"
                onClick={() => {
                  setSelectedType("ALL");
                  setRecordIdFilter("");
                  setSearchQuery("");
                  setCurrentPage(1);
                }}
                className="text-xs text-teal-700 hover:text-teal-800 font-semibold ml-2 underline"
              >
                Reset Filters
              </button>
            )}
          </div>

          <div className="flex items-center space-x-2 text-teal-700 font-medium">
            <Radio className="w-3.5 h-3.5 text-teal-600 animate-pulse" />
            <span>Syncing live with contract events</span>
            {liveCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold">
                +{liveCount} new
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Timeline Display ─────────────────────────────────────────────── */}
      <div className="space-y-4">
        {/* Loading State */}
        {isLoading && (
          <div className="py-16 text-center space-y-3 bg-white rounded-3xl border border-slate-200/90 shadow-sm">
            <RefreshCw className="w-7 h-7 text-teal-600 animate-spin mx-auto" />
            <p className="text-xs text-slate-500">Scanning blockchain logs & caching block timestamps…</p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
            Error querying audit logs: {error}
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && filteredEvents.length === 0 && (
          <div className="bg-white rounded-3xl p-12 text-center border border-slate-200/90 shadow-sm space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <Activity className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-slate-800">No Matching Audit Events</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
              No on-chain events matched your active filters for address {shorten(account)}. When records are uploaded, requested, or accessed, they will be logged here in smart contract events.
            </p>
          </div>
        )}

        {/* Timeline Entries (Matching Design Screenshot 5) */}
        {!isLoading && paginatedEvents.length > 0 && (
          <div className="relative pl-7 sm:pl-9 space-y-4 before:content-[''] before:absolute before:left-3.5 sm:before:left-4 before:top-4 before:bottom-4 before:w-0.5 before:bg-slate-200">
            {paginatedEvents.map((evt) => {
              const cfg = EVENT_CONFIGS[evt.type] || {
                label: evt.type,
                badge: "bg-slate-100 text-slate-700 border-slate-200",
                dot: "bg-slate-400",
                nodeBorder: "border-slate-400",
                iconBg: "bg-slate-100 text-slate-700",
                statusBadge: "Recorded On-Chain",
                icon: Activity,
              };

              const IconComponent = cfg.icon;
              const formattedDate = new Date(evt.timestamp * 1000).toLocaleString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              });

              return (
                <div key={evt.id} className="relative group">
                  {/* Timeline node icon */}
                  <div
                    className={`absolute -left-[27px] sm:-left-[31px] top-3 w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white border-2 ${cfg.nodeBorder} flex items-center justify-center shadow-sm z-10`}
                  >
                    <IconComponent className="w-3.5 h-3.5 text-slate-700" />
                  </div>

                  {/* Event Card */}
                  <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/90 shadow-sm hover:shadow-md transition-shadow space-y-3">
                    {/* Header Row: Type badge + Target Record + Timestamp + Block */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center space-x-2">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${cfg.badge}`}
                        >
                          {cfg.label}
                        </span>

                        {evt.recordId && (
                          <span className="text-xs font-bold font-mono px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 border border-slate-200">
                            #REC-{evt.recordId}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center space-x-2 text-xs text-slate-400">
                        <span className="flex items-center space-x-1">
                          <Clock className="w-3.5 h-3.5" />
                          <span>{formattedDate}</span>
                        </span>
                        <span>•</span>
                        <span className="font-mono text-slate-600 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100 text-[11px]">
                          Block #{evt.blockNumber}
                        </span>
                      </div>
                    </div>

                    {/* Plain Language Sentence */}
                    <p className="text-sm text-slate-800 leading-relaxed font-medium">
                      {evt.description}
                    </p>

                    {/* Sub-bar: Transaction details & Cryptographic status */}
                    <div className="flex flex-wrap items-center justify-between pt-3 border-t border-slate-100 text-xs gap-2">
                      <div className="flex flex-wrap items-center space-x-4 text-slate-500">
                        {/* Transaction Hash */}
                        <div className="flex items-center space-x-1 font-mono text-[11px]">
                          <span className="text-slate-400">Tx:</span>
                          <span className="text-slate-700">{shorten(evt.transactionHash)}</span>
                          <button
                            type="button"
                            onClick={() => handleCopy(evt.transactionHash, evt.id)}
                            className="p-1 text-slate-400 hover:text-teal-700 transition-colors"
                            title="Copy Transaction Hash"
                          >
                            {copiedTx === evt.id ? (
                              <Check className="w-3.5 h-3.5 text-teal-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>

                        {/* Patient */}
                        {evt.patient && (
                          <span className="flex items-center space-x-1">
                            <User className="w-3.5 h-3.5 text-teal-600" />
                            <span>Patient:</span>
                            <span className="font-mono text-slate-700">{shorten(evt.patient)}</span>
                          </span>
                        )}

                        {/* Hospital */}
                        {evt.hospital && (
                          <span className="flex items-center space-x-1">
                            <Building2 className="w-3.5 h-3.5 text-sky-600" />
                            <span>Hospital:</span>
                            <span className="font-mono text-slate-700">{shorten(evt.hospital)}</span>
                          </span>
                        )}
                      </div>

                      {/* On-chain status badge */}
                      <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                        <CheckCircle2 className="w-3 h-3 text-teal-600" />
                        <span>{cfg.statusBadge}</span>
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Real Pagination Controls ────────────────────────────────────────── */}
        {!isLoading && totalPages > 1 && (
          <div className="bg-white rounded-3xl border border-slate-200/90 p-4 shadow-sm flex flex-wrap items-center justify-between text-xs text-slate-600 gap-3">
            <span>
              Showing {(currentPage - 1) * pageSize + 1}–
              {Math.min(currentPage * pageSize, filteredEvents.length)} of {filteredEvents.length}{" "}
              on-chain events
            </span>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="flex items-center space-x-1 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold disabled:opacity-40 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Previous</span>
              </button>

              <span className="px-3 py-1.5 rounded-xl bg-teal-50 border border-teal-200 text-teal-800 font-semibold">
                Page {currentPage} of {totalPages}
              </span>

              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="flex items-center space-x-1 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold disabled:opacity-40 transition-colors"
              >
                <span>Next</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom Section: Consents by Category & Protocol Architecture ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left: Consents by Category Donut (Computed from ConsentGranted events) */}
        <div className="lg:col-span-5 bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-7 shadow-sm flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <p className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                  On-Chain Category Distribution
                </p>
                <h3 className="text-base font-bold text-slate-900">Consents by Category</h3>
              </div>
              <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center border border-teal-200/60">
                <PieChart className="w-4 h-4" />
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Distribution of granted patient consent scopes across medical categories.
            </p>
          </div>

          {/* Donut graphic */}
          <div className="flex flex-col items-center justify-center py-4">
            <div className="relative w-36 h-36 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                {/* Background Ring */}
                <circle
                  cx="50"
                  cy="50"
                  r="38"
                  className="text-slate-100"
                  strokeWidth="12"
                  stroke="currentColor"
                  fill="transparent"
                />

                {/* Data segments */}
                {categoryStats.total > 0 ? (
                  categoryStats.items.reduce(
                    (acc, item) => {
                      if (item.count === 0) return acc;
                      const circumference = 2 * Math.PI * 38;
                      const strokeDasharray = `${(item.count / categoryStats.total) * circumference} ${circumference}`;
                      const strokeDashoffset = -acc.offset;

                      acc.elements.push(
                        <circle
                          key={item.id}
                          cx="50"
                          cy="50"
                          r="38"
                          stroke={item.color}
                          strokeWidth="12"
                          strokeDasharray={strokeDasharray}
                          strokeDashoffset={strokeDashoffset}
                          fill="transparent"
                          className="transition-all duration-500"
                        />
                      );

                      acc.offset += (item.count / categoryStats.total) * circumference;
                      return acc;
                    },
                    { elements: [], offset: 0 }
                  ).elements
                ) : (
                  <circle
                    cx="50"
                    cy="50"
                    r="38"
                    stroke="#cbd5e1"
                    strokeWidth="12"
                    fill="transparent"
                  />
                )}
              </svg>

              {/* Center text */}
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-xl font-extrabold text-slate-900">
                  {categoryStats.total}
                </span>
                <span className="text-[10px] text-slate-400 uppercase font-semibold">
                  Grants
                </span>
              </div>
            </div>
          </div>

          {/* Category breakdown legend */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-xs">
            {categoryStats.items.map((cat) => (
              <div key={cat.id} className="flex items-center space-x-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color }}></span>
                <span className="text-slate-600 text-[11px] truncate">{cat.name}:</span>
                <span className="font-semibold text-slate-800 text-[11px]">
                  {cat.count} (
                  {categoryStats.total > 0
                    ? `${Math.round((cat.count / categoryStats.total) * 100)}%`
                    : "0%"}
                  )
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Smart Contract Architecture & Security Model */}
        <div className="lg:col-span-7 bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-7 shadow-sm flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <p className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                  Verifiable Governance
                </p>
                <h3 className="text-base font-bold text-slate-900">
                  Smart Contract Event Architecture
                </h3>
              </div>
              <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-teal-50 text-teal-800 border border-teal-200">
                <ShieldCheck className="w-3.5 h-3.5 text-teal-600" />
                <span>On-Chain Consensus</span>
              </span>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Events are recorded in smart contract event logs. On a public blockchain network, these logs cannot be altered. In our local demo environment, the node resets when restarted.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1">
              <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 space-y-1">
                <span className="font-semibold text-slate-800 flex items-center space-x-1.5">
                  <Database className="w-3.5 h-3.5 text-teal-600" />
                  <span>Smart Contract Event Logs</span>
                </span>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  RecordAdded, AccessRequested, ConsentGranted, and RecordAccessed events are emitted sequentially and ordered by block numbers.
                </p>
              </div>

              <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 space-y-1">
                <span className="font-semibold text-slate-800 flex items-center space-x-1.5">
                  <XCircle className="w-3.5 h-3.5 text-rose-600" />
                  <span>O(1) Smart Revocation</span>
                </span>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Revocation updates the on-chain timestamp instantly, preventing future access queries while preserving past event logs.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs text-slate-500">
            <span>Consensus Network: <strong className="text-slate-800">{getNetworkName(chainId)}</strong></span>
            <span className="font-mono text-[11px] text-slate-600 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-100">
              Contract Event Logs
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

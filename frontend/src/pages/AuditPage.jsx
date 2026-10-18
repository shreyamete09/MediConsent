/**
 * @file AuditPage.jsx
 * @notice Immutable Audit Trail Explorer for MediConsent.
 *
 * Requirements:
 * 1. Timeline of on-chain events, newest first: RecordAdded, AccessRequested,
 *    ConsentGranted, ConsentRevoked, RecordAccessed, PatientKeyUpdated.
 * 2. Each entry shows: distinct color badge, plain-language sentence, block timestamp,
 *    and transaction hash with copy button.
 * 3. Role-aware view:
 *    - Patient sees only events involving their own address.
 *    - Hospital sees events it caused or that involve it.
 *    - Unregistered / disconnected users see a clear security & privacy notice.
 * 4. Filters: by event type, by record ID, and free-text address search.
 * 5. Live updates without page reload (subscriptions to contract events).
 * 6. Block timestamp caching (avoids redundant RPC calls per event).
 * 7. Pagination (loads recent 100 first, 25 per page) and CSV export.
 *
 * RULES: Read-only page. Zero transactions, zero private keys involved.
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
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
  const recordId = args?.recordId !== undefined ? `#${args.recordId.toString()}` : "";

  switch (type) {
    case "RecordAdded": {
      const cat = args?.recordType !== undefined ? recordTypeLabel(args.recordType) : "record";
      return `Hospital ${hospital} uploaded encrypted medical ${cat} ${recordId} for patient ${patient}`;
    }
    case "AccessRequested": {
      const cats = (args?.recordTypes || []).map((t) => recordTypeLabel(t)).join(", ") || "records";
      return `Hospital ${hospital} requested access to ${cats} for patient ${patient}`;
    }
    case "ConsentGranted": {
      const cats = (args?.recordTypes || []).map((t) => recordTypeLabel(t)).join(", ") || "records";
      const expiry = args?.expiryTimestamp
        ? new Date(Number(args.expiryTimestamp) * 1000).toLocaleString()
        : "specified duration";
      return `Patient ${patient} granted consent to hospital ${hospital} for ${cats} until ${expiry}`;
    }
    case "ConsentRevoked":
      return `Patient ${patient} revoked all active consent permissions for hospital ${hospital}`;
    case "RecordAccessed":
      return `Hospital ${hospital} accessed and verified medical record ${recordId} of patient ${patient}`;
    case "PatientKeyUpdated":
      return `Patient ${patient} published/updated their RSA public key on the blockchain`;
    case "PatientRegistered":
      return `Patient ${patient} self-registered on the MediConsent smart contract`;
    case "HospitalRegistered":
      return `Admin verified and registered hospital ${hospital} (${args?.name || "Verified Hospital"})`;
    default:
      return `System event ${type} executed on-chain`;
  }
}

// Event badge configurations
const EVENT_CONFIGS = {
  RecordAdded: {
    label: "Record Added",
    badge: "bg-cyan-950/80 text-cyan-300 border-cyan-500/40",
    dot: "bg-cyan-400",
  },
  AccessRequested: {
    label: "Access Requested",
    badge: "bg-amber-950/80 text-amber-300 border-amber-500/40",
    dot: "bg-amber-400",
  },
  ConsentGranted: {
    label: "Consent Granted",
    badge: "bg-emerald-950/80 text-emerald-300 border-emerald-500/40",
    dot: "bg-emerald-400",
  },
  ConsentRevoked: {
    label: "Consent Revoked",
    badge: "bg-rose-950/80 text-rose-300 border-rose-500/40",
    dot: "bg-rose-400",
  },
  RecordAccessed: {
    label: "Record Accessed",
    badge: "bg-purple-950/80 text-purple-300 border-purple-500/40",
    dot: "bg-purple-400",
  },
  PatientKeyUpdated: {
    label: "Key Updated",
    badge: "bg-sky-950/80 text-sky-300 border-sky-500/40",
    dot: "bg-sky-400",
  },
  PatientRegistered: {
    label: "Patient Registered",
    badge: "bg-teal-950/80 text-teal-300 border-teal-500/40",
    dot: "bg-teal-400",
  },
  HospitalRegistered: {
    label: "Hospital Registered",
    badge: "bg-blue-950/80 text-blue-300 border-blue-500/40",
    dot: "bg-blue-400",
  },
};

export default function AuditPage() {
  const { account, role, contract, provider } = useWeb3();

  // State
  const [allEvents, setAllEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copiedTx, setCopiedTx] = useState(null);
  const [liveCount, setLiveCount] = useState(0);

  // Filters
  const [selectedType, setSelectedType] = useState("ALL");
  const [recordIdFilter, setRecordIdFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;

  // Block timestamp cache (to prevent multiple RPC calls per block)
  const blockTimeCache = useRef(new Map());

  // Copy helper
  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedTx(id);
    setTimeout(() => setCopiedTx(null), 2000);
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
            // Deduplicate if already present
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
        const targetId = recordIdFilter.trim().replace(/^#/, "");
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
      e.recordId || "",
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
        <ShieldAlert className="w-14 h-14 text-purple-400 mx-auto" />
        <h2 className="text-xl font-bold text-slate-200">Connect Wallet for Audit Trail</h2>
        <p className="text-slate-400 text-sm max-w-md mx-auto">
          Please connect MetaMask to inspect your immutable on-chain audit trail. MediConsent limits audit log visibility to authorized participants to protect patient privacy.
        </p>
      </div>
    );
  }

  // ── Guard: Unregistered Wallet ─────────────────────────────────────────────
  if (role === "Unregistered") {
    return (
      <div className="max-w-4xl mx-auto px-6 py-20 text-center space-y-4">
        <Lock className="w-14 h-14 text-amber-400 mx-auto" />
        <h2 className="text-xl font-bold text-slate-200">Role-Restricted Audit Log</h2>
        <p className="text-slate-400 text-sm max-w-md mx-auto">
          Your wallet (<span className="font-mono text-amber-300">{shorten(account)}</span>) is not registered as a patient or hospital. Audit logs are strictly role-aware and only reveal events involving registered participants.
        </p>
        <p className="text-xs text-slate-500">
          Visit the Home page to register as a Patient, or request Hospital verification from the contract admin.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 space-y-8">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 rounded-2xl bg-purple-950/80 border border-purple-500/30 flex items-center justify-center text-purple-400 shadow-lg shadow-purple-500/10">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center space-x-2">
              <span>Immutable Audit Trail Explorer</span>
              <span className="flex items-center space-x-1 text-xs px-2.5 py-0.5 rounded-full bg-purple-950 text-purple-300 border border-purple-500/30 font-medium">
                <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
                <span>Live Feed</span>
              </span>
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Zero-knowledge cryptographic access trail reconstructed from smart contract events
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {liveCount > 0 && (
            <span className="text-[11px] font-semibold text-emerald-400 bg-emerald-950/70 border border-emerald-500/30 px-2.5 py-1.5 rounded-xl animate-fadeIn">
              +{liveCount} live event(s)
            </span>
          )}

          <button
            onClick={fetchAuditEvents}
            disabled={isLoading}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-slate-900 border border-slate-700 text-slate-300 hover:text-white transition-colors disabled:opacity-50"
            title="Refresh on-chain logs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>

          <button
            onClick={handleExportCsv}
            disabled={filteredEvents.length === 0}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-purple-900/40 hover:bg-purple-900/60 border border-purple-500/40 text-purple-200 transition-colors disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* ── Role Scope Banner ────────────────────────────────────────────── */}
      <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-wrap items-center justify-between text-xs text-slate-300 gap-2">
        <div className="flex items-center space-x-2">
          <span className="text-slate-400">Auditing scope:</span>
          <span className="font-semibold text-white px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700">
            {role === "Admin" ? "System-Wide (Admin)" : `${role} Perspective`}
          </span>
          <span className="font-mono text-slate-400 text-[11px]">({account})</span>
        </div>
        <span className="text-slate-400 text-[11px]">
          Showing {filteredEvents.length} relevant event(s)
        </span>
      </div>

      {/* ── Filters Bar ──────────────────────────────────────────────────── */}
      <div className="glass-panel rounded-2xl p-4 border border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Event Type Filter */}
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Event Type
            </label>
            <select
              value={selectedType}
              onChange={(e) => {
                setSelectedType(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-purple-500"
            >
              <option value="ALL">All Event Types</option>
              <option value="RecordAdded">RecordAdded</option>
              <option value="AccessRequested">AccessRequested</option>
              <option value="ConsentGranted">ConsentGranted</option>
              <option value="ConsentRevoked">ConsentRevoked</option>
              <option value="RecordAccessed">RecordAccessed (Audited Access)</option>
              <option value="PatientKeyUpdated">PatientKeyUpdated</option>
            </select>
          </div>

          {/* Record ID Filter */}
          <div className="w-36">
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Record ID
            </label>
            <input
              type="text"
              placeholder="e.g. 1"
              value={recordIdFilter}
              onChange={(e) => {
                setRecordIdFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-purple-500 font-mono"
            />
          </div>

          {/* Address / Tx Search */}
          <div className="flex-1 min-w-[220px]">
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Search Address or Tx Hash
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="0x..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-purple-500 font-mono"
              />
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
            </div>
          </div>
        </div>
      </div>

      {/* ── Timeline Display ─────────────────────────────────────────────── */}
      <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-6">
        {/* Loading State */}
        {isLoading && (
          <div className="py-16 text-center space-y-3">
            <RefreshCw className="w-7 h-7 text-purple-400 animate-spin mx-auto" />
            <p className="text-xs text-slate-400">Scanning blockchain logs & caching block timestamps…</p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-500/30 text-xs text-rose-300">
            Error querying audit logs: {error}
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && filteredEvents.length === 0 && (
          <div className="glass-card rounded-xl p-12 text-center border border-slate-800 space-y-3">
            <Activity className="w-10 h-10 text-slate-700 mx-auto" />
            <h4 className="text-sm font-semibold text-slate-300">No Matching Audit Events</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
              No on-chain events matched your active filters for address {shorten(account)}. When records are uploaded, requested, or accessed, they will be logged immutably here.
            </p>
          </div>
        )}

        {/* Timeline Entries */}
        {!isLoading && paginatedEvents.length > 0 && (
          <div className="relative pl-6 space-y-6 before:content-[''] before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-800">
            {paginatedEvents.map((evt) => {
              const cfg = EVENT_CONFIGS[evt.type] || {
                label: evt.type,
                badge: "bg-slate-800 text-slate-300 border-slate-700",
                dot: "bg-slate-500",
              };

              const formattedDate = new Date(evt.timestamp * 1000).toLocaleString();

              return (
                <div key={evt.id} className="relative group">
                  {/* Timeline dot */}
                  <span
                    className={`absolute -left-[27px] top-1.5 w-3 h-3 rounded-full border-2 border-slate-950 ${cfg.dot} shadow-sm`}
                  />

                  {/* Event Card */}
                  <div className="glass-card rounded-xl p-4 border border-slate-800 hover:border-slate-700 transition-all space-y-2.5">
                    {/* Header Row: Badge + Timestamp + Block Number */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center space-x-2">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${cfg.badge}`}
                        >
                          {cfg.label}
                        </span>

                        {evt.recordId && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700">
                            Record #{evt.recordId}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center space-x-2 text-[11px] text-slate-400">
                        <span className="flex items-center space-x-1">
                          <Clock className="w-3 h-3" />
                          <span>{formattedDate}</span>
                        </span>
                        <span className="text-slate-600">•</span>
                        <span className="font-mono text-[10px] text-slate-500">
                          Block #{evt.blockNumber}
                        </span>
                      </div>
                    </div>

                    {/* Plain Language Sentence */}
                    <p className="text-xs text-slate-200 leading-relaxed font-medium">
                      {evt.description}
                    </p>

                    {/* Footer Row: Addresses & Tx Hash */}
                    <div className="flex flex-wrap items-center justify-between pt-1 border-t border-slate-800/60 text-[11px] gap-2">
                      <div className="flex items-center space-x-3 text-slate-400">
                        {evt.patient && (
                          <span className="flex items-center space-x-1">
                            <User className="w-3 h-3 text-emerald-400" />
                            <span>Patient:</span>
                            <span className="font-mono text-slate-300">{shorten(evt.patient)}</span>
                          </span>
                        )}
                        {evt.hospital && (
                          <span className="flex items-center space-x-1">
                            <Building2 className="w-3 h-3 text-blue-400" />
                            <span>Hospital:</span>
                            <span className="font-mono text-slate-300">{shorten(evt.hospital)}</span>
                          </span>
                        )}
                      </div>

                      {/* Transaction Hash */}
                      <div className="flex items-center space-x-1.5 font-mono text-[10px]">
                        <span className="text-slate-500">Tx:</span>
                        <span className="text-slate-400">{shorten(evt.transactionHash)}</span>
                        <button
                          onClick={() => handleCopy(evt.transactionHash, evt.id)}
                          className="p-1 text-slate-500 hover:text-purple-300 transition-colors"
                          title="Copy Transaction Hash"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                        {copiedTx === evt.id && (
                          <span className="text-[10px] text-emerald-400 font-sans">Copied!</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Pagination Controls ────────────────────────────────────────── */}
        {!isLoading && totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 border-t border-slate-800 text-xs text-slate-400">
            <span>
              Page {currentPage} of {totalPages} ({filteredEvents.length} total events)
            </span>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

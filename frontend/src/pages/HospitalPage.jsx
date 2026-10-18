/**
 * @file HospitalPage.jsx
 * @notice Hospital portal — upload records.
 * Phase 4B-1: Upload flow only. Request access + view records come next.
 */

import React, { useState, useEffect } from "react";
import { useWeb3 } from "../context/Web3Context";
import { useKeystore } from "../hooks/useKeystore.js";
import KeystoreManager from "../components/KeystoreManager.jsx";
import UploadRecordForm from "../components/UploadRecordForm.jsx";
import RequestAccessPanel from "../components/RequestAccessPanel.jsx";
import RecordViewerPanel from "../components/RecordViewerPanel.jsx";
import { Building2, Upload, Send, Eye, AlertTriangle, CheckCircle2 } from "lucide-react";

export default function HospitalPage() {
  const { account, role, contract } = useWeb3();
  const { publicKey, privateKey, publicKeyB64, isLoading, error, downloadBackup, importFromFile } =
    useKeystore(account);

  const [isHospitalRegistered, setIsHospitalRegistered] = useState(null);
  const [hospitalName, setHospitalName] = useState("");
  const [recentUploads, setRecentUploads] = useState([]);
  const [activeTab, setActiveTab] = useState("upload"); // 'upload' | 'request'

  // Verify hospital registration status and name on-chain
  useEffect(() => {
    if (!contract || !account) return;
    (async () => {
      try {
        const info = await contract.hospitals(account);
        setIsHospitalRegistered(info.isRegistered);
        setHospitalName(info.name);
      } catch {
        setIsHospitalRegistered(false);
      }
    })();
  }, [contract, account]);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (!account) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-20 text-center space-y-4">
        <Building2 className="w-12 h-12 text-slate-700 mx-auto" />
        <h2 className="text-xl font-semibold text-slate-400">Connect MetaMask to access the Hospital Portal</h2>
      </div>
    );
  }

  if (role !== "Hospital" && role !== "Admin") {
    return (
      <div className="max-w-3xl mx-auto px-6 py-20 text-center space-y-4">
        <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto" />
        <h2 className="text-xl font-semibold text-slate-300">Access Restricted</h2>
        <p className="text-slate-400 text-sm">
          This portal is only accessible to registered hospitals (HOSPITAL_ROLE).
          Ask the contract admin to register your wallet address.
        </p>
        <p className="text-xs font-mono text-slate-500">Connected: {account}</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-blue-950 border border-blue-500/30 flex items-center justify-center text-blue-400">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">
              {hospitalName ? hospitalName : "Hospital Portal"}
            </h1>
            <p className="text-xs text-slate-400 font-mono">{account}</p>
          </div>
        </div>

        {/* Registration status */}
        {isHospitalRegistered !== null && (
          <div
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${
              isHospitalRegistered
                ? "bg-emerald-950/60 text-emerald-300 border-emerald-500/30"
                : "bg-amber-950/60 text-amber-300 border-amber-500/30"
            }`}
          >
            {isHospitalRegistered ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Registered On-Chain</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Not Registered</span>
              </>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — keystore + recent uploads */}
        <div className="space-y-5">
          {/* Keystore manager */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-300">Cryptographic Identity</h3>
            <KeystoreManager
              publicKeyB64={publicKeyB64}
              isLoading={isLoading}
              error={error}
              downloadBackup={downloadBackup}
              importFromFile={importFromFile}
            />
          </div>

          {/* Recent uploads */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-300">Recent Uploads</h3>
            {recentUploads.length === 0 ? (
              <div className="glass-card rounded-xl p-5 text-center border border-slate-700/40">
                <Upload className="w-7 h-7 text-slate-700 mx-auto mb-2" />
                <p className="text-xs text-slate-500">No records uploaded this session</p>
              </div>
            ) : (
              <div className="space-y-2">
                {recentUploads.map((r) => (
                  <div key={r.recordId} className="glass-card rounded-xl p-3 border border-slate-700/40 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-200">Record #{r.recordId}</span>
                      <span className="text-[10px] text-emerald-400">Confirmed</span>
                    </div>
                    <p className="text-[10px] font-mono text-slate-500 truncate">{r.cid}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column — tab navigation and panel */}
        <div className="lg:col-span-2 space-y-6">
          {/* Tab selector */}
          <div className="flex items-center space-x-2 p-1.5 rounded-xl bg-slate-900 border border-slate-800">
            <button
              onClick={() => setActiveTab("upload")}
              className={`flex-1 flex items-center justify-center space-x-2 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === "upload"
                  ? "bg-slate-800 text-white shadow-sm border border-slate-700"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload Medical Record</span>
            </button>

            <button
              onClick={() => setActiveTab("request")}
              className={`flex-1 flex items-center justify-center space-x-2 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === "request"
                  ? "bg-slate-800 text-white shadow-sm border border-slate-700"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              <span>Request Access</span>
            </button>

            <button
              onClick={() => setActiveTab("view")}
              className={`flex-1 flex items-center justify-center space-x-2 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === "view"
                  ? "bg-slate-800 text-white shadow-sm border border-slate-700"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Consented Records</span>
            </button>
          </div>

          {/* Upload Form Tab */}
          {activeTab === "upload" && (
            <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-4">
              <h2 className="text-lg font-bold text-white flex items-center space-x-2">
                <Upload className="w-5 h-5 text-blue-400" />
                <span>Upload Medical Record</span>
              </h2>
              <p className="text-xs text-slate-500 leading-relaxed">
                Select a patient address, choose the record category, and pick the file.
                The file will be encrypted with AES-256-GCM inside your browser before any data
                leaves your device. The AES key is wrapped with the patient's RSA-OAEP public key
                (fetched from the smart contract).
              </p>

              {isHospitalRegistered === false && (
                <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/30 text-xs text-amber-300">
                  ⚠ Your wallet is not registered as a hospital on-chain. Contact the contract admin.
                </div>
              )}

              <UploadRecordForm
                onSuccess={(rec) => setRecentUploads((prev) => [rec, ...prev].slice(0, 5))}
              />
            </div>
          )}

          {/* Request Access Tab */}
          {activeTab === "request" && (
            <RequestAccessPanel isHospitalRegistered={isHospitalRegistered} />
          )}

          {/* View Consented Records Tab */}
          {activeTab === "view" && (
            <RecordViewerPanel
              privateKey={privateKey}
              isHospitalRegistered={isHospitalRegistered}
            />
          )}
        </div>
      </div>
    </div>
  );
}

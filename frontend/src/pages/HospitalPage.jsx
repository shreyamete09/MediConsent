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
    <div className="max-w-7xl mx-auto px-4 sm:px-8 py-10 space-y-8">
      {/* Hospital Banner Card (matching screenshot top header) */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start space-x-4">
            <div className="w-14 h-14 rounded-2xl bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-700 flex-shrink-0">
              <Building2 className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-slate-100 text-slate-600 border border-slate-200">
                  NODE: {account ? `${account.slice(0, 8)}...${account.slice(-4)}` : 'Not Connected'}
                </span>
                {isHospitalRegistered !== null && (
                  <span
                    className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                      isHospitalRegistered
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${isHospitalRegistered ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                    <span>{isHospitalRegistered ? "Registered On-Chain" : "Not Registered"}</span>
                  </span>
                )}
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                {hospitalName ? hospitalName : "Clinical Healthcare Provider"}
              </h1>
              <p className="text-xs text-slate-500 font-medium">
                Clinical Cryptographic Gateway • Patient-Controlled Records Access
              </p>
            </div>
          </div>

          {/* Right Security Pill */}
          <div className="flex items-center space-x-2 px-3.5 py-1.5 rounded-full text-xs font-medium bg-slate-50 border border-slate-200 text-slate-700">
            <span className="w-2 h-2 rounded-full bg-teal-600"></span>
            <span>Browser LocalStorage Keystore</span>
          </div>
        </div>

        {/* Real Metrics Row (Rule 2 & 6: Only real data, no mock 142/184ms) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
            <span className="text-xs text-slate-500 block">Registration Authority</span>
            <div className="text-base font-bold text-slate-900 mt-1 flex items-center space-x-1.5">
              <CheckCircle2 className="w-4 h-4 text-teal-600" />
              <span>{isHospitalRegistered ? "Registered On-Chain" : "Pending Registration"}</span>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
            <span className="text-xs text-slate-500 block">Session Uploads</span>
            <div className="text-base font-bold text-slate-900 mt-1 font-mono">
              {recentUploads.length} Confirmed
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
            <span className="text-xs text-slate-500 block">Cryptographic Key</span>
            <div className="text-base font-bold text-slate-900 mt-1 flex items-center space-x-1.5">
              <span className={`w-2 h-2 rounded-full ${publicKeyB64 ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
              <span>{publicKeyB64 ? "RSA-OAEP Active" : "No Key Loaded"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Left Keystore & Uploads, Right Tabs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column (4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          <KeystoreManager
            publicKeyB64={publicKeyB64}
            isLoading={isLoading}
            error={error}
            downloadBackup={downloadBackup}
            importFromFile={importFromFile}
          />

          {/* Recent Uploads */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 space-y-3 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900">Session Uploads</h3>
            {recentUploads.length === 0 ? (
              <div className="rounded-xl p-6 text-center border border-dashed border-slate-200 bg-slate-50/50">
                <Upload className="w-6 h-6 text-slate-400 mx-auto mb-2" />
                <p className="text-xs text-slate-500">No records uploaded this session</p>
              </div>
            ) : (
              <div className="space-y-2">
                {recentUploads.map((r) => (
                  <div key={r.recordId} className="rounded-xl p-3 bg-slate-50 border border-slate-100 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900">Record #{r.recordId}</span>
                      <span className="text-[10px] font-semibold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full border border-teal-200">
                        Confirmed
                      </span>
                    </div>
                    <p className="text-[10px] font-mono text-slate-500 truncate">{r.cid}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column (8 cols) — Tab selector & Panels */}
        <div className="lg:col-span-8 space-y-6">
          {/* Tab Selector Buttons */}
          <div className="flex flex-wrap items-center gap-2 p-1.5 rounded-2xl bg-white border border-slate-200/90 shadow-sm">
            <button
              type="button"
              onClick={() => setActiveTab("upload")}
              className={`flex-1 min-w-[130px] flex items-center justify-center space-x-2 py-2.5 px-3 rounded-xl text-xs font-semibold transition-all ${
                activeTab === "upload"
                  ? "bg-teal-800 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload Record</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("request")}
              className={`flex-1 min-w-[130px] flex items-center justify-center space-x-2 py-2.5 px-3 rounded-xl text-xs font-semibold transition-all ${
                activeTab === "request"
                  ? "bg-teal-800 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              <span>Request Access</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("view")}
              className={`flex-1 min-w-[130px] flex items-center justify-center space-x-2 py-2.5 px-3 rounded-xl text-xs font-semibold transition-all ${
                activeTab === "view"
                  ? "bg-teal-800 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Consented Records</span>
            </button>
          </div>

          {/* Upload Form Tab */}
          {activeTab === "upload" && (
            <div className="bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-8 shadow-sm space-y-5">
              <div className="border-b border-slate-100 pb-4">
                <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
                  <Upload className="w-5 h-5 text-teal-700" />
                  <span>Upload Medical Record</span>
                </h2>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Select a patient address, choose the record category, and pick the file.
                  The file will be encrypted with AES-256-GCM inside your browser before upload.
                  The AES key is wrapped with the patient's RSA-OAEP public key.
                </p>
              </div>

              {isHospitalRegistered === false && (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
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

import React, { useRef, useState } from "react";
import { KeyRound, Download, Upload, AlertTriangle, CheckCircle2, Copy, Check } from "lucide-react";

export default function KeystoreManager({ publicKeyB64, isLoading, error, downloadBackup, importFromFile }) {
  const fileInputRef = useRef(null);
  const [copied, setCopied] = useState(false);

  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (file) importFromFile(file);
    e.target.value = "";
  };

  const handleCopyKey = () => {
    if (!publicKeyB64) return;
    navigator.clipboard.writeText(publicKeyB64);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return (
      <div className="flex items-center space-x-2 text-xs text-slate-500 bg-white p-4 rounded-2xl border border-slate-200">
        <KeyRound className="w-4 h-4 animate-pulse text-teal-600" />
        <span>Generating cryptographic key pair…</span>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 p-5 space-y-4 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="flex items-center space-x-2">
          <KeyRound className="w-4 h-4 text-teal-700" />
          <span className="text-sm font-bold text-slate-900">Cryptographic Identity</span>
        </div>
        {publicKeyB64 ? (
          <span className="flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3" />
            <span>Active</span>
          </span>
        ) : (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            No key loaded
          </span>
        )}
      </div>

      {/* Public Decryption Key spec */}
      <div className="space-y-1.5 font-mono text-xs">
        <div className="flex justify-between items-center text-slate-500 font-sans text-[11px]">
          <span>Algorithm</span>
          <span className="font-semibold text-slate-700">RSA-OAEP 2048</span>
        </div>
        {publicKeyB64 && (
          <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-center justify-between">
            <span className="text-[11px] text-slate-600 truncate mr-2 font-mono">
              {publicKeyB64.slice(0, 32)}…
            </span>
            <button
              type="button"
              onClick={handleCopyKey}
              title="Copy public key"
              className="p-1 hover:bg-slate-200/70 rounded text-slate-400 hover:text-slate-600 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-teal-600" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}
      </div>

      {/* Storage policy note (Rule 3: Honest localStorage description) */}
      <div className="flex items-start space-x-2.5 text-xs text-amber-800 bg-amber-50/80 rounded-xl p-3 border border-amber-200/80">
        <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
        <span className="leading-relaxed text-[11px]">
          <strong>Browser LocalStorage Policy:</strong> Private keys are stored in browser localStorage.
          Download a backup to avoid permanent loss upon cache clearing.
        </span>
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-rose-600 bg-rose-50 p-2 rounded-lg border border-rose-200">{error}</p>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-2 pt-1">
        <button
          type="button"
          onClick={downloadBackup}
          disabled={!publicKeyB64}
          className="flex-1 flex items-center justify-center space-x-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold bg-teal-800 hover:bg-teal-700 text-white shadow-sm disabled:opacity-40 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Download Backup Key</span>
        </button>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex-1 flex items-center justify-center space-x-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200/80 text-slate-700 border border-slate-200 transition-colors"
        >
          <Upload className="w-3.5 h-3.5" />
          <span>Import Key</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleImport}
        />
      </div>
    </div>
  );
}

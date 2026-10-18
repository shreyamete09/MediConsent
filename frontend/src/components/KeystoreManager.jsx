/**
 * @file KeystoreManager.jsx
 * @notice UI widget that shows key status, download backup, and import from file.
 */

import React, { useRef } from "react";
import { KeyRound, Download, Upload, AlertTriangle, CheckCircle2 } from "lucide-react";

export default function KeystoreManager({ publicKeyB64, isLoading, error, downloadBackup, importFromFile }) {
  const fileInputRef = useRef(null);

  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (file) importFromFile(file);
    e.target.value = "";
  };

  if (isLoading) {
    return (
      <div className="flex items-center space-x-2 text-xs text-slate-400">
        <KeyRound className="w-4 h-4 animate-pulse" />
        <span>Generating cryptographic key pair…</span>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-xl p-4 space-y-3 border border-slate-700/50">
      {/* Status row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <KeyRound className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-semibold text-slate-200">RSA-OAEP Identity Key</span>
        </div>
        {publicKeyB64 ? (
          <span className="flex items-center space-x-1 text-[10px] text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Active</span>
          </span>
        ) : (
          <span className="text-[10px] text-amber-400">No key loaded</span>
        )}
      </div>

      {/* Public key preview */}
      {publicKeyB64 && (
        <p className="font-mono text-[9px] text-slate-500 truncate">
          {publicKeyB64.slice(0, 60)}…
        </p>
      )}

      {/* XSS warning */}
      <div className="flex items-start space-x-2 text-[10px] text-amber-400/80 bg-amber-950/30 rounded-lg p-2 border border-amber-500/20">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        <span>
          Private key stored in <strong>localStorage</strong>. Download a backup and store it securely.
          Clearing browser data without a backup makes your records permanently unrecoverable.
        </span>
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-rose-400">{error}</p>
      )}

      {/* Actions */}
      <div className="flex items-center space-x-2">
        <button
          onClick={downloadBackup}
          disabled={!publicKeyB64}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-900/50 text-emerald-300 hover:bg-emerald-900/80 border border-emerald-500/30 disabled:opacity-40 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Download Backup</span>
        </button>

        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 transition-colors"
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

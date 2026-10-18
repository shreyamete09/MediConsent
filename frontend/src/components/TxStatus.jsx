/**
 * @file TxStatus.jsx
 * @notice Reusable transaction status banner.
 * States: idle | encrypting | uploading | confirming | success | error
 */

import React from "react";
import { Loader2, CheckCircle2, XCircle, Lock } from "lucide-react";

export default function TxStatus({ status, message }) {
  if (!status || status === "idle") return null;

  const configs = {
    encrypting: {
      icon: <Lock className="w-4 h-4 animate-pulse text-indigo-300" />,
      bg: "bg-indigo-950/60 border-indigo-500/30",
      text: "text-indigo-200",
    },
    uploading: {
      icon: <Loader2 className="w-4 h-4 animate-spin text-blue-300" />,
      bg: "bg-blue-950/60 border-blue-500/30",
      text: "text-blue-200",
    },
    confirming: {
      icon: <Loader2 className="w-4 h-4 animate-spin text-amber-300" />,
      bg: "bg-amber-950/60 border-amber-500/30",
      text: "text-amber-200",
    },
    success: {
      icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
      bg: "bg-emerald-950/60 border-emerald-500/30",
      text: "text-emerald-200",
    },
    error: {
      icon: <XCircle className="w-4 h-4 text-rose-400" />,
      bg: "bg-rose-950/60 border-rose-500/30",
      text: "text-rose-200",
    },
  };

  const cfg = configs[status] || configs.error;

  return (
    <div className={`flex items-start space-x-3 p-3 rounded-xl border ${cfg.bg} transition-all`}>
      <span className="mt-0.5 flex-shrink-0">{cfg.icon}</span>
      <p className={`text-sm ${cfg.text}`}>{message}</p>
    </div>
  );
}

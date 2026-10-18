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
      icon: <Lock className="w-4 h-4 animate-pulse text-teal-600" />,
      bg: "bg-teal-50 border-teal-200",
      text: "text-teal-800 font-medium",
    },
    uploading: {
      icon: <Loader2 className="w-4 h-4 animate-spin text-sky-600" />,
      bg: "bg-sky-50 border-sky-200",
      text: "text-sky-800 font-medium",
    },
    confirming: {
      icon: <Loader2 className="w-4 h-4 animate-spin text-amber-600" />,
      bg: "bg-amber-50 border-amber-200",
      text: "text-amber-800 font-medium",
    },
    success: {
      icon: <CheckCircle2 className="w-4 h-4 text-emerald-600" />,
      bg: "bg-emerald-50 border-emerald-200",
      text: "text-emerald-800 font-medium",
    },
    error: {
      icon: <XCircle className="w-4 h-4 text-rose-600" />,
      bg: "bg-rose-50 border-rose-200",
      text: "text-rose-800 font-medium",
    },
  };

  const cfg = configs[status] || configs.error;

  return (
    <div className={`flex items-start space-x-3 p-3.5 rounded-xl border ${cfg.bg} transition-all`}>
      <span className="mt-0.5 flex-shrink-0">{cfg.icon}</span>
      <p className={`text-xs sm:text-sm ${cfg.text}`}>{message}</p>
    </div>
  );
}

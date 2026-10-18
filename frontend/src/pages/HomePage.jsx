import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useWeb3 } from '../context/Web3Context';
import {
  ShieldCheck,
  Lock,
  FileKey2,
  Database,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  UserCheck,
  RefreshCw,
} from 'lucide-react';

export default function HomePage() {
  const { account, contract, role, connectWallet, refreshRole } = useWeb3();
  const [isRegistering, setIsRegistering] = useState(false);
  const [regError, setRegError] = useState(null);

  const handleRegisterPatient = async () => {
    if (!contract) return;
    setIsRegistering(true);
    setRegError(null);
    try {
      const tx = await contract.registerPatient();
      await tx.wait();
      await refreshRole();
    } catch (err) {
      console.error('Registration failed:', err);
      setRegError(err.reason || err.message || 'Registration transaction failed');
    } finally {
      setIsRegistering(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-12 space-y-16">
      {/* Hero Section */}
      <div className="text-center space-y-6 max-w-3xl mx-auto">
        <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-500/30">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Patient-Controlled Healthcare Interoperability</span>
        </div>

        <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-white leading-tight">
          Sovereign Medical Records with{' '}
          <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">
            Zero-Knowledge
          </span>{' '}
          Consent
        </h1>

        <p className="text-lg text-slate-400 leading-relaxed">
          Records are encrypted in the browser with AES-256-GCM before upload. The smart
          contract enforces granular, time-bound consent and logs every access attempt to an
          immutable on-chain audit trail.
        </p>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
          {!account ? (
            <button
              onClick={connectWallet}
              className="px-6 py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 shadow-lg shadow-emerald-500/25 transition-all"
            >
              Connect MetaMask Wallet
            </button>
          ) : role === 'Patient' ? (
            <Link
              to="/patient"
              className="flex items-center space-x-2 px-6 py-3 rounded-xl font-semibold text-white bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-500/25 transition-all"
            >
              <span>Go to Patient Portal</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          ) : role === 'Hospital' ? (
            <Link
              to="/hospital"
              className="flex items-center space-x-2 px-6 py-3 rounded-xl font-semibold text-white bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-500/25 transition-all"
            >
              <span>Go to Hospital Portal</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          ) : (
            <div className="space-y-3">
              <button
                onClick={handleRegisterPatient}
                disabled={isRegistering}
                className="flex items-center space-x-2 px-6 py-3 rounded-xl font-semibold text-white bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-500/25 transition-all disabled:opacity-50"
              >
                <UserCheck className="w-5 h-5" />
                <span>{isRegistering ? 'Registering On-Chain...' : 'Register as Patient (1-Click)'}</span>
              </button>
              {regError && <p className="text-xs text-rose-400">{regError}</p>}
            </div>
          )}

          <Link
            to="/audit"
            className="flex items-center space-x-2 px-6 py-3 rounded-xl font-medium text-slate-300 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 hover:text-white transition-all"
          >
            <span>Explore Audit Trail</span>
          </Link>
        </div>
      </div>

      {/* Zero-Knowledge Architectural Pillars */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="glass-card p-6 rounded-2xl space-y-3 border-emerald-500/20 hover:border-emerald-500/40 transition-all">
          <div className="w-12 h-12 rounded-xl bg-emerald-950/80 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Lock className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-white">Client-Side AES-256</h3>
          <p className="text-sm text-slate-400 leading-relaxed">
            Files are encrypted in memory with a fresh 96-bit random IV before leaving your
            browser. Plaintext never touches a server.
          </p>
        </div>

        <div className="glass-card p-6 rounded-2xl space-y-3 border-indigo-500/20 hover:border-indigo-500/40 transition-all">
          <div className="w-12 h-12 rounded-xl bg-indigo-950/80 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <FileKey2 className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-white">RSA-OAEP Envelopes</h3>
          <p className="text-sm text-slate-400 leading-relaxed">
            The AES key is wrapped with the authorized hospital's public key (retrieved from the
            contract registry). Only that hospital can decrypt.
          </p>
        </div>

        <div className="glass-card p-6 rounded-2xl space-y-3 border-purple-500/20 hover:border-purple-500/40 transition-all">
          <div className="w-12 h-12 rounded-xl bg-purple-950/80 border border-purple-500/30 flex items-center justify-center text-purple-400">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-white">Smart Contract Gate</h3>
          <p className="text-sm text-slate-400 leading-relaxed">
            MediConsent.sol enforces granular time-limits and O(1) blanket revocation. No medical
            data is ever stored on-chain.
          </p>
        </div>

        <div className="glass-card p-6 rounded-2xl space-y-3 border-teal-500/20 hover:border-teal-500/40 transition-all">
          <div className="w-12 h-12 rounded-xl bg-teal-950/80 border border-teal-500/30 flex items-center justify-center text-teal-400">
            <Database className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-white">IPFS & Audit Trail</h3>
          <p className="text-sm text-slate-400 leading-relaxed">
            Ciphertext is pinned to IPFS. Every access emits an immutable on-chain event
            providing a tamper-proof HIPAA log.
          </p>
        </div>
      </div>

      {/* Role & Keystore Status Box */}
      <div className="glass-panel p-6 rounded-2xl border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white flex items-center space-x-2">
            <span>Client Cryptographic Engine Status</span>
          </h2>
          <span className="flex items-center space-x-1.5 text-xs text-emerald-400 font-mono">
            <CheckCircle2 className="w-4 h-4" />
            <span>WebCrypto API Active</span>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono">
          <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-500 block">Connected Account</span>
            <span className="text-slate-200 truncate block mt-1">
              {account || 'Wallet not connected'}
            </span>
          </div>
          <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-500 block">On-Chain Role</span>
            <span className="text-emerald-400 font-bold block mt-1">{role}</span>
          </div>
          <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-500 block">Encryption Standard</span>
            <span className="text-slate-200 block mt-1">AES-256-GCM + RSA-OAEP 2048</span>
          </div>
        </div>
      </div>
    </div>
  );
}

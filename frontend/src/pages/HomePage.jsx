import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useWeb3 } from '../context/Web3Context';
import { useContractEvents } from '../hooks/useContractEvents';
import {
  ShieldCheck,
  Lock,
  Key,
  Database,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  UserCheck,
  FileText,
  Building2,
  User,
  Activity,
  Layers,
  Check,
  ExternalLink,
} from 'lucide-react';

export default function HomePage() {
  const { account, chainId, contract, role, connectWallet, refreshRole } = useWeb3();
  const [isRegistering, setIsRegistering] = useState(false);
  const [regError, setRegError] = useState(null);

  // Real contract events for live stats (Rule 2 & 6)
  const { events: grantedEvents } = useContractEvents(contract, 'ConsentGranted');
  const { events: revokedEvents } = useContractEvents(contract, 'ConsentRevoked');
  const { events: requestedEvents } = useContractEvents(contract, 'AccessRequested');

  const truncate = (addr) => (addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '');

  const getNetworkName = (id) => {
    if (id === 31337) return 'Hardhat Local';
    if (id === 80002) return 'Polygon Amoy';
    if (id === 11155111) return 'Ethereum Sepolia';
    if (id) return `Chain: ${id}`;
    return 'Local Network';
  };

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
    <div className="max-w-7xl mx-auto px-4 sm:px-8 py-10 space-y-20">
      {/* Hero Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
        {/* Left Column: Hero Text & Actions */}
        <div className="lg:col-span-7 space-y-6">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-semibold bg-teal-50 text-teal-800 border border-teal-200">
            <span className="w-2 h-2 rounded-full bg-teal-600 animate-pulse"></span>
            <span>CLIENT-SIDE ENCRYPTED PROTOCOL • AES-256-GCM</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 leading-[1.12]">
            Patient-controlled{' '}
            <span className="text-teal-700">medical records</span>
          </h1>

          <p className="text-base sm:text-lg text-slate-600 leading-relaxed max-w-xl">
            Empowering patients with decentralized cryptographic envelopes, real-time smart
            contract consent management, and client-side privacy for medical sharing.
          </p>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            {!account ? (
              <button
                type="button"
                onClick={connectWallet}
                className="flex items-center space-x-2 px-6 py-3 rounded-full font-semibold text-white bg-teal-800 hover:bg-teal-700 shadow-sm transition-all"
              >
                <span>Connect Wallet</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : role === 'Patient' ? (
              <Link
                to="/patient"
                className="flex items-center space-x-2 px-6 py-3 rounded-full font-semibold text-white bg-teal-800 hover:bg-teal-700 shadow-sm transition-all"
              >
                <span>Launch Patient Vault</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            ) : role === 'Hospital' ? (
              <Link
                to="/hospital"
                className="flex items-center space-x-2 px-6 py-3 rounded-full font-semibold text-white bg-teal-800 hover:bg-teal-700 shadow-sm transition-all"
              >
                <span>Go to Hospital Portal</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            ) : (
              <button
                type="button"
                onClick={handleRegisterPatient}
                disabled={isRegistering}
                className="flex items-center space-x-2 px-6 py-3 rounded-full font-semibold text-white bg-teal-800 hover:bg-teal-700 shadow-sm transition-all disabled:opacity-50"
              >
                <UserCheck className="w-4 h-4" />
                <span>{isRegistering ? 'Registering On-Chain...' : 'Register as Patient (1-Click)'}</span>
              </button>
            )}

            <Link
              to="/audit"
              className="flex items-center space-x-2 px-6 py-3 rounded-full font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200/90 shadow-sm transition-all"
            >
              <FileText className="w-4 h-4 text-teal-700" />
              <span>Explore Audit Trail</span>
            </Link>
          </div>

          {regError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
              {regError}
            </div>
          )}

          {/* Three Feature Badges */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-2 text-xs font-medium text-slate-600">
            <span className="flex items-center space-x-1.5">
              <Check className="w-4 h-4 text-teal-600" />
              <span>100% Client-Side Encryption</span>
            </span>
            <span className="flex items-center space-x-1.5">
              <Check className="w-4 h-4 text-teal-600" />
              <span>Smart-Contract Consent</span>
            </span>
            <span className="flex items-center space-x-1.5">
              <Check className="w-4 h-4 text-teal-600" />
              <span>Instant Consent Revocation</span>
            </span>
          </div>
        </div>

        {/* Right Column: Live Cryptographic Spec Card */}
        <div className="lg:col-span-5">
          <div className="bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-7 shadow-sm space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-700">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Cryptographic State</h3>
                  <p className="text-xs text-slate-500">Live Client & On-Chain Engine</p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                {account ? 'CONNECTED' : 'STANDBY'}
              </span>
            </div>

            <div className="space-y-3 font-mono text-xs">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-center justify-between">
                <span className="text-slate-500 font-sans">Active Identity:</span>
                <span className="text-slate-900 font-semibold">
                  {account ? truncate(account) : 'Not Connected'}
                </span>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-center justify-between">
                <span className="text-slate-500 font-sans">On-Chain Role:</span>
                <span className="text-teal-700 font-bold">
                  {role}
                </span>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-center justify-between">
                <span className="text-slate-500 font-sans">Target Network:</span>
                <span className="text-slate-800">
                  {getNetworkName(chainId)}
                </span>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-center justify-between">
                <span className="text-slate-500 font-sans">Symmetric Cipher:</span>
                <span className="text-slate-800">AES-256-GCM (WebCrypto)</span>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-center justify-between">
                <span className="text-slate-500 font-sans">Key Envelopes:</span>
                <span className="text-slate-800">RSA-OAEP 2048</span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-teal-50/70 border border-teal-100 text-xs text-teal-900 flex items-center space-x-2">
              <Lock className="w-4 h-4 text-teal-700 flex-shrink-0" />
              <span>Private key stays in browser localStorage • Local decryption only</span>
            </div>
          </div>
        </div>
      </div>

      {/* Protocol in Action: End-to-End Cryptographic Flow */}
      <div className="space-y-8">
        <div className="text-center space-y-2 max-w-2xl mx-auto">
          <span className="text-xs font-semibold tracking-wider text-teal-700 uppercase">
            Protocol in Action
          </span>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">
            End-to-End Cryptographic Flow
          </h2>
          <p className="text-sm sm:text-base text-slate-600">
            Inspect how data travels safely from client-side encrypted storage through Ethereum
            smart contracts without exposing PHI.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Step 1 */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-sm flex flex-col justify-between space-y-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-700">
                  <User className="w-5 h-5" />
                </div>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-slate-100 text-slate-600">
                  Step 01: Client
                </span>
              </div>
              <h3 className="text-lg font-bold text-slate-900">Patient Local Vault</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Records are split into encrypted chunks using symmetric AES-256-GCM. SHA-256
                digest is generated for smart contract integrity.
              </p>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1.5 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-500 font-sans">Payload State:</span>
                  <span className="text-teal-700 font-semibold">Ciphertext (GCM)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-sans">Storage:</span>
                  <span className="text-slate-700">Encrypted storage CID</span>
                </div>
              </div>
            </div>
            <div className="pt-2 border-t border-slate-100 text-[11px] text-teal-800 flex items-center space-x-1.5 font-medium">
              <Lock className="w-3.5 h-3.5 text-teal-600" />
              <span>Private key stays in browser localStorage</span>
            </div>
          </div>

          {/* Step 2 */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-sm flex flex-col justify-between space-y-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 rounded-xl bg-sky-50 border border-sky-100 flex items-center justify-center text-sky-700">
                  <Layers className="w-5 h-5" />
                </div>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-slate-100 text-slate-600">
                  Step 02: Ledger
                </span>
              </div>
              <h3 className="text-lg font-bold text-slate-900">Smart Contract Engine</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Evaluates requester credentials, checks cryptographic signature hashes, and verifies
                access boundaries against the on-chain registry.
              </p>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1.5 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-500 font-sans">Consent Status:</span>
                  <span className="text-emerald-700 font-semibold">Time-Bound & Active</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-sans">Enforcement:</span>
                  <span className="text-slate-700">On-Chain Access Gate</span>
                </div>
              </div>
            </div>
            <div className="pt-2 border-t border-slate-100 text-[11px] text-teal-800 flex items-center space-x-1.5 font-medium">
              <ShieldCheck className="w-3.5 h-3.5 text-teal-600" />
              <span>Automated cryptographic enforcement</span>
            </div>
          </div>

          {/* Step 3 */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-sm flex flex-col justify-between space-y-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-700">
                  <Building2 className="w-5 h-5" />
                </div>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-slate-100 text-slate-600">
                  Step 03: Provider
                </span>
              </div>
              <h3 className="text-lg font-bold text-slate-900">Hospital Node</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Upon verified contract permission, the hospital's private key unwraps the RSA-OAEP
                envelope key to decrypt records in local memory.
              </p>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1.5 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-500 font-sans">Memory Buffer:</span>
                  <span className="text-teal-700 font-semibold">Encrypted in Transit</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-sans">Decryption:</span>
                  <span className="text-slate-700">Browser WebCrypto Only</span>
                </div>
              </div>
            </div>
            <div className="pt-2 border-t border-slate-100 text-[11px] text-teal-800 flex items-center space-x-1.5 font-medium">
              <Lock className="w-3.5 h-3.5 text-teal-600" />
              <span>Zero plaintext exposure to cloud providers</span>
            </div>
          </div>
        </div>
      </div>

      {/* Real On-Chain Metrics (Only real data, Rule 2 & 6) */}
      {contract && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-sm">
            <span className="text-xs font-medium text-slate-500 block">Total Consents Granted</span>
            <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">
              {grantedEvents.length}
            </div>
            <span className="text-[11px] text-teal-700 font-medium block mt-1">
              On-chain consent events
            </span>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-sm">
            <span className="text-xs font-medium text-slate-500 block">Access Requests</span>
            <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">
              {requestedEvents.length}
            </div>
            <span className="text-[11px] text-sky-700 font-medium block mt-1">
              Inbound hospital requests
            </span>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-sm">
            <span className="text-xs font-medium text-slate-500 block">Consent Revocations</span>
            <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">
              {revokedEvents.length}
            </div>
            <span className="text-[11px] text-rose-600 font-medium block mt-1">
              Instant revocation events
            </span>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-sm">
            <span className="text-xs font-medium text-slate-500 block">Connected Network</span>
            <div className="text-2xl font-bold text-slate-900 mt-1">
              {getNetworkName(chainId)}
            </div>
            <span className="text-[11px] text-emerald-700 font-medium block mt-1">
              Consensus verified
            </span>
          </div>
        </div>
      )}

      {/* Architectural Pillars: Cryptographic Architecture for Sensitive Health Data */}
      <div className="space-y-8">
        <div className="text-center space-y-2 max-w-2xl mx-auto">
          <span className="text-xs font-semibold tracking-wider text-teal-700 uppercase">
            Architected for True Sovereignty
          </span>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">
            Zero-Trust Architecture for Sensitive Health Data
          </h2>
          <p className="text-sm sm:text-base text-slate-600">
            By shifting data authority entirely to cryptographic keys held by patients,
            MediConsent renders legacy health leaks structurally impossible.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 1 */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-6 sm:p-7 shadow-sm space-y-4">
            <div className="w-11 h-11 rounded-2xl bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-700">
              <Lock className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Client-side Encryption</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              All records are encrypted on the patient device before upload using AES-256-GCM.
              Unencrypted medical data never touches external servers, cloud databases, or relay nodes.
            </p>
            <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-mono bg-teal-50 text-teal-800 border border-teal-200">
              <span>Cipher: AES-GCM-256-TAG</span>
              <Check className="w-3.5 h-3.5 text-teal-600" />
            </div>
          </div>

          {/* Card 2 */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-6 sm:p-7 shadow-sm space-y-4">
            <div className="w-11 h-11 rounded-2xl bg-sky-50 border border-sky-100 flex items-center justify-center text-sky-700">
              <Key className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">RSA-OAEP Key Envelopes</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Cryptographic asymmetric key derivation with ephemeral session keys for hospital access,
              wrapped securely for authorized provider addresses only.
            </p>
            <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-mono bg-sky-50 text-sky-800 border border-sky-200">
              <span>Key Wrap: RSA-OAEP 2048</span>
              <Check className="w-3.5 h-3.5 text-sky-600" />
            </div>
          </div>

          {/* Card 3 */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-6 sm:p-7 shadow-sm space-y-4">
            <div className="w-11 h-11 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-700">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Smart-Contract Consent</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Granular time-bound consent policies enforced on-chain. Patients control exactly who,
              what category, and for how long providers can decrypt records.
            </p>
            <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-mono bg-emerald-50 text-emerald-800 border border-emerald-200">
              <span>Policy: On-Chain Time-Lock & Category</span>
              <Check className="w-3.5 h-3.5 text-emerald-600" />
            </div>
          </div>

          {/* Card 4 */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-6 sm:p-7 shadow-sm space-y-4">
            <div className="w-11 h-11 rounded-2xl bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-700">
              <Database className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">On-Chain Audit Trail</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Every access request, approval, decryption event, and revocation is permanently
              timestamped on-chain with verifiable cryptographic hashes.
            </p>
            <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-mono bg-teal-50 text-teal-800 border border-teal-200">
              <span>Integrity: Contract Event Logs</span>
              <Check className="w-3.5 h-3.5 text-teal-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Call To Action Banner */}
      <div className="bg-teal-900 text-white rounded-3xl p-8 sm:p-12 shadow-sm relative overflow-hidden">
        <div className="max-w-2xl space-y-4 relative z-10">
          <span className="text-xs font-semibold tracking-wider text-teal-300 uppercase">
            Built for Health Sovereignty
          </span>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Ready to reclaim authority over your clinical history?
          </h2>
          <p className="text-sm sm:text-base text-teal-100/90 leading-relaxed">
            Connect your Web3 identity to establish your personal health safe. Grant instant
            temporary access to emergency doctors without risking permanent data.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-3">
            <Link
              to="/patient"
              className="px-6 py-3 rounded-full font-semibold text-teal-950 bg-white hover:bg-teal-50 shadow-sm transition-all text-sm"
            >
              Launch Patient Vault
            </Link>
            <Link
              to="/hospital"
              className="px-6 py-3 rounded-full font-medium text-white border border-teal-700 hover:bg-teal-800/80 transition-all text-sm"
            >
              Hospital Verification
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

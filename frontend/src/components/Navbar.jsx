import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useWeb3 } from '../context/Web3Context';
import { Shield, Key, Copy, Check } from 'lucide-react';

export default function Navbar() {
  const { account, chainId, role, isConnecting, connectWallet, disconnectWallet } = useWeb3();
  const location = useLocation();
  const [copied, setCopied] = useState(false);

  const truncate = (addr) => (addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '');

  const handleCopy = (e) => {
    e.stopPropagation();
    if (!account) return;
    navigator.clipboard.writeText(account);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getRoleLabel = (currentRole) => {
    switch (currentRole) {
      case 'Patient':
        return 'Patient';
      case 'Hospital':
        return 'Hospital (Registered)';
      case 'Admin':
        return 'Admin';
      default:
        return 'Unregistered';
    }
  };

  const getRoleStyle = (currentRole) => {
    switch (currentRole) {
      case 'Patient':
        return 'bg-sky-50 text-sky-700 border-sky-200';
      case 'Hospital':
        return 'bg-teal-50 text-teal-700 border-teal-200';
      case 'Admin':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      default:
        return 'bg-amber-50 text-amber-700 border-amber-200';
    }
  };

  const getNetworkName = (id) => {
    if (id === 31337) return 'Hardhat Local';
    if (id === 80002) return 'Polygon Amoy';
    if (id === 11155111) return 'Ethereum Sepolia';
    if (id) return `Chain: ${id}`;
    return 'Local Network';
  };

  const navLinks = [
    { name: 'Home', path: '/' },
    { name: 'Patient Portal', path: '/patient' },
    { name: 'Hospital Portal', path: '/hospital' },
    { name: 'Audit Trail', path: '/audit' },
  ];

  return (
    <nav className="bg-white/95 backdrop-blur-md sticky top-0 z-50 border-b border-slate-200/90 px-4 sm:px-8 py-3">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-y-3 gap-x-4">
        {/* Brand & Network Pill */}
        <div className="flex items-center space-x-3">
          <Link to="/" className="flex items-center space-x-2.5 group">
            <div className="w-9 h-9 rounded-xl bg-teal-800 flex items-center justify-center text-white shadow-sm group-hover:bg-teal-700 transition-colors">
              <Shield className="w-5 h-5 fill-teal-100 text-teal-800" />
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-900">
              MediConsent
            </span>
          </Link>
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-slate-100 text-slate-600 border border-slate-200">
            {getNetworkName(chainId)}
          </span>
        </div>

        {/* Navigation Links */}
        <div className="flex items-center space-x-1 order-3 sm:order-2 w-full sm:w-auto justify-center sm:justify-start">
          {navLinks.map((link) => {
            const isActive = location.pathname === link.path;
            return (
              <Link
                key={link.path}
                to={link.path}
                className={`px-4 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-teal-800 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                {link.name}
              </Link>
            );
          })}
        </div>

        {/* Web3 & Role Status */}
        <div className="flex flex-wrap items-center gap-2 order-2 sm:order-3">
          {account ? (
            <>
              {/* Real Role Badge */}
              <div
                className={`flex items-center px-3 py-1 rounded-full text-xs font-medium border ${getRoleStyle(
                  role
                )}`}
              >
                <span>{getRoleLabel(role)}</span>
              </div>

              {/* Real Address Pill with Copy Button */}
              <button
                type="button"
                onClick={handleCopy}
                title="Click to copy address"
                className="flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-mono bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 transition-colors"
              >
                <span>{truncate(account)}</span>
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-teal-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                )}
              </button>

              {/* Connected Account & Disconnect Button */}
              <button
                type="button"
                onClick={disconnectWallet}
                title="Click to disconnect wallet"
                className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium bg-teal-800 hover:bg-teal-700 text-white shadow-sm transition-colors"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span>Connected: MetaMask</span>
              </button>
            </>
          ) : (
            <button
              onClick={connectWallet}
              disabled={isConnecting}
              className="flex items-center space-x-2 px-5 py-2 rounded-full font-medium text-xs sm:text-sm bg-teal-800 hover:bg-teal-700 text-white shadow-sm transition-all disabled:opacity-50"
            >
              <Key className="w-4 h-4" />
              <span>{isConnecting ? 'Connecting...' : 'Connect Wallet'}</span>
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}

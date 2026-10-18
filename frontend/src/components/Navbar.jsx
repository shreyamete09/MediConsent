import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useWeb3 } from '../context/Web3Context';
import { Shield, Activity, User, Building2, Key, ExternalLink } from 'lucide-react';

export default function Navbar() {
  const { account, chainId, role, isConnecting, connectWallet, disconnectWallet } = useWeb3();
  const location = useLocation();

  const truncate = (addr) => (addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '');

  const getRoleBadge = (currentRole) => {
    switch (currentRole) {
      case 'Admin':
        return 'bg-purple-900/60 text-purple-300 border-purple-500/40';
      case 'Hospital':
        return 'bg-blue-900/60 text-blue-300 border-blue-500/40';
      case 'Patient':
        return 'bg-emerald-900/60 text-emerald-300 border-emerald-500/40';
      default:
        return 'bg-amber-900/60 text-amber-300 border-amber-500/40';
    }
  };

  const navLinks = [
    { name: 'Home', path: '/' },
    { name: 'Patient Portal', path: '/patient' },
    { name: 'Hospital Portal', path: '/hospital' },
    { name: 'Audit Trail', path: '/audit' },
  ];

  return (
    <nav className="glass-panel sticky top-0 z-50 border-b border-slate-800/80 px-6 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Brand */}
        <Link to="/" className="flex items-center space-x-3 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20 group-hover:scale-105 transition-transform">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
              MediConsent
            </span>
            <span className="block text-[10px] text-emerald-400 font-mono tracking-wider uppercase">
              Zero-Knowledge PHI
            </span>
          </div>
        </Link>

        {/* Navigation Links */}
        <div className="hidden md:flex items-center space-x-1">
          {navLinks.map((link) => {
            const isActive = location.pathname === link.path;
            return (
              <Link
                key={link.path}
                to={link.path}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-slate-800 text-emerald-400 shadow-sm border border-slate-700/60'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/40'
                }`}
              >
                {link.name}
              </Link>
            );
          })}
        </div>

        {/* Web3 & Role Status */}
        <div className="flex items-center space-x-3">
          {account ? (
            <>
              {/* Network Badge */}
              <div className="hidden sm:flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-mono bg-slate-900 border border-slate-700 text-slate-300">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>{chainId === 31337 ? 'Hardhat' : chainId === 80002 ? 'Amoy' : `Chain: ${chainId}`}</span>
              </div>

              {/* Role Badge */}
              <div
                className={`flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${getRoleBadge(
                  role
                )}`}
              >
                {role === 'Hospital' ? (
                  <Building2 className="w-3.5 h-3.5" />
                ) : (
                  <User className="w-3.5 h-3.5" />
                )}
                <span>{role}</span>
              </div>

              {/* Connected Account & Disconnect */}
              <button
                onClick={disconnectWallet}
                title="Click to disconnect"
                className="px-3.5 py-1.5 rounded-lg text-xs font-mono font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:border-rose-500/50 hover:text-rose-300 transition-colors"
              >
                {truncate(account)}
              </button>
            </>
          ) : (
            <button
              onClick={connectWallet}
              disabled={isConnecting}
              className="flex items-center space-x-2 px-5 py-2 rounded-lg font-medium text-sm bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 transition-all disabled:opacity-50"
            >
              <Key className="w-4 h-4" />
              <span>{isConnecting ? 'Connecting...' : 'Connect MetaMask'}</span>
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}

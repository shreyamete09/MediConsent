import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Web3Provider } from './context/Web3Context';
import Navbar from './components/Navbar';
import HomePage from './pages/HomePage';
import PatientPage from './pages/PatientPage';
import HospitalPage from './pages/HospitalPage';
import AuditPage from './pages/AuditPage';
import { Shield, Lock, Key, FileCheck, History } from 'lucide-react';

export default function App() {
  return (
    <Web3Provider>
      <BrowserRouter>
        <div className="min-h-screen bg-[#f8fafc] text-slate-900 flex flex-col justify-between">
          <div>
            <Navbar />
            <main>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/patient" element={<PatientPage />} />
                <Route path="/hospital" element={<HospitalPage />} />
                <Route path="/audit" element={<AuditPage />} />
              </Routes>
            </main>
          </div>

          <footer className="border-t border-slate-200/90 bg-white py-5 px-4 sm:px-8 mt-16">
            <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
              <div className="flex items-center space-x-2">
                <div className="w-5 h-5 rounded-md bg-teal-800 flex items-center justify-center text-white">
                  <Shield className="w-3 h-3 fill-teal-100 text-teal-800" />
                </div>
                <span>
                  © 2026 MediConsent Protocol. Patient-Centric Cryptographic Governance.
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-[11px] font-medium text-slate-600">
                <span className="flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-teal-600" />
                  Client-side AES-256-GCM
                </span>
                <span className="flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-teal-600" />
                  RSA-OAEP Key Envelopes
                </span>
                <span className="flex items-center gap-1.5">
                  <FileCheck className="w-3.5 h-3.5 text-teal-600" />
                  Smart-Contract Consent
                </span>
                <span className="flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-teal-600" />
                  On-Chain Audit Trail
                </span>
              </div>
            </div>
          </footer>
        </div>
      </BrowserRouter>
    </Web3Provider>
  );
}

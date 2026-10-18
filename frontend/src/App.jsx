import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Web3Provider } from './context/Web3Context';
import Navbar from './components/Navbar';
import HomePage from './pages/HomePage';
import PatientPage from './pages/PatientPage';
import HospitalPage from './pages/HospitalPage';
import AuditPage from './pages/AuditPage';

export default function App() {
  return (
    <Web3Provider>
      <BrowserRouter>
        <div className="min-h-screen bg-slate-950 flex flex-col justify-between">
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

          <footer className="border-t border-slate-900 py-6 px-6 text-center text-xs text-slate-500 font-mono">
            MediConsent — Zero-Knowledge Patient-Controlled Medical Record Exchange. Built for Hackathons & Interviews.
          </footer>
        </div>
      </BrowserRouter>
    </Web3Provider>
  );
}

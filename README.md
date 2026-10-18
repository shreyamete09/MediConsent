# MediConsent — Decentralized, Patient-Controlled Medical Record Sharing

MediConsent is a patient-centric, zero-knowledge medical record exchange platform built for healthcare interoperability. Hospitals share electronic health records (EHR) strictly upon explicit, granular, and time-limited patient consent, backed by an immutable on-chain audit trail.

---

## Key Non-Negotiable Rules & Security Guarantees

1. **No Medical Data On-Chain**: The smart contract stores only record hashes, IPFS content identifiers (CIDs), and consent states. Protected Health Information (PHI) never touches the blockchain.
2. **Client-Side Encryption (AES-256-GCM)**: All files are encrypted in the browser prior to transmission with fresh random 96-bit IVs.
3. **Public-Key Envelope Encryption (RSA-OAEP)**: The symmetric AES key is wrapped with the authorized hospital's public key (fetched from the on-chain registry). Only the intended hospital can unwrap the AES key and decrypt the record.
4. **Zero-Knowledge Backend Relay**: The Node/Express relay never sees plaintext medical records or private keys. It acts strictly as an untrusted blind storage pipeline.
5. **On-Chain Hospital Public Key Registry**: Hospital public keys are immutably stored in the `MediConsent` smart contract (`hospitals[address].rsaPublicKey`) upon admin registration, preventing key-substitution / MITM attacks.
6. **Local Storage Fallback (`QmLocal...`)**:
   > **Note on Mock CIDs**: During local development without active Pinata IPFS credentials, the server generates mock CIDs prefixed with `QmLocal...` (e.g. `QmLocal5a8f90...`). These are deterministic SHA-256 content hashes stored on local disk, **not real IPFS distributed network hashes**. In production mode with `PINATA_JWT`, real IPFS CIDv0/CIDv1 identifiers are generated.

---

## Patient Cryptographic Identity, Key Storage & Backup

### 1. Generation
- When a patient first connects their wallet, their browser generates a 2048-bit **RSA-OAEP** key pair using the hardware-accelerated W3C **Web Crypto API** (`crypto.subtle`).

### 2. Browser Storage
- In development/demo mode, the private key is maintained in secure client-side storage (IndexedDB / session keystore).

### 3. Key Backup & Export
- The patient can export their cryptographic identity as a password-protected JSON Keyfile (`mediconsent-patient-keystore.json`) to import onto other devices.

> [!CAUTION]
> ### CRITICAL WARNING: PERMANENT DATA LOSS RISK
> In a true zero-knowledge cryptographic architecture, **there is NO server-side password reset or master recovery key**. 
> If a patient loses their private key (e.g., clears browser data without downloading their JSON backup), **all previously encrypted medical records are permanently indecipherable**. Neither the hospital, the server administrator, nor the smart contract developers can recover the data.

---

## Architectural Limitations (For Interviews & Evaluations)

> [!IMPORTANT]
> ### LIMITATION OF CRYPTOGRAPHIC REVOCATION
> On-chain revocation (`revokeConsent`) instantly blocks future key envelope downloads and invalidates smart contract access checks in \(O(1)\) gas. 
> However, **revocation cannot mathematically erase or recall a medical record that an authorized hospital has ALREADY downloaded and decrypted to their local machine prior to revocation**. Once bytes are decrypted in memory, the hospital has possessed that historical snapshot. Revocation strictly prevents access to future records or renewed access after expiration.

---

## Quick Start

### 1. Smart Contract (Hardhat)
```bash
npm install
npm test            # Run 28 passing unit tests (100% lines & statements)
npm run coverage    # Generate code coverage report
npm run deploy:local
```

### 2. Backend Relay (Node + Express)
```bash
cd backend
npm install
npm run dev         # Starts relay server on port 5001
```

### 3. Frontend App (React + Vite + Tailwind)
```bash
cd frontend
npm install
npm run dev         # Starts frontend on port 5173
```

---

## Synthetic Demo Data Disclosure

> **ALL DATA IS SYNTHETIC AND ARTIFICIAL**:  
> All patient names, hospital identifiers, clinical summaries, and laboratory indices provided in `/docs/sample-data` and seeded via `npm run seed:local` are **100% synthetic mock data** created strictly for hackathon evaluation and demonstration. No real Protected Health Information (PHI) or real individuals' data is contained in this repository.

See [`docs/DEMO.md`](docs/DEMO.md) for the 3-minute live demonstration script.

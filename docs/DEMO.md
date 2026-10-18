# MediConsent — 3-Minute Live Demonstration Script

> **SYNTHETIC DATA DISCLOSURE:**  
> All patient names, hospital identifiers, clinical summaries, and laboratory indices used in this demonstration are **100% synthetic mock data** generated strictly for hackathon evaluation. No real patient or Protected Health Information (PHI) is contained in this repository.

---

## 1. Restart From Scratch & Setup Sequence

When restarting from scratch (or switching to a brand new Hardhat node), follow this **exact execution order**:

```powershell
# ─────────────────────────────────────────────────────────────────────────────
# Step 1: Start a fresh local Ethereum node (Terminal 1)
# ─────────────────────────────────────────────────────────────────────────────
npx hardhat node

# ─────────────────────────────────────────────────────────────────────────────
# Step 2: Deploy smart contract to the local network (Terminal 2)
# ─────────────────────────────────────────────────────────────────────────────
npm run deploy:local
# NOTE: deploy.js automatically updates:
#   1. backend/.env -> CONTRACT_ADDRESS=0x...
#   2. frontend/src/contracts/addresses.js -> DEFAULT_CONTRACT_ADDRESS="0x..."
#   3. frontend/src/contracts/MediConsentAbi.json -> latest ABI
# No manual file copying or address pasting is required!

# ─────────────────────────────────────────────────────────────────────────────
# Step 3: Run automated seed pipeline (Terminal 2)
# ─────────────────────────────────────────────────────────────────────────────
npm run seed:local
# This registers Hospitals A & B and Patient Alice on-chain, generates RSA
# key pairs, uploads records #1 through #5 (including #3 Cardiology),
# stores envelopes for Hospital A, and creates demo consent states.

# ─────────────────────────────────────────────────────────────────────────────
# Step 4: Start zero-knowledge backend storage relay (Terminal 3)
# ─────────────────────────────────────────────────────────────────────────────
cd backend; npm run dev

# ─────────────────────────────────────────────────────────────────────────────
# Step 5: Start React + Vite frontend application (Terminal 4)
# ─────────────────────────────────────────────────────────────────────────────
cd frontend; npm run dev
```

Open `http://localhost:5173` in Google Chrome with MetaMask connected to `Localhost 8545` (Chain ID `31337`).

---

## 2. Demo Accounts & Keystore Setup

The seed script generates fresh cryptographic RSA-OAEP key pairs for the demo accounts and writes browser-compatible backup files to `docs/sample-data/keystores/` (ignored by git).

| Role | Hardhat Account | Wallet Address | Demo Keystore File |
| :--- | :--- | :--- | :--- |
| **Admin** | Account #0 | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | — |
| **Hospital A** | Account #1 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | `docs/sample-data/keystores/mediconsent-keystore-0x709979.json` |
| **Patient Alice** | Account #2 | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | `docs/sample-data/keystores/mediconsent-keystore-0x3c44cd.json` |
| **Hospital B** | Account #3 | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` | `docs/sample-data/keystores/mediconsent-keystore-0x90f79b.json` |

> **Importing Keys in Browser**:  
> In MetaMask, switch to the respective account, visit the portal, and click **"Import Key"** in the **Cryptographic Identity** panel. Select the matching `.json` file from `docs/sample-data/keystores/`.

---

## 3. Demonstration Walkthrough (3 Minutes)

### Part 1: Happy Path — Authorized Record Viewing (1 Minute)

1. **Connect as Hospital A**:
   - In MetaMask, switch to **Account #1** (`0x70997970C51812dc3A010C7d01b50e0d17dc79C8`).
   - Navigate to `http://localhost:5173/hospital`.
   - Click **"Import Key"** and select `docs/sample-data/keystores/mediconsent-keystore-0x709979.json`.
2. **Open Consented Records**:
   - Click the **"Consented Records"** tab.
   - Notice **Record #1 (General - Prescription)** and **Record #4 (Pathology - Blood Test)** have badge: 🟢 **Active Consent**.
3. **Verify `logAccess` Invariant**:
   - Click **"View Record (Log & Decrypt)"** on Record #1.
   - MetaMask prompts for `logAccess` on-chain.
   - *Test rejection*: Click **Reject** in MetaMask -> observe the modal immediately stops with an error message: *"Access Denied: On-chain access log was rejected... No data was fetched or decrypted"*.
   - Click **"View Record"** again and **Confirm** in MetaMask.
4. **Observe Cryptographic Handshake**:
   - Watch the 6-step progress banner:
     1. `⛓ [Step 1/6] Logging access on-chain (logAccess)… Confirmed`
     2. `🔒 [Step 2/6] Fetching hospital key envelope…`
     3. `⬇ [Step 3/6] Fetching encrypted ciphertext from storage relay…`
     4. `🔒 [Step 4/6] Unwrapping AES key with hospital private key…`
     5. `🔒 [Step 5/6] Decrypting file with AES-256-GCM (auth tag verified)…`
     6. `🔍 [Step 6/6] Recomputing SHA-256 hash & verifying against blockchain…`
   - **Result**:
     - 🟢 **"Verified: hash matches blockchain"** badge.
     - Interactive PDF preview rendered directly in the browser with **"Download Decrypted Medical Record"** button.

---

### Part 2: Double Tamper-Detection Architecture (45 Seconds)

MediConsent provides **two independent layers of tamper protection** to defend against both off-chain storage corruption and malicious record substitution. Both cases display a prominent red **TAMPERED** warning and **strictly block file display**.

#### Case (a): Storage Tampering (AES-256-GCM Auth Tag Failure)
*What it tests*: Bit-flip, byte alteration, or corrupted ciphertext stored off-chain in the storage relay/IPFS.
1. **Simulate Off-Chain Ciphertext Tampering**:
   - Open any `.bin` file in `backend/storage/uploads/` (for example, the CID file corresponding to Record #1) in a text editor or hex editor.
   - Alter or append a single byte in the ciphertext payload and save the file.
2. **Attempt Access in Hospital Portal**:
   - Navigate to `/hospital` -> **"Consented Records"**, click **"View Record (Log & Decrypt)"** on Record #1, and confirm `logAccess` in MetaMask.
3. **Cryptographic Result**:
   - After unwrap, the browser passes the ciphertext and 12-byte IV to Web Cryptography `SubtleCrypto.decrypt(AES-GCM)`.
   - The Galois/Counter Mode authenticated cipher verifies the 128-bit authentication tag against the ciphertext.
   - Because the ciphertext bytes were modified, tag verification fails and decryption throws.
   - **Modal Display**:
     - 🔴 **"TAMPERED: Ciphertext authentication failed"**
     - Subtitle: *"SECURITY ALERT (Case A - Storage Tampering): The 128-bit AES-256-GCM authentication tag verification failed. The encrypted ciphertext or initialization vector stored off-chain has been modified or corrupted."*
     - **File preview and download links are completely hidden/blocked.**

#### Case (b): Document Substitution (Decryption Succeeds, On-Chain Hash Mismatch)
*What it tests*: A malicious storage provider or adversary substitutes a record with another validly-encrypted document (such as `docs/sample-data/tamper_test/blood_test_report_modified.pdf`, where glucose values were altered from 95 mg/dL to 340 mg/dL).
1. **Cryptographic Mechanism**:
   - The file decrypts cleanly with the AES key because the ciphertext was created with that key.
   - The browser recomputes the SHA-256 hash of the decrypted plaintext: `SHA256(plaintext)`.
   - The browser queries the smart contract: `contract.verifyRecord(recordId, recomputedHash)`.
   - The smart contract evaluates whether `records[recordId].recordHash == recomputedHash`.
2. **Cryptographic Result**:
   - The on-chain hash was committed immutably by Hospital A during initial upload.
   - The recomputed hash of the altered document does not match the immutable blockchain hash.
   - `verifyRecord` returns `false`.
   - **Modal Display**:
     - 🔴 **"TAMPERED: file does not match the on-chain hash"**
     - Subtitle: *"SECURITY ALERT (Case B - Hash Mismatch): The file was decrypted, but its recomputed SHA-256 hash does not match the immutable record hash committed to the blockchain. File display is strictly blocked to protect clinical integrity."*
     - Shows side-by-side comparison: **On-Chain Expected Hash** vs **Recomputed Actual Hash**.
     - **File preview and download links are completely hidden/blocked** to prevent clinical misdiagnosis.

---

### Part 3: Immediate Revocation & Expired Consent Demo (45 Seconds)

1. **Verify Pre-Seeded Expired Consent**:
   - Switch in MetaMask to **Hospital B** (`0x90F79bf6EB2c4f870365E785982E1f101E93b906`).
   - Open `/hospital` -> **"Consented Records"**:
     - Notice **Record #5 (Radiology - Chest X-Ray)** displays 🔴 **Consent Inactive**.
     - The "View Record" button is disabled: `"Consent Expired / Revoked"`.
2. **Approve Pending Cardiology Request**:
   - Switch in MetaMask to **Patient Alice** (`0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`).
   - Navigate to `http://localhost:5173/patient`.
   - Under **"Pending Access Requests"**, see Hospital B's request for **Cardiology** (matching Record #3: `cardiology_report.pdf`).
   - Select expiry (e.g. 24 Hours) and click **"Approve Access"**.
   - Watch the live TxStatus banner unwrap Record #3's key with Alice's private key, re-wrap it for Hospital B's public key, POST the envelope, and confirm `grantConsent` on-chain.
3. **Revoke Active Consent in $O(1)$**:
   - Under **"Active & Granted Consents"**, see Hospital A's active consent with a **live countdown timer** updating every second.
   - Click **"Revoke Access Immediately"**.
   - Review the security dialog:
     > *"This stops future access. A hospital that already decrypted a record keeps its copy."*
   - Click **"Yes, Revoke Consent"** and confirm in MetaMask.
   - Card transitions immediately to 🔴 **Consent Revoked**.
4. **Confirm Revocation Blocks Hospital A**:
   - Switch back to **Hospital A** at `/hospital` -> "Consented Records":
     - Hospital A's records have turned to 🔴 **Consent Inactive** and viewing is disabled.

---

### Part 4: Immutable Audit Trail & Live Feed (30 Seconds)

1. **Navigate to Audit Page**:
   - Visit `http://localhost:5173/audit`.
   - Observe your role-filtered audit timeline:
     - 🔷 `Record Added`: Hospital A uploaded records for Alice.
     - 🟡 `Access Requested`: Hospital access requests.
     - 🟢 `Consent Granted`: Patient Alice granted time-bound permissions.
     - 🟣 `Record Accessed`: Audited decryptions logged on-chain.
     - 🔴 `Consent Revoked`: Alice's immediate revocation.
2. **Filter & Search**:
   - Filter by Event Type: select `RecordAccessed`.
   - Filter by Record ID: type `1`.
   - Search Address: paste `0x709979...`.
3. **One-Click CSV Export**:
   - Click **"Export CSV"** to download the audit log for compliance reporting.

---

## 4. Key Architectural Guarantees to Highlight to Evaluators

1. **Zero Protected Health Information On-Chain**: The Ethereum blockchain only stores access policies, consent expiries, tamper hashes, and access logs.
2. **Zero-Knowledge Backend Relay**: The server handles only blind, high-entropy ciphertexts and wrapped envelopes; it never possesses private keys or plaintext data.
3. **Client-Side Envelope Encryption**: RSA-OAEP 2048-bit wrapping protects ephemeral AES-256-GCM symmetric keys.
4. **Mandated Log-Before-Decrypt**: `logAccess` MUST succeed on-chain before the browser initiates ciphertext retrieval or decryption.
5. **Instant $O(1)$ Revocation**: Blanket invalidation across all records in a single transaction via `lastRevokedTimestamp`.

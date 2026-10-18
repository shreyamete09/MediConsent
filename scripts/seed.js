/**
 * @file seed.js
 * @notice Automated Seed Script for Local Dev Network (Hardhat 31337).
 *
 * SAFETY GUARD:
 * Refuses execution on any non-local network (Polygon Amoy, Mainnet, etc.).
 *
 * DEMO PIPELINE EXECUTED:
 * 1. Checks deployment manifest.
 * 2. Sets up 2 hospitals and 1 patient with real RSA key pairs.
 * 3. Registers hospitals and patient on-chain with their RSA public keys.
 * 4. Encrypts 4 synthetic sample files with AES-256-GCM, wraps keys for patient,
 *    and registers them on-chain via addRecord.
 * 5. Creates 3 distinct demonstration states:
 *    - 1 Active Consent (Hospital A: General & Pathology, valid for 7 days)
 *    - 1 Expired Consent (Hospital B: Radiology, expired via evm_increaseTime)
 *    - 1 Pending Access Request (Hospital B: Cardiology, awaiting patient approval)
 * 6. Exports browser-compatible keystore backups to docs/sample-data/keystores/.
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

async function main() {
  console.log("\n========================================================");
  console.log("MediConsent Local Seed Script");
  console.log("========================================================");

  // ── 1. Strict Local Network Guard ───────────────────────────────────────────
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  if (chainId !== 31337 && chainId !== 1337 && network.name !== "hardhat" && network.name !== "localhost") {
    console.error(`\n[SECURITY REJECTED] Seed script is restricted to local network only.`);
    console.error(`Current Network: ${network.name} (Chain ID: ${chainId}). Aborting immediately.`);
    process.exit(1);
  }

  console.log(`[Network] Connected to local network (Chain ID: ${chainId})`);

  // ── 2. Check Contract Deployment ───────────────────────────────────────────
  let deploymentPath = path.resolve(__dirname, "../deployments/localhost_31337.json");
  if (!fs.existsSync(deploymentPath)) {
    deploymentPath = path.resolve(__dirname, "../deployments/hardhat_31337.json");
  }

  if (!fs.existsSync(deploymentPath)) {
    console.error("\n[ERROR] Deployment manifest not found in deployments/.");
    console.error("Please deploy the contract first: npm run deploy:local\n");
    process.exit(1);
  }

  const deploymentData = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const contractAddress = deploymentData.contractAddress;

  const code = await hre.ethers.provider.getCode(contractAddress);
  if (!code || code === "0x") {
    console.error(`\n[ERROR] No contract bytecode found at ${contractAddress}.`);
    console.error("The local node may have been restarted. Please re-deploy: npm run deploy:local\n");
    process.exit(1);
  }

  const MediConsent = await hre.ethers.getContractFactory("MediConsent");
  const mediConsent = MediConsent.attach(contractAddress);
  console.log(`[Contract] Attached to MediConsent at: ${contractAddress}`);

  // ── 3. Dynamic Import of Frontend Crypto Modules ────────────────────────────
  const { generateAesKey, encryptFile, exportAesKey } = await import(
    "../frontend/src/crypto/aes.js"
  );
  const {
    generateRsaKeyPair,
    exportPublicKey,
    exportPrivateKey,
    wrapAesKey,
    unwrapAesKey,
    importPublicKey,
  } = await import("../frontend/src/crypto/rsa.js");
  const { computeFileHash } = await import("../frontend/src/crypto/hash.js");

  // ── 4. Signers Setup ────────────────────────────────────────────────────────
  const signers = await hre.ethers.getSigners();
  const admin = signers[0]; // 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
  const hospitalA = signers[1]; // 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
  const patient = signers[2]; // 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
  const hospitalB = signers[3]; // 0x90F79bf6EB2c4f870365E785982E1f101E93b906

  console.log("\n[Accounts]");
  console.log(`  Admin / Deployer: ${admin.address}`);
  console.log(`  Hospital A:       ${hospitalA.address} (City Memorial Hospital)`);
  console.log(`  Hospital B:       ${hospitalB.address} (Metro Health Clinic)`);
  console.log(`  Patient:          ${patient.address} (Alice Walker)`);

  // ── 5. Generate RSA Key Pairs & Export Keystore Backups ─────────────────────
  console.log("\n[Keystore Generation]");
  const keystoresDir = path.resolve(__dirname, "../docs/sample-data/keystores");
  fs.mkdirSync(keystoresDir, { recursive: true });

  async function generateAndExportKeystore(accountAddress, roleName) {
    const pair = await generateRsaKeyPair();
    const pubB64 = await exportPublicKey(pair.publicKey);
    const privB64 = await exportPrivateKey(pair.privateKey);

    const backup = {
      version: 1,
      account: accountAddress.toLowerCase(),
      role: roleName,
      createdAt: new Date().toISOString(),
      publicKeyB64: pubB64,
      privateKeyB64: privB64,
      warning: "KEEP THIS FILE SECURE. Anyone with this file can decrypt your medical records.",
    };

    const filePath = path.resolve(
      keystoresDir,
      `mediconsent-keystore-${accountAddress.slice(0, 8).toLowerCase()}.json`
    );
    fs.writeFileSync(filePath, JSON.stringify(backup, null, 2), "utf8");

    return {
      keyPair: pair,
      pubB64,
      privB64,
      filePath,
    };
  }

  const hospAKeys = await generateAndExportKeystore(hospitalA.address, "Hospital");
  const hospBKeys = await generateAndExportKeystore(hospitalB.address, "Hospital");
  const patientKeys = await generateAndExportKeystore(patient.address, "Patient");

  console.log(`  ✔ Hospital A keys generated & saved to: docs/sample-data/keystores/mediconsent-keystore-${hospitalA.address.slice(0, 8).toLowerCase()}.json`);
  console.log(`  ✔ Hospital B keys generated & saved to: docs/sample-data/keystores/mediconsent-keystore-${hospitalB.address.slice(0, 8).toLowerCase()}.json`);
  console.log(`  ✔ Patient keys generated & saved to:    docs/sample-data/keystores/mediconsent-keystore-${patient.address.slice(0, 8).toLowerCase()}.json`);

  // ── 6. On-Chain Registration & PKI ──────────────────────────────────────────
  console.log("\n[On-Chain Registration]");

  // Register / update Hospital A
  const hospAInfo = await mediConsent.hospitals(hospitalA.address);
  if (!hospAInfo.isRegistered) {
    const tx = await mediConsent.connect(admin).registerHospital(
      hospitalA.address,
      "City Memorial Hospital",
      hospAKeys.pubB64
    );
    await tx.wait();
    console.log(`  ✔ Registered Hospital A: City Memorial Hospital`);
  } else {
    const tx = await mediConsent.connect(admin).updateHospital(
      hospitalA.address,
      "City Memorial Hospital",
      hospAKeys.pubB64
    );
    await tx.wait();
    console.log(`  ✔ Updated Hospital A on-chain with fresh RSA public key`);
  }

  // Register / update Hospital B
  const hospBInfo = await mediConsent.hospitals(hospitalB.address);
  if (!hospBInfo.isRegistered) {
    const tx = await mediConsent.connect(admin).registerHospital(
      hospitalB.address,
      "Metro Health Clinic",
      hospBKeys.pubB64
    );
    await tx.wait();
    console.log(`  ✔ Registered Hospital B: Metro Health Clinic`);
  } else {
    const tx = await mediConsent.connect(admin).updateHospital(
      hospitalB.address,
      "Metro Health Clinic",
      hospBKeys.pubB64
    );
    await tx.wait();
    console.log(`  ✔ Updated Hospital B on-chain with fresh RSA public key`);
  }

  // Register Patient Alice & set public key
  const isPatReg = await mediConsent.isPatientRegistered(patient.address);
  if (!isPatReg) {
    const tx = await mediConsent.connect(patient).registerPatient();
    await tx.wait();
    console.log(`  ✔ Registered Patient Alice`);
  }
  const setKeyTx = await mediConsent.connect(patient).setPatientPublicKey(patientKeys.pubB64);
  await setKeyTx.wait();
  console.log(`  ✔ Published Patient Alice RSA public key on-chain`);

  // ── 7. Storage Directories Setup ────────────────────────────────────────────
  const uploadsDir = path.resolve(__dirname, "../backend/storage/uploads");
  const envelopesDir = path.resolve(__dirname, "../backend/storage/envelopes");
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(envelopesDir, { recursive: true });

  // ── 8. Upload Sample Records via Pipeline ────────────────────────────────────
  console.log("\n[Uploading Encrypted Records]");
  const sampleDataDir = path.resolve(__dirname, "../docs/sample-data");

  const sampleFiles = [
    { name: "prescription.pdf", category: 0, label: "General" },
    { name: "discharge_summary.txt", category: 0, label: "General" },
    { name: "cardiology_report.pdf", category: 1, label: "Cardiology" },
    { name: "blood_test_report.pdf", category: 3, label: "Pathology" },
    { name: "chest_xray.png", category: 2, label: "Radiology" },
  ];

  const seededRecords = [];

  for (const item of sampleFiles) {
    const filePath = path.resolve(sampleDataDir, item.name);
    if (!fs.existsSync(filePath)) {
      console.warn(`  ⚠ Sample file ${item.name} not found, skipping.`);
      continue;
    }

    const rawBuffer = fs.readFileSync(filePath);

    // Step a: Compute SHA-256 of original plaintext
    const recordHash = await computeFileHash(rawBuffer.buffer.slice(rawBuffer.byteOffset, rawBuffer.byteOffset + rawBuffer.byteLength));

    // Step b: Generate AES-256-GCM key & encrypt
    const aesKey = await generateAesKey();
    const { ciphertext, iv } = await encryptFile(new Uint8Array(rawBuffer), aesKey);

    // Combine payload: [12-byte IV][ciphertext]
    const payload = Buffer.concat([Buffer.from(iv), Buffer.from(ciphertext)]);

    // Step c: Wrap AES key for patient
    const wrappedKeyForPatient = await wrapAesKey(aesKey, patientKeys.keyPair.publicKey);

    // Step d: Store encrypted payload to local storage
    const contentHash = crypto.createHash("sha256").update(payload).digest("hex");
    const mockCid = `QmLocal${contentHash.slice(0, 39)}`;
    fs.writeFileSync(path.resolve(uploadsDir, `${mockCid}.bin`), payload);

    // Step e: Call addRecord on-chain as Hospital A
    const addTx = await mediConsent.connect(hospitalA).addRecord(
      patient.address,
      item.category,
      mockCid,
      recordHash
    );
    const receipt = await addTx.wait();

    // Extract assigned recordId from RecordAdded event
    const iface = mediConsent.interface;
    const addedEvt = receipt.logs
      .map((l) => {
        try {
          return iface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e) => e && e.name === "RecordAdded");

    const recordId = addedEvt ? addedEvt.args.recordId.toString() : seededRecords.length + 1;

    // Step f: Save patient envelope
    const envData = {
      recordId: String(recordId),
      hospitalAddress: hospitalA.address.toLowerCase(),
      patientAddress: patient.address.toLowerCase(),
      recipient: patient.address.toLowerCase(),
      recordType: item.category,
      wrappedKey: wrappedKeyForPatient,
      savedAt: new Date().toISOString(),
    };

    fs.writeFileSync(
      path.resolve(envelopesDir, `${recordId}_${patient.address.toLowerCase()}.json`),
      JSON.stringify(envData, null, 2),
      "utf8"
    );

    seededRecords.push({
      recordId: String(recordId),
      name: item.name,
      category: item.category,
      categoryLabel: item.label,
      cid: mockCid,
      hash: recordHash,
      aesKey,
    });

    console.log(`  ✔ Record #${recordId} (${item.label} - ${item.name}) added on-chain. CID: ${mockCid.slice(0, 22)}…`);
  }

  // ── 9. Create Demo States ───────────────────────────────────────────────────
  console.log("\n[Creating Demo States]");

  // ── State 1: Active Consent for Hospital A (General + Pathology) ─────────────
  console.log("  1. Setting up Active Consent for Hospital A (General & Pathology, 7 days)...");
  const activeRecordTypes = [0, 3]; // General, Pathology
  const sevenDaysExpiry = Math.floor(Date.now() / 1000) + 7 * 86400;

  // Re-wrap AES keys for Hospital A for records in General and Pathology
  for (const rec of seededRecords) {
    if (activeRecordTypes.includes(rec.category)) {
      const wrappedForHospA = await wrapAesKey(rec.aesKey, hospAKeys.keyPair.publicKey);
      const hospAEnv = {
        recordId: rec.recordId,
        hospitalAddress: hospitalA.address.toLowerCase(),
        patientAddress: patient.address.toLowerCase(),
        recipient: hospitalA.address.toLowerCase(),
        recordType: rec.category,
        wrappedKey: wrappedForHospA,
        savedAt: new Date().toISOString(),
      };

      const hospAEnvPath = path.resolve(envelopesDir, `${rec.recordId}_${hospitalA.address.toLowerCase()}.json`);
      fs.writeFileSync(
        hospAEnvPath,
        JSON.stringify(hospAEnv, null, 2),
        "utf8"
      );
      console.log(`     ✔ Envelope stored for Hospital A on Record #${rec.recordId} (${rec.name}) -> ${path.basename(hospAEnvPath)}`);
    }
  }

  // Hospital A requests access, Patient Alice grants consent
  const reqTxA = await mediConsent.connect(hospitalA).requestAccess(patient.address, activeRecordTypes);
  await reqTxA.wait();

  const grantTxA = await mediConsent.connect(patient).grantConsent(
    hospitalA.address,
    activeRecordTypes,
    sevenDaysExpiry
  );
  await grantTxA.wait();
  console.log("     ✔ Consent granted on-chain to Hospital A for General & Pathology");

  // ── State 2: Expired Consent for Hospital B (Radiology) ──────────────────────
  console.log("  2. Setting up Expired Consent for Hospital B (Radiology)...");
  const expiredTypes = [2]; // Radiology
  const shortExpiry = (await hre.ethers.provider.getBlock("latest")).timestamp + 100; // 100 seconds from now

  // Re-wrap key for Hospital B for Chest X-Ray (record category 2)
  const xrayRec = seededRecords.find((r) => r.category === 2);
  if (xrayRec) {
    const wrappedForHospB = await wrapAesKey(xrayRec.aesKey, hospBKeys.keyPair.publicKey);
    const hospBEnv = {
      recordId: xrayRec.recordId,
      hospitalAddress: hospitalB.address.toLowerCase(),
      patientAddress: patient.address.toLowerCase(),
      recipient: hospitalB.address.toLowerCase(),
      recordType: xrayRec.category,
      wrappedKey: wrappedForHospB,
      savedAt: new Date().toISOString(),
    };

    fs.writeFileSync(
      path.resolve(envelopesDir, `${xrayRec.recordId}_${hospitalB.address.toLowerCase()}.json`),
      JSON.stringify(hospBEnv, null, 2),
      "utf8"
    );
  }

  // Hospital B requests, Patient grants, then we fast-forward time
  const reqTxB1 = await mediConsent.connect(hospitalB).requestAccess(patient.address, expiredTypes);
  await reqTxB1.wait();

  const grantTxB1 = await mediConsent.connect(patient).grantConsent(
    hospitalB.address,
    expiredTypes,
    shortExpiry
  );
  await grantTxB1.wait();

  // Fast-forward local EVM time past expiry (+3600 seconds)
  await hre.network.provider.send("evm_increaseTime", [3600]);
  await hre.network.provider.send("evm_mine");
  console.log("     ✔ Expired consent created (EVM fast-forwarded +1 hour; checkAccess now returns false)");

  // ── State 3: Pending Access Request from Hospital B (Cardiology) ─────────────
  console.log("  3. Setting up Pending Access Request from Hospital B (Cardiology)...");
  const pendingTypes = [1]; // Cardiology
  const reqTxB2 = await mediConsent.connect(hospitalB).requestAccess(patient.address, pendingTypes);
  await reqTxB2.wait();
  console.log("     ✔ Pending request submitted on-chain by Hospital B for Cardiology");

  // ── 10. Summary Report ──────────────────────────────────────────────────────
  console.log("\n========================================================");
  console.log("MediConsent Local Seed Complete!");
  console.log("========================================================");
  console.log("\n[Demo Accounts]");
  console.log(`  1. Hospital A:   ${hospitalA.address}`);
  console.log(`     Name:         City Memorial Hospital`);
  console.log(`     Keystore:     docs/sample-data/keystores/mediconsent-keystore-${hospitalA.address.slice(0, 8).toLowerCase()}.json`);
  console.log(`\n  2. Hospital B:   ${hospitalB.address}`);
  console.log(`     Name:         Metro Health Clinic`);
  console.log(`     Keystore:     docs/sample-data/keystores/mediconsent-keystore-${hospitalB.address.slice(0, 8).toLowerCase()}.json`);
  console.log(`\n  3. Patient:      ${patient.address}`);
  console.log(`     Name:         Alice Walker`);
  console.log(`     Keystore:     docs/sample-data/keystores/mediconsent-keystore-${patient.address.slice(0, 8).toLowerCase()}.json`);

  console.log("\n[Seeded Medical Records]");
  for (const r of seededRecords) {
    console.log(`  Record #${r.recordId}: [${r.categoryLabel}] ${r.name}`);
    console.log(`    IPFS CID:  ${r.cid}`);
    console.log(`    SHA-256:   ${r.hash}`);
  }

  console.log("\n[Demonstration States Ready for Demo]");
  console.log("  ✔ ACTIVE CONSENT:   Hospital A has active consent for General & Pathology (Records #1, #2, #4)");
  console.log("                      Can be opened in Hospital Portal -> 'Consented Records' (PDF & TXT previews)");
  console.log("  ✔ EXPIRED CONSENT:  Hospital B had consent for Radiology (Record #5) which is now EXPIRED");
  console.log("                      Displays as 'Consent Expired' / button disabled in viewer");
  console.log("  ✔ PENDING REQUEST:  Hospital B has a pending request for Cardiology (matching Record #3: cardiology_report.pdf)");
  console.log("                      Patient can approve it on Patient Dashboard -> 'Pending Access Requests'!");
  console.log("\n[Browser Keystore Notice]");
  console.log("  Keystore backups are saved in docs/sample-data/keystores/ (ignored by git).");
  console.log("  Click 'Import Key' in the browser UI to import the private key for each demo wallet.");
  console.log("========================================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n[Seed Failed]:", error);
    process.exit(1);
  });

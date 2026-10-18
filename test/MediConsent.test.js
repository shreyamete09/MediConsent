const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("MediConsent Contract Test Suite", function () {
  // Enum mappings corresponding to MediConsent.sol
  const RecordType = {
    General: 0,
    Cardiology: 1,
    Radiology: 2,
    Pathology: 3,
    Neurology: 4,
    Oncology: 5,
  };

  // Sample data
  const MOCK_IPFS_CID = "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco";
  const MOCK_RECORD_HASH = ethers.keccak256(ethers.toUtf8Bytes("CONFIDENTIAL_PATIENT_RECORD_PLAINTEXT_V1"));
  const TAMPERED_RECORD_HASH = ethers.keccak256(ethers.toUtf8Bytes("TAMPERED_RECORD_CONTENT"));
  const MOCK_RSA_PUBKEY = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...\n-----END PUBLIC KEY-----";

  async function deployMediConsentFixture() {
    const [admin, hospitalA, hospitalB, patient1, patient2, unauthorizedUser] = await ethers.getSigners();

    const MediConsentFactory = await ethers.getContractFactory("MediConsent");
    const mediConsent = await MediConsentFactory.deploy();
    await mediConsent.waitForDeployment();

    // Roles
    const DEFAULT_ADMIN_ROLE = await mediConsent.DEFAULT_ADMIN_ROLE();
    const HOSPITAL_ROLE = await mediConsent.HOSPITAL_ROLE();
    const PATIENT_ROLE = await mediConsent.PATIENT_ROLE();

    // Register Hospital A
    await mediConsent.connect(admin).registerHospital(
      hospitalA.address,
      "Apollo General Hospital",
      MOCK_RSA_PUBKEY
    );

    // Register Patient 1 & Patient 2
    await mediConsent.connect(patient1).registerPatient();
    await mediConsent.connect(patient2).registerPatient();

    return {
      mediConsent,
      admin,
      hospitalA,
      hospitalB,
      patient1,
      patient2,
      unauthorizedUser,
      DEFAULT_ADMIN_ROLE,
      HOSPITAL_ROLE,
      PATIENT_ROLE,
    };
  }

  describe("1. Deployment & Roles", function () {
    it("Should assign DEFAULT_ADMIN_ROLE to deployer", async function () {
      const { mediConsent, admin, DEFAULT_ADMIN_ROLE } = await loadFixture(deployMediConsentFixture);
      expect(await mediConsent.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("Should correctly identify registered hospital and patient roles", async function () {
      const { mediConsent, hospitalA, patient1, HOSPITAL_ROLE, PATIENT_ROLE } = await loadFixture(deployMediConsentFixture);
      expect(await mediConsent.hasRole(HOSPITAL_ROLE, hospitalA.address)).to.be.true;
      expect(await mediConsent.hasRole(PATIENT_ROLE, patient1.address)).to.be.true;
    });
  });

  describe("2. Patient & Hospital Registration", function () {
    it("Should allow a new user to self-register as patient and emit PatientRegistered", async function () {
      const { mediConsent, unauthorizedUser, PATIENT_ROLE } = await loadFixture(deployMediConsentFixture);

      const tx = await mediConsent.connect(unauthorizedUser).registerPatient();
      const receipt = await tx.wait();

      // Verify event was emitted with correct patient address (timestamp is block-dependent)
      const event = receipt.logs
        .map(log => { try { return mediConsent.interface.parseLog(log); } catch { return null; } })
        .find(e => e && e.name === "PatientRegistered");
      expect(event).to.not.be.null;
      expect(event.args.patient).to.equal(unauthorizedUser.address);
      expect(event.args.timestamp).to.be.greaterThan(0n);

      expect(await mediConsent.isPatientRegistered(unauthorizedUser.address)).to.be.true;
      expect(await mediConsent.hasRole(PATIENT_ROLE, unauthorizedUser.address)).to.be.true;
    });

    it("Should revert if patient tries to register twice", async function () {
      const { mediConsent, patient1 } = await loadFixture(deployMediConsentFixture);
      await expect(mediConsent.connect(patient1).registerPatient())
        .to.be.revertedWithCustomError(mediConsent, "PatientAlreadyRegistered")
        .withArgs(patient1.address);
    });

    it("Should allow patient to set their RSA public key and emit PatientKeyUpdated", async function () {
      const { mediConsent, patient1 } = await loadFixture(deployMediConsentFixture);

      const tx = await mediConsent.connect(patient1).setPatientPublicKey(MOCK_RSA_PUBKEY);
      const receipt = await tx.wait();

      const event = receipt.logs
        .map(log => { try { return mediConsent.interface.parseLog(log); } catch { return null; } })
        .find(e => e && e.name === "PatientKeyUpdated");
      expect(event).to.not.be.null;
      expect(event.args.patient).to.equal(patient1.address);
      expect(event.args.timestamp).to.be.greaterThan(0n);

      expect(await mediConsent.patientPublicKeys(patient1.address)).to.equal(MOCK_RSA_PUBKEY);
    });

    it("Should revert setPatientPublicKey for empty key or non-patient", async function () {
      const { mediConsent, patient1, unauthorizedUser } = await loadFixture(deployMediConsentFixture);

      await expect(
        mediConsent.connect(patient1).setPatientPublicKey("")
      ).to.be.revertedWithCustomError(mediConsent, "EmptyString")
        .withArgs("rsaPublicKey");

      await expect(
        mediConsent.connect(unauthorizedUser).setPatientPublicKey(MOCK_RSA_PUBKEY)
      ).to.be.revertedWithCustomError(mediConsent, "AccessControlUnauthorizedAccount");
    });

    it("Should allow admin to register hospital and emit HospitalRegistered", async function () {
      const { mediConsent, admin, hospitalB, HOSPITAL_ROLE } = await loadFixture(deployMediConsentFixture);

      await expect(
        mediConsent.connect(admin).registerHospital(hospitalB.address, "Metro Clinic", MOCK_RSA_PUBKEY)
      )
        .to.emit(mediConsent, "HospitalRegistered")
        .withArgs(hospitalB.address, "Metro Clinic", MOCK_RSA_PUBKEY, (await time.latest()) + 1);

      expect(await mediConsent.hasRole(HOSPITAL_ROLE, hospitalB.address)).to.be.true;
      const info = await mediConsent.hospitals(hospitalB.address);
      expect(info.name).to.equal("Metro Clinic");
      expect(info.rsaPublicKey).to.equal(MOCK_RSA_PUBKEY);
      expect(info.isRegistered).to.be.true;
    });

    it("Should revert when non-admin attempts to register a hospital", async function () {
      const { mediConsent, hospitalA, hospitalB } = await loadFixture(deployMediConsentFixture);
      await expect(
        mediConsent.connect(hospitalA).registerHospital(hospitalB.address, "Rogue Hospital", MOCK_RSA_PUBKEY)
      ).to.be.revertedWithCustomError(mediConsent, "AccessControlUnauthorizedAccount");
    });

    it("Should revert hospital registration for zero address or empty parameters", async function () {
      const { mediConsent, admin } = await loadFixture(deployMediConsentFixture);

      await expect(
        mediConsent.connect(admin).registerHospital(ethers.ZeroAddress, "Name", MOCK_RSA_PUBKEY)
      ).to.be.revertedWithCustomError(mediConsent, "ZeroAddress");

      await expect(
        mediConsent.connect(admin).registerHospital(ethers.Wallet.createRandom().address, "", MOCK_RSA_PUBKEY)
      ).to.be.revertedWithCustomError(mediConsent, "EmptyString")
        .withArgs("name");

      await expect(
        mediConsent.connect(admin).registerHospital(ethers.Wallet.createRandom().address, "Name", "")
      ).to.be.revertedWithCustomError(mediConsent, "EmptyString")
        .withArgs("rsaPublicKey");
    });

    it("Should revert if hospital is already registered", async function () {
      const { mediConsent, admin, hospitalA } = await loadFixture(deployMediConsentFixture);
      await expect(
        mediConsent.connect(admin).registerHospital(hospitalA.address, "Duplicate", MOCK_RSA_PUBKEY)
      ).to.be.revertedWithCustomError(mediConsent, "HospitalAlreadyRegistered")
        .withArgs(hospitalA.address);
    });

    it("Should allow admin to update hospital details and emit HospitalRegistered", async function () {
      const { mediConsent, admin, hospitalA } = await loadFixture(deployMediConsentFixture);

      const NEW_KEY = "MOCK_UPDATED_RSA_KEY_12345";
      await expect(
        mediConsent.connect(admin).updateHospital(hospitalA.address, "Updated Memorial Hospital", NEW_KEY)
      ).to.emit(mediConsent, "HospitalRegistered");

      const info = await mediConsent.hospitals(hospitalA.address);
      expect(info.name).to.equal("Updated Memorial Hospital");
      expect(info.rsaPublicKey).to.equal(NEW_KEY);
    });

    it("Should revert updateHospital for unregistered hospital, non-admin or empty parameters", async function () {
      const { mediConsent, admin, hospitalA, unauthorizedUser } = await loadFixture(deployMediConsentFixture);

      await expect(
        mediConsent.connect(admin).updateHospital(unauthorizedUser.address, "Name", "Key")
      ).to.be.revertedWithCustomError(mediConsent, "HospitalNotRegistered")
        .withArgs(unauthorizedUser.address);

      await expect(
        mediConsent.connect(unauthorizedUser).updateHospital(hospitalA.address, "Name", "Key")
      ).to.be.revertedWithCustomError(mediConsent, "AccessControlUnauthorizedAccount");

      await expect(
        mediConsent.connect(admin).updateHospital(hospitalA.address, "", "Key")
      ).to.be.revertedWithCustomError(mediConsent, "EmptyString")
        .withArgs("name");

      await expect(
        mediConsent.connect(admin).updateHospital(hospitalA.address, "Name", "")
      ).to.be.revertedWithCustomError(mediConsent, "EmptyString")
        .withArgs("rsaPublicKey");
    });
  });

  describe("3. Record Creation (addRecord)", function () {
    it("Should allow registered hospital to add record and emit RecordAdded", async function () {
      const { mediConsent, hospitalA, patient1 } = await loadFixture(deployMediConsentFixture);

      const tx = await mediConsent.connect(hospitalA).addRecord(
        patient1.address,
        RecordType.Cardiology,
        MOCK_IPFS_CID,
        MOCK_RECORD_HASH
      );

      await expect(tx)
        .to.emit(mediConsent, "RecordAdded")
        .withArgs(
          1,
          patient1.address,
          hospitalA.address,
          RecordType.Cardiology,
          MOCK_IPFS_CID,
          MOCK_RECORD_HASH,
          (await time.latest())
        );

      const record = await mediConsent.getRecord(1);
      expect(record.id).to.equal(1);
      expect(record.patient).to.equal(patient1.address);
      expect(record.hospital).to.equal(hospitalA.address);
      expect(record.recordType).to.equal(RecordType.Cardiology);
      expect(record.ipfsCid).to.equal(MOCK_IPFS_CID);
      expect(record.recordHash).to.equal(MOCK_RECORD_HASH);
      expect(record.exists).to.be.true;

      const patientRecords = await mediConsent.getPatientRecordIds(patient1.address);
      expect(patientRecords.length).to.equal(1);
      expect(patientRecords[0]).to.equal(1);
    });

    it("Should revert if non-hospital caller attempts to add record", async function () {
      const { mediConsent, patient1, unauthorizedUser } = await loadFixture(deployMediConsentFixture);

      await expect(
        mediConsent.connect(unauthorizedUser).addRecord(
          patient1.address,
          RecordType.Cardiology,
          MOCK_IPFS_CID,
          MOCK_RECORD_HASH
        )
      ).to.be.revertedWithCustomError(mediConsent, "AccessControlUnauthorizedAccount");

      // Even the patient cannot add their own record directly without hospital role
      await expect(
        mediConsent.connect(patient1).addRecord(
          patient1.address,
          RecordType.Cardiology,
          MOCK_IPFS_CID,
          MOCK_RECORD_HASH
        )
      ).to.be.revertedWithCustomError(mediConsent, "AccessControlUnauthorizedAccount");
    });

    it("Should revert addRecord if patient is not registered", async function () {
      const { mediConsent, hospitalA, unauthorizedUser } = await loadFixture(deployMediConsentFixture);

      await expect(
        mediConsent.connect(hospitalA).addRecord(
          unauthorizedUser.address,
          RecordType.Cardiology,
          MOCK_IPFS_CID,
          MOCK_RECORD_HASH
        )
      ).to.be.revertedWithCustomError(mediConsent, "PatientNotRegistered")
        .withArgs(unauthorizedUser.address);
    });

    it("Should revert addRecord for zero address, empty ipfsCid or zero hash", async function () {
      const { mediConsent, hospitalA, patient1 } = await loadFixture(deployMediConsentFixture);

      await expect(
        mediConsent.connect(hospitalA).addRecord(
          ethers.ZeroAddress,
          RecordType.Cardiology,
          MOCK_IPFS_CID,
          MOCK_RECORD_HASH
        )
      ).to.be.revertedWithCustomError(mediConsent, "ZeroAddress");

      await expect(
        mediConsent.connect(hospitalA).addRecord(
          patient1.address,
          RecordType.Cardiology,
          "",
          MOCK_RECORD_HASH
        )
      ).to.be.revertedWithCustomError(mediConsent, "EmptyString")
        .withArgs("ipfsCid");

      await expect(
        mediConsent.connect(hospitalA).addRecord(
          patient1.address,
          RecordType.Cardiology,
          MOCK_IPFS_CID,
          ethers.ZeroHash
        )
      ).to.be.revertedWithCustomError(mediConsent, "EmptyString")
        .withArgs("recordHash");
    });

    it("Should revert getPatientRecordIds if patient is not registered", async function () {
      const { mediConsent, unauthorizedUser } = await loadFixture(deployMediConsentFixture);
      await expect(
        mediConsent.getPatientRecordIds(unauthorizedUser.address)
      ).to.be.revertedWithCustomError(mediConsent, "PatientNotRegistered")
        .withArgs(unauthorizedUser.address);
    });

    it("Should revert getRecord for non-existent record ID", async function () {
      const { mediConsent } = await loadFixture(deployMediConsentFixture);
      await expect(mediConsent.getRecord(999)).to.be.revertedWithCustomError(
        mediConsent,
        "RecordDoesNotExist"
      ).withArgs(999);
    });
  });

  describe("4. Access Request & Granular Consent Flow", function () {
    it("Should allow hospital to request access and emit AccessRequested", async function () {
      const { mediConsent, hospitalA, patient1 } = await loadFixture(deployMediConsentFixture);

      const requestedTypes = [RecordType.Cardiology, RecordType.Pathology];
      await expect(
        mediConsent.connect(hospitalA).requestAccess(patient1.address, requestedTypes)
      )
        .to.emit(mediConsent, "AccessRequested")
        .withArgs(patient1.address, hospitalA.address, requestedTypes, (await time.latest()) + 1);
    });

    it("Should revert requestAccess if caller is not hospital, patient is zero address, patient is unregistered, or list is empty", async function () {
      const { mediConsent, unauthorizedUser, hospitalA, patient1 } = await loadFixture(deployMediConsentFixture);

      await expect(
        mediConsent.connect(unauthorizedUser).requestAccess(patient1.address, [RecordType.Cardiology])
      ).to.be.revertedWithCustomError(mediConsent, "AccessControlUnauthorizedAccount");

      await expect(
        mediConsent.connect(hospitalA).requestAccess(ethers.ZeroAddress, [RecordType.Cardiology])
      ).to.be.revertedWithCustomError(mediConsent, "ZeroAddress");

      await expect(
        mediConsent.connect(hospitalA).requestAccess(unauthorizedUser.address, [RecordType.Cardiology])
      ).to.be.revertedWithCustomError(mediConsent, "PatientNotRegistered");

      await expect(
        mediConsent.connect(hospitalA).requestAccess(patient1.address, [])
      ).to.be.revertedWithCustomError(mediConsent, "EmptyRecordTypes");
    });

    it("Should allow patient to grant granular, time-bound consent and emit ConsentGranted", async function () {
      const { mediConsent, hospitalA, patient1 } = await loadFixture(deployMediConsentFixture);

      const currentTime = await time.latest();
      const expiry = currentTime + 3600; // 1 hour from now

      const grantedTypes = [RecordType.Cardiology, RecordType.Pathology];
      await expect(
        mediConsent.connect(patient1).grantConsent(hospitalA.address, grantedTypes, expiry)
      )
        .to.emit(mediConsent, "ConsentGranted")
        .withArgs(patient1.address, hospitalA.address, grantedTypes, expiry, currentTime + 1);

      // Hospital A now has valid access to Cardiology & Pathology
      expect(await mediConsent.checkAccess(patient1.address, hospitalA.address, RecordType.Cardiology)).to.be.true;
      expect(await mediConsent.checkAccess(patient1.address, hospitalA.address, RecordType.Pathology)).to.be.true;

      // Granular verification: checkAccess MUST return false for ungranted types
      expect(await mediConsent.checkAccess(patient1.address, hospitalA.address, RecordType.General)).to.be.false;
      expect(await mediConsent.checkAccess(patient1.address, hospitalA.address, RecordType.Radiology)).to.be.false;
      expect(await mediConsent.checkAccess(patient1.address, hospitalA.address, RecordType.Neurology)).to.be.false;
      expect(await mediConsent.checkAccess(patient1.address, hospitalA.address, RecordType.Oncology)).to.be.false;
    });

    it("Should revert grantConsent for zero address hospital, empty types, unregistered hospital or past expiry", async function () {
      const { mediConsent, patient1, unauthorizedUser, hospitalA } = await loadFixture(deployMediConsentFixture);

      const currentTime = await time.latest();

      await expect(
        mediConsent.connect(patient1).grantConsent(ethers.ZeroAddress, [RecordType.Cardiology], currentTime + 1000)
      ).to.be.revertedWithCustomError(mediConsent, "ZeroAddress");

      await expect(
        mediConsent.connect(patient1).grantConsent(hospitalA.address, [], currentTime + 1000)
      ).to.be.revertedWithCustomError(mediConsent, "EmptyRecordTypes");

      await expect(
        mediConsent.connect(patient1).grantConsent(unauthorizedUser.address, [RecordType.Cardiology], currentTime + 1000)
      ).to.be.revertedWithCustomError(mediConsent, "HospitalNotRegistered");

      await expect(
        mediConsent.connect(patient1).grantConsent(hospitalA.address, [RecordType.Cardiology], currentTime - 10)
      ).to.be.revertedWithCustomError(mediConsent, "InvalidExpiryTimestamp");
    });
  });

  describe("5. Time Manipulation: Consent Expiry", function () {
    it("Should allow access before expiry and strictly deny access after expiry", async function () {
      const { mediConsent, hospitalA, patient1 } = await loadFixture(deployMediConsentFixture);

      const currentTime = await time.latest();
      const expiry = currentTime + 1800; // 30 minutes duration

      await mediConsent.connect(patient1).grantConsent(hospitalA.address, [RecordType.Radiology], expiry);

      // Valid immediately
      expect(await mediConsent.checkAccess(patient1.address, hospitalA.address, RecordType.Radiology)).to.be.true;

      // Advance time past expiry
      await time.increase(1801);

      // Access must now be false
      expect(await mediConsent.checkAccess(patient1.address, hospitalA.address, RecordType.Radiology)).to.be.false;
    });
  });

  describe("6. Revocation Mechanics (Proves Req 1: Blanket Immediate Invalidation)", function () {
    it("Should immediately block access across ALL granted record types upon revocation", async function () {
      const { mediConsent, hospitalA, patient1 } = await loadFixture(deployMediConsentFixture);

      const currentTime = await time.latest();
      const expiry = currentTime + 86400; // 24 hours

      const allGranted = [
        RecordType.General,
        RecordType.Cardiology,
        RecordType.Radiology,
        RecordType.Pathology,
      ];

      // Grant consent across 4 different record types
      await mediConsent.connect(patient1).grantConsent(hospitalA.address, allGranted, expiry);

      // Verify all 4 types are active
      for (const rType of allGranted) {
        expect(await mediConsent.checkAccess(patient1.address, hospitalA.address, rType)).to.be.true;
      }

      // Patient executes blanket revocation
      await expect(mediConsent.connect(patient1).revokeConsent(hospitalA.address))
        .to.emit(mediConsent, "ConsentRevoked")
        .withArgs(patient1.address, hospitalA.address, (await time.latest()) + 1);

      // PROOF (1): revokeConsent blocks access immediately for EVERY record type the hospital had
      for (const rType of allGranted) {
        expect(await mediConsent.checkAccess(patient1.address, hospitalA.address, rType)).to.be.false;
      }

      // Subsequent re-grant test: patient can re-grant consent in the future
      const newExpiry = (await time.latest()) + 3600;
      await mediConsent.connect(patient1).grantConsent(hospitalA.address, [RecordType.General], newExpiry);
      expect(await mediConsent.checkAccess(patient1.address, hospitalA.address, RecordType.General)).to.be.true;
      expect(await mediConsent.checkAccess(patient1.address, hospitalA.address, RecordType.Cardiology)).to.be.false;
    });

    it("Should revert revokeConsent for zero address or unregistered hospital", async function () {
      const { mediConsent, patient1, unauthorizedUser } = await loadFixture(deployMediConsentFixture);

      await expect(
        mediConsent.connect(patient1).revokeConsent(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(mediConsent, "ZeroAddress");

      await expect(
        mediConsent.connect(patient1).revokeConsent(unauthorizedUser.address)
      ).to.be.revertedWithCustomError(mediConsent, "HospitalNotRegistered");
    });
  });

  describe("7. Audit Logging & Proofs (Proves Req 2: logAccess Enforcement)", function () {
    let fixture;

    beforeEach(async function () {
      fixture = await loadFixture(deployMediConsentFixture);

      // Add a record for patient1 (Cardiology)
      await fixture.mediConsent.connect(fixture.hospitalA).addRecord(
        fixture.patient1.address,
        RecordType.Cardiology,
        MOCK_IPFS_CID,
        MOCK_RECORD_HASH
      );
    });

    it("Should allow authorized hospital to log access and emit RecordAccessed", async function () {
      const { mediConsent, hospitalA, patient1 } = fixture;

      // Grant consent
      const expiry = (await time.latest()) + 3600;
      await mediConsent.connect(patient1).grantConsent(hospitalA.address, [RecordType.Cardiology], expiry);

      // Log access
      await expect(mediConsent.connect(hospitalA).logAccess(patient1.address, 1))
        .to.emit(mediConsent, "RecordAccessed")
        .withArgs(1, patient1.address, hospitalA.address, (await time.latest()) + 1);
    });

    it("PROOF (2a): Should revert logAccess if hospital does NOT have valid consent", async function () {
      const { mediConsent, hospitalA, patient1 } = fixture;

      // Hospital A has NOT been granted consent yet
      await expect(
        mediConsent.connect(hospitalA).logAccess(patient1.address, 1)
      ).to.be.revertedWithCustomError(mediConsent, "AccessUnauthorized")
        .withArgs(patient1.address, hospitalA.address, RecordType.Cardiology);
    });

    it("PROOF (2b): Should revert logAccess if consent has EXPIRED", async function () {
      const { mediConsent, hospitalA, patient1 } = fixture;

      // Grant consent for 500 seconds
      const expiry = (await time.latest()) + 500;
      await mediConsent.connect(patient1).grantConsent(hospitalA.address, [RecordType.Cardiology], expiry);

      // Fast forward past expiry
      await time.increase(501);

      await expect(
        mediConsent.connect(hospitalA).logAccess(patient1.address, 1)
      ).to.be.revertedWithCustomError(mediConsent, "AccessUnauthorized")
        .withArgs(patient1.address, hospitalA.address, RecordType.Cardiology);
    });

    it("PROOF (2c): Should revert logAccess if caller is a NON-HOSPITAL caller", async function () {
      const { mediConsent, patient1, unauthorizedUser } = fixture;

      // Regular user/attacker attempts to call logAccess
      await expect(
        mediConsent.connect(unauthorizedUser).logAccess(patient1.address, 1)
      ).to.be.revertedWithCustomError(mediConsent, "AccessControlUnauthorizedAccount");

      // Even the patient cannot call logAccess directly
      await expect(
        mediConsent.connect(patient1).logAccess(patient1.address, 1)
      ).to.be.revertedWithCustomError(mediConsent, "AccessControlUnauthorizedAccount");
    });

    it("Should revert logAccess if record does not exist or patient mismatch occurs", async function () {
      const { mediConsent, hospitalA, patient1, patient2 } = fixture;

      const expiry = (await time.latest()) + 3600;
      await mediConsent.connect(patient1).grantConsent(hospitalA.address, [RecordType.Cardiology], expiry);

      // Non-existent record ID
      await expect(
        mediConsent.connect(hospitalA).logAccess(patient1.address, 999)
      ).to.be.revertedWithCustomError(mediConsent, "RecordDoesNotExist")
        .withArgs(999);

      // Patient mismatch (record 1 belongs to patient 1, not patient 2)
      await expect(
        mediConsent.connect(hospitalA).logAccess(patient2.address, 1)
      ).to.be.revertedWithCustomError(mediConsent, "PatientMismatch")
        .withArgs(1, patient2.address);
    });
  });

  describe("8. Tamper Detection (verifyRecord)", function () {
    it("Should return true for original hash and false for tampered hash", async function () {
      const { mediConsent, hospitalA, patient1 } = await loadFixture(deployMediConsentFixture);

      await mediConsent.connect(hospitalA).addRecord(
        patient1.address,
        RecordType.Neurology,
        MOCK_IPFS_CID,
        MOCK_RECORD_HASH
      );

      // Original hash matches
      expect(await mediConsent.verifyRecord(1, MOCK_RECORD_HASH)).to.be.true;

      // Tampered/modified hash fails
      expect(await mediConsent.verifyRecord(1, TAMPERED_RECORD_HASH)).to.be.false;
    });

    it("Should revert verifyRecord for non-existent record ID", async function () {
      const { mediConsent } = await loadFixture(deployMediConsentFixture);
      await expect(
        mediConsent.verifyRecord(404, MOCK_RECORD_HASH)
      ).to.be.revertedWithCustomError(mediConsent, "RecordDoesNotExist")
        .withArgs(404);
    });
  });
});

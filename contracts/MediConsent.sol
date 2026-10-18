// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MediConsent
 * @notice Patient-controlled, consent-based medical record sharing platform.
 * @dev Enforces granular, time-bound consent and immutable on-chain audit trails
 *      without ever storing Protected Health Information (PHI) on-chain.
 */
contract MediConsent is AccessControl, ReentrancyGuard {
    // --- Roles ---
    bytes32 public constant HOSPITAL_ROLE = keccak256("HOSPITAL_ROLE");
    bytes32 public constant PATIENT_ROLE = keccak256("PATIENT_ROLE");

    // --- Record Types Enum ---
    enum RecordType {
        General,
        Cardiology,
        Radiology,
        Pathology,
        Neurology,
        Oncology
    }

    // --- Data Structures ---
    struct MedicalRecord {
        uint256 id;
        address patient;
        address hospital;
        RecordType recordType;
        string ipfsCid;
        bytes32 recordHash;
        uint256 timestamp;
        bool exists;
    }

    struct HospitalInfo {
        string name;
        string rsaPublicKey;
        bool isRegistered;
    }

    // --- State Variables ---
    uint256 private _nextRecordId;

    mapping(address => bool) public isPatientRegistered;
    mapping(address => HospitalInfo) public hospitals;
    mapping(uint256 => MedicalRecord) public records;
    mapping(address => uint256[]) private _patientRecordIds;

    // patient => hospital => recordType => expiryTimestamp
    mapping(address => mapping(address => mapping(RecordType => uint256))) public consentExpiry;

    // patient => hospital => recordType => grantedAtTimestamp
    mapping(address => mapping(address => mapping(RecordType => uint256))) public consentGrantedAt;

    // patient => hospital => lastRevokedTimestamp (allows O(1) blanket revocation)
    mapping(address => mapping(address => uint256)) public lastRevokedTimestamp;

    // patient => RSA public key for AES key wrapping (on-chain PKI)
    mapping(address => string) public patientPublicKeys;

    // --- Custom Errors ---
    error ZeroAddress();
    error EmptyString(string param);
    error EmptyRecordTypes();
    error PatientAlreadyRegistered(address patient);
    error PatientNotRegistered(address patient);
    error HospitalAlreadyRegistered(address hospital);
    error HospitalNotRegistered(address hospital);
    error RecordDoesNotExist(uint256 recordId);
    error PatientMismatch(uint256 recordId, address expectedPatient);
    error InvalidExpiryTimestamp(uint256 expiry, uint256 currentTimestamp);
    error AccessUnauthorized(address patient, address hospital, RecordType recordType);

    // --- Events ---
    event PatientRegistered(address indexed patient, uint256 timestamp);
    event PatientKeyUpdated(address indexed patient, uint256 timestamp);
    event HospitalRegistered(address indexed hospital, string name, string rsaPublicKey, uint256 timestamp);
    event RecordAdded(
        uint256 indexed recordId,
        address indexed patient,
        address indexed hospital,
        RecordType recordType,
        string ipfsCid,
        bytes32 recordHash,
        uint256 timestamp
    );
    event AccessRequested(
        address indexed patient,
        address indexed hospital,
        RecordType[] recordTypes,
        uint256 timestamp
    );
    event ConsentGranted(
        address indexed patient,
        address indexed hospital,
        RecordType[] recordTypes,
        uint256 expiryTimestamp,
        uint256 timestamp
    );
    event ConsentRevoked(
        address indexed patient,
        address indexed hospital,
        uint256 timestamp
    );
    event RecordAccessed(
        uint256 indexed recordId,
        address indexed patient,
        address indexed hospital,
        uint256 timestamp
    );

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _nextRecordId = 1;
    }

    // ================================================================
    //                     REGISTRATION FUNCTIONS
    // ================================================================

    /**
     * @notice Allows a user to self-register as a patient.
     */
    function registerPatient() external {
        if (isPatientRegistered[msg.sender]) {
            revert PatientAlreadyRegistered(msg.sender);
        }

        isPatientRegistered[msg.sender] = true;
        _grantRole(PATIENT_ROLE, msg.sender);

        emit PatientRegistered(msg.sender, block.timestamp);
    }

    /**
     * @notice Allows a registered patient to set or update their RSA public key on-chain.
     * @param rsaPublicKey Base64-encoded SPKI RSA public key for AES key wrapping.
     */
    function setPatientPublicKey(string calldata rsaPublicKey) external onlyRole(PATIENT_ROLE) {
        if (bytes(rsaPublicKey).length == 0) revert EmptyString("rsaPublicKey");

        patientPublicKeys[msg.sender] = rsaPublicKey;

        emit PatientKeyUpdated(msg.sender, block.timestamp);
    }

    /**
     * @notice Allows contract admin to register a verified hospital with its public key.
     * @param hospital The address of the hospital.
     * @param name The legal name or identifier of the hospital.
     * @param rsaPublicKey The RSA public key used for client-side AES key wrapping.
     */
    function registerHospital(
        address hospital,
        string calldata name,
        string calldata rsaPublicKey
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (hospital == address(0)) revert ZeroAddress();
        if (bytes(name).length == 0) revert EmptyString("name");
        if (bytes(rsaPublicKey).length == 0) revert EmptyString("rsaPublicKey");
        if (hospitals[hospital].isRegistered) revert HospitalAlreadyRegistered(hospital);

        hospitals[hospital] = HospitalInfo({
            name: name,
            rsaPublicKey: rsaPublicKey,
            isRegistered: true
        });

        _grantRole(HOSPITAL_ROLE, hospital);

        emit HospitalRegistered(hospital, name, rsaPublicKey, block.timestamp);
    }

    /**
     * @notice Allows contract admin to update an existing hospital's name or public key.
     * @param hospital The address of the hospital.
     * @param name The new legal name or identifier.
     * @param rsaPublicKey The new RSA public key for AES key wrapping.
     */
    function updateHospital(
        address hospital,
        string calldata name,
        string calldata rsaPublicKey
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!hospitals[hospital].isRegistered) revert HospitalNotRegistered(hospital);
        if (bytes(name).length == 0) revert EmptyString("name");
        if (bytes(rsaPublicKey).length == 0) revert EmptyString("rsaPublicKey");

        hospitals[hospital].name = name;
        hospitals[hospital].rsaPublicKey = rsaPublicKey;

        emit HospitalRegistered(hospital, name, rsaPublicKey, block.timestamp);
    }

    // ================================================================
    //                    RECORD MANAGEMENT FUNCTIONS
    // ================================================================

    /**
     * @notice Allows a registered hospital to add a medical record for a registered patient.
     * @param patient The target patient address.
     * @param recordType The category of the medical record (enum RecordType).
     * @param ipfsCid The IPFS CID pointing to the client-side encrypted record.
     * @param recordHash SHA-256 integrity hash of the raw record file.
     * @return recordId Unique identifier of the created record.
     */
    function addRecord(
        address patient,
        RecordType recordType,
        string calldata ipfsCid,
        bytes32 recordHash
    ) external onlyRole(HOSPITAL_ROLE) returns (uint256 recordId) {
        if (patient == address(0)) revert ZeroAddress();
        if (!isPatientRegistered[patient]) revert PatientNotRegistered(patient);
        if (bytes(ipfsCid).length == 0) revert EmptyString("ipfsCid");
        if (recordHash == bytes32(0)) revert EmptyString("recordHash");

        recordId = _nextRecordId++;

        records[recordId] = MedicalRecord({
            id: recordId,
            patient: patient,
            hospital: msg.sender,
            recordType: recordType,
            ipfsCid: ipfsCid,
            recordHash: recordHash,
            timestamp: block.timestamp,
            exists: true
        });

        _patientRecordIds[patient].push(recordId);

        emit RecordAdded(
            recordId,
            patient,
            msg.sender,
            recordType,
            ipfsCid,
            recordHash,
            block.timestamp
        );
    }

    /**
     * @notice Returns record details by record ID.
     * @param recordId Unique ID of the record.
     */
    function getRecord(uint256 recordId) external view returns (MedicalRecord memory) {
        if (!records[recordId].exists) revert RecordDoesNotExist(recordId);
        return records[recordId];
    }

    /**
     * @notice Returns array of all record IDs belonging to a patient.
     * @param patient Address of the patient.
     */
    function getPatientRecordIds(address patient) external view returns (uint256[] memory) {
        if (!isPatientRegistered[patient]) revert PatientNotRegistered(patient);
        return _patientRecordIds[patient];
    }

    // ================================================================
    //               ACCESS REQUEST & CONSENT MANAGEMENT
    // ================================================================

    /**
     * @notice Allows a registered hospital to request access to specific record types.
     * @param patient Target patient address.
     * @param recordTypes Array of requested record types.
     */
    function requestAccess(
        address patient,
        RecordType[] calldata recordTypes
    ) external onlyRole(HOSPITAL_ROLE) {
        if (patient == address(0)) revert ZeroAddress();
        if (!isPatientRegistered[patient]) revert PatientNotRegistered(patient);
        if (recordTypes.length == 0) revert EmptyRecordTypes();

        emit AccessRequested(patient, msg.sender, recordTypes, block.timestamp);
    }

    /**
     * @notice Allows a patient to grant time-limited consent to a hospital for specific record types.
     * @param hospital Target hospital address.
     * @param recordTypes Categories of records to grant access to.
     * @param expiryTimestamp Timestamp after which consent is invalid.
     */
    function grantConsent(
        address hospital,
        RecordType[] calldata recordTypes
    ,
        uint256 expiryTimestamp
    ) external onlyRole(PATIENT_ROLE) {
        if (hospital == address(0)) revert ZeroAddress();
        if (!hospitals[hospital].isRegistered) revert HospitalNotRegistered(hospital);
        if (recordTypes.length == 0) revert EmptyRecordTypes();
        if (expiryTimestamp <= block.timestamp) {
            revert InvalidExpiryTimestamp(expiryTimestamp, block.timestamp);
        }

        for (uint256 i = 0; i < recordTypes.length; i++) {
            consentExpiry[msg.sender][hospital][recordTypes[i]] = expiryTimestamp;
            consentGrantedAt[msg.sender][hospital][recordTypes[i]] = block.timestamp;
        }

        emit ConsentGranted(
            msg.sender,
            hospital,
            recordTypes,
            expiryTimestamp,
            block.timestamp
        );
    }

    /**
     * @notice Allows a patient to revoke all active consent for a given hospital at any time.
     * @dev Sets lastRevokedTimestamp to current block timestamp in O(1) gas.
     * @param hospital Target hospital address whose consent is revoked.
     */
    function revokeConsent(address hospital) external onlyRole(PATIENT_ROLE) {
        if (hospital == address(0)) revert ZeroAddress();
        if (!hospitals[hospital].isRegistered) revert HospitalNotRegistered(hospital);

        lastRevokedTimestamp[msg.sender][hospital] = block.timestamp;

        emit ConsentRevoked(msg.sender, hospital, block.timestamp);
    }

    // ================================================================
    //                   VERIFICATION & AUDIT LOGGING
    // ================================================================

    /**
     * @notice Verifies whether a hospital currently holds valid, unexpired, unrevoked consent.
     * @param patient Address of the patient.
     * @param hospital Address of the hospital.
     * @param recordType The category of the record.
     * @return True if consent is currently active and unexpired.
     */
    function checkAccess(
        address patient,
        address hospital,
        RecordType recordType
    ) public view returns (bool) {
        uint256 expiry = consentExpiry[patient][hospital][recordType];
        uint256 grantedAt = consentGrantedAt[patient][hospital][recordType];
        uint256 revokedAt = lastRevokedTimestamp[patient][hospital];

        return (expiry > block.timestamp && grantedAt > revokedAt);
    }

    /**
     * @notice Logs hospital access to a patient record, verifying active consent beforehand.
     * @dev Emits immutable RecordAccessed event. Callable only by authorized hospital.
     * @param patient Address of the patient.
     * @param recordId Unique ID of the record being accessed.
     */
    function logAccess(
        address patient,
        uint256 recordId
    ) external onlyRole(HOSPITAL_ROLE) nonReentrant {
        if (!records[recordId].exists) revert RecordDoesNotExist(recordId);
        if (records[recordId].patient != patient) {
            revert PatientMismatch(recordId, patient);
        }

        RecordType rType = records[recordId].recordType;
        if (!checkAccess(patient, msg.sender, rType)) {
            revert AccessUnauthorized(patient, msg.sender, rType);
        }

        emit RecordAccessed(recordId, patient, msg.sender, block.timestamp);
    }

    /**
     * @notice Verifies whether a provided hash matches the record hash stored on-chain.
     * @param recordId Unique ID of the record.
     * @param hash SHA-256 hash to verify against.
     * @return True if hashes match exactly.
     */
    function verifyRecord(
        uint256 recordId,
        bytes32 hash
    ) external view returns (bool) {
        if (!records[recordId].exists) revert RecordDoesNotExist(recordId);
        return records[recordId].recordHash == hash;
    }
}

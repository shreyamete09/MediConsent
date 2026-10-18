const fs = require("fs");
const path = require("path");

const artifactPath = path.join(__dirname, "../artifacts/contracts/MediConsent.sol/MediConsent.json");
if (!fs.existsSync(artifactPath)) {
  console.error("Artifact not found at:", artifactPath);
  process.exit(1);
}

const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const targetDir = path.join(__dirname, "../frontend/src/contracts");

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

// 1. Write standalone ABI JSON
fs.writeFileSync(
  path.join(targetDir, "MediConsentAbi.json"),
  JSON.stringify(artifact.abi, null, 2)
);

// 2. Read deployed address
const deployedJsonPath = path.join(__dirname, "../deployments/hardhat_31337.json");
let localAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
if (fs.existsSync(deployedJsonPath)) {
  const d = JSON.parse(fs.readFileSync(deployedJsonPath, "utf8"));
  localAddress = d.contractAddress;
}

const addressesJs = `// Auto-generated contract deployment mappings
export const CONTRACT_ADDRESSES = {
  // Hardhat Local Node (Chain ID 31337)
  31337: "${localAddress}",
  // Polygon Amoy Testnet (Chain ID 80002)
  80002: "${localAddress}",
};

export const DEFAULT_CONTRACT_ADDRESS = "${localAddress}";
`;

fs.writeFileSync(path.join(targetDir, "addresses.js"), addressesJs);
console.log("Successfully exported ABI and contract addresses to frontend/src/contracts/");

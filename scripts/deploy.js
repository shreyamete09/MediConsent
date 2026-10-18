const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();

  console.log("====================================================");
  console.log("Deploying MediConsent Contract...");
  console.log(`Network: ${network.name} (Chain ID: ${network.chainId})`);
  console.log(`Deployer Address: ${deployer.address}`);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Deployer Balance: ${hre.ethers.formatEther(balance)} native tokens`);
  console.log("====================================================");

  // Deploy MediConsent
  const MediConsent = await hre.ethers.getContractFactory("MediConsent");
  const mediConsent = await MediConsent.deploy();
  await mediConsent.waitForDeployment();

  const contractAddress = await mediConsent.getAddress();
  console.log(`\n>>> MediConsent successfully deployed to: ${contractAddress}`);

  // Seed sample data if running on local hardhat or localhost network
  if (network.chainId === 31337n || network.chainId === 1337n) {
    console.log("\n[Dev Mode] Seeding local network with test hospital and patient...");
    const signers = await hre.ethers.getSigners();
    if (signers.length > 2) {
      const hospitalSigner = signers[1];
      const patientSigner = signers[2];

      const sampleRSAKey = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0...\n-----END PUBLIC KEY-----";

      // Admin registers hospital
      const regHospTx = await mediConsent.registerHospital(
        hospitalSigner.address,
        "City Memorial Hospital (Local Dev)",
        sampleRSAKey
      );
      await regHospTx.wait();
      console.log(`[Dev Mode] Registered Hospital: ${hospitalSigner.address}`);

      // Patient self-registers
      const regPatTx = await mediConsent.connect(patientSigner).registerPatient();
      await regPatTx.wait();
      console.log(`[Dev Mode] Registered Patient: ${patientSigner.address}`);
    }
  }

  // Export deployment info to json
  const deploymentData = {
    network: network.name,
    chainId: Number(network.chainId),
    contractAddress: contractAddress,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };

  const outputDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, `${network.name || "network"}_${network.chainId}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(deploymentData, null, 2));
  console.log(`\nDeployment manifest saved to: ${outputPath}`);

  // ── Auto-Sync Address to backend/.env ────────────────────────────────────────
  try {
    const backendEnvPath = path.resolve(__dirname, "../backend/.env");
    if (fs.existsSync(backendEnvPath)) {
      let envContent = fs.readFileSync(backendEnvPath, "utf8");
      if (envContent.includes("CONTRACT_ADDRESS=")) {
        envContent = envContent.replace(/CONTRACT_ADDRESS=0x[a-fA-F0-9]{40}/, `CONTRACT_ADDRESS=${contractAddress}`);
      } else {
        envContent += `\nCONTRACT_ADDRESS=${contractAddress}\n`;
      }
      fs.writeFileSync(backendEnvPath, envContent, "utf8");
      console.log(`✔ Auto-synced CONTRACT_ADDRESS to backend/.env: ${contractAddress}`);
    }
  } catch (err) {
    console.warn("Could not auto-sync to backend/.env:", err.message);
  }

  // ── Auto-Sync ABI & Address to frontend/src/contracts/ ─────────────────────
  try {
    const frontendContractsDir = path.resolve(__dirname, "../frontend/src/contracts");
    fs.mkdirSync(frontendContractsDir, { recursive: true });

    // Copy ABI
    const artifactPath = path.resolve(__dirname, "../artifacts/contracts/MediConsent.sol/MediConsent.json");
    if (fs.existsSync(artifactPath)) {
      const art = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
      fs.writeFileSync(
        path.join(frontendContractsDir, "MediConsentAbi.json"),
        JSON.stringify(art.abi, null, 2),
        "utf8"
      );
    }

    // Write addresses.js
    const addressesJs = `// Auto-generated contract deployment mappings
export const CONTRACT_ADDRESSES = {
  31337: "${contractAddress}",
  80002: "${contractAddress}",
};

export const DEFAULT_CONTRACT_ADDRESS = "${contractAddress}";
`;
    fs.writeFileSync(path.join(frontendContractsDir, "addresses.js"), addressesJs, "utf8");
    console.log(`✔ Auto-synced ABI & addresses to frontend/src/contracts/`);
  } catch (err) {
    console.warn("Could not auto-sync to frontend:", err.message);
  }

  console.log("====================================================");

  return mediConsent;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });

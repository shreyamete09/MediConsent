const hre = require("hardhat");

async function main() {
  const contractAddress = process.env.DEPLOYED_CONTRACT_ADDRESS;

  if (!contractAddress) {
    console.error("Please set DEPLOYED_CONTRACT_ADDRESS in your .env or command line.");
    process.exit(1);
  }

  console.log(`Verifying MediConsent contract at ${contractAddress} on Polygonscan...`);

  try {
    await hre.run("verify:verify", {
      address: contractAddress,
      constructorArguments: [],
    });
    console.log("Contract successfully verified on Polygonscan!");
  } catch (error) {
    if (error.message.toLowerCase().includes("already verified")) {
      console.log("Contract is already verified on Polygonscan.");
    } else {
      console.error("Verification error:", error);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

// Reports the deployer address, its balance, and RPC reachability for the
// configured network. Never prints the private key.
//
//   npx hardhat run scripts/check-account.ts --network sepolia
import { ethers, network } from "hardhat";

async function main() {
  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    console.log("No signer configured for this network.");
    return;
  }
  const [signer] = signers;
  const addr = await signer.getAddress();

  const net = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(addr);
  const block = await ethers.provider.getBlockNumber();

  console.log(`network   : ${network.name} (chainId ${net.chainId})`);
  console.log(`block     : ${block}`);
  console.log(`deployer  : ${addr}`);
  console.log(`balance   : ${ethers.formatEther(balance)} ETH`);

  // A deploy of three contracts with viaIR + FHE init costs meaningfully more
  // than a plain deployment. Flag anything under a comfortable margin.
  const MIN = ethers.parseEther("0.05");
  if (balance === 0n) {
    console.log("\nEMPTY — fund this address with Sepolia ETH before deploying.");
  } else if (balance < MIN) {
    console.log(
      `\nLOW — under 0.05 ETH. FHE deployments are gas-heavy; top up before deploying.`
    );
  } else {
    console.log("\nOK — sufficient balance to deploy.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

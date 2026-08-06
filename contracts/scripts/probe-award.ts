// Re-runs the last awardDraw as a static call to surface the revert reason,
// which eth_estimateGas swallows.
import { ethers, fhevm, deployments } from "hardhat";

async function main() {
  await fhevm.initializeCLIApi();
  const poolD = await deployments.get("ConfidentialPrizePool");
  const pool = await ethers.getContractAt("ConfidentialPrizePool", poolD.address);

  // The epoch that was just closed is the one before the current open one.
  const epochId = (await pool.epoch()) - 1n;
  const totalHandle = await pool.pendingTotalHandle(epochId);
  const randHandle = await pool.pendingRandomHandle(epochId);
  console.log(`probing epoch ${epochId}`);

  const instance = await fhevm.createInstance();
  const dec = (await instance.publicDecrypt([totalHandle, randHandle])) as {
    clearValues: Record<string, bigint | boolean>;
    abiEncodedClearValues: string;
    decryptionProof: string;
  };
  console.log(`total = ${dec.clearValues[totalHandle]}`);
  console.log(`rand  = ${dec.clearValues[randHandle]}`);

  try {
    await pool.awardDraw.staticCall(
      epochId,
      dec.abiEncodedClearValues,
      dec.decryptionProof
    );
    console.log("staticCall SUCCEEDED — awardDraw would go through");
  } catch (e) {
    const err = e as { data?: string; message?: string };
    console.log(`\nrevert data: ${err.data ?? "(none)"}`);
    try {
      const parsed = pool.interface.parseError(err.data ?? "0x");
      console.log(`decoded    : ${parsed?.name}(${parsed?.args})`);
      console.log(
        `\nNote: checkSignatures runs BEFORE this check in awardDraw, so ` +
          `reaching it means the KMS proof verified on-chain.`
      );
    } catch {
      console.log(`could not decode: ${err.message?.slice(0, 200)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

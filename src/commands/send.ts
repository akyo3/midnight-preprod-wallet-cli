// Displays CLI progress for transfers implemented by the wallet service.
import { transfer, type TransferOutput } from "../wallet-service";

export async function sendCommand(seed: Buffer, outputs: TransferOutput[]) {
  console.log("Syncing before building, signing, proving, and finalizing the transfer...");
  const identifier = await transfer(seed, outputs);
  console.log("Transfer finalized. Identifier:", identifier);
}

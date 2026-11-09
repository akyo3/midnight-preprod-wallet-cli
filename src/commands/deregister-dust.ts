import { updateDustRegistration } from "../wallet-service";

export async function deregisterDustCommand(seed: Buffer) {
  console.log("Syncing...");
  const identifier = await updateDustRegistration(seed, "deregister");
  if (!identifier) {
    console.log("No available NIGHT UTxOs are registered for DUST generation.");
    return;
  }
  console.log("DUST registration removed. Identifier:", identifier);
}

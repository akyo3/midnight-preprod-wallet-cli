// Registers available NIGHT UTxOs for DUST generation.
import { updateDustRegistration } from "../wallet-service";

export async function registerDustCommand(seed: Buffer) {
  console.log("Syncing...");
  const identifier = await updateDustRegistration(seed, "register");
  if (!identifier) {
    console.log("All available NIGHT UTxOs are already registered.");
    return;
  }
  console.log("Registration finalized. Identifier:", identifier);
  console.log("DUST is now accruing from the registered NIGHT UTxOs.");
}

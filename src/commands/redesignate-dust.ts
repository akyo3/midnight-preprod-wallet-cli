import { updateDustRegistration } from "../wallet-service";

export async function redesignateDustCommand(seed: Buffer, receiver: string) {
  console.log("Syncing...");
  const identifier = await updateDustRegistration(seed, "redesignate", receiver);
  if (!identifier) {
    console.log("No available NIGHT UTxOs are registered for DUST generation.");
    return;
  }
  console.log("DUST generation destination changed. Identifier:", identifier);
}

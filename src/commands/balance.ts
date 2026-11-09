// Synchronizes and prints wallet balances.
import * as ledger from "@midnight-ntwrk/ledger-v8";
import { formatUnits } from "../amounts";
import { buildWallet, startAndSync, stopWallet } from "../wallet";

export async function balanceCommand(seed: Buffer) {
  const bundle = await buildWallet(seed);
  try {
    console.log("Syncing with Preprod... (first sync can take a minute)");
    const state = await startAndSync(bundle, { waitForShielded: true });

    const night = state.unshielded.balances[ledger.unshieldedToken().raw] ?? 0n;
    const dust = state.dust.balance(new Date());
    const registeredUtxos = state.unshielded.totalCoins.filter(
      (coin) => coin.meta.registeredForDustGeneration,
    ).length;
    const shieldedTokens = Object.entries(state.shielded.balances).filter(
      ([, amount]) => amount > 0n,
    );

    console.log("=== Balances ===");
    console.log(`NIGHT: ${formatUnits(night, 6)} (${night} micro)`);
    console.log(`DUST: ${formatUnits(dust, 15)} (${dust} specks)`);
    console.log(`Unshielded UTxOs: ${state.unshielded.availableCoins.length}`);
    console.log(`DUST-registered NIGHT UTxOs: ${registeredUtxos}`);
    console.log("Shielded tokens:");
    if (shieldedTokens.length === 0) console.log("  none");
    for (const [tokenType, amount] of shieldedTokens) {
      console.log(`  ${tokenType}: ${amount} base units`);
    }
  } finally {
    await stopWallet(bundle);
  }
}

// Derives the three independent wallet roles from one master seed.
import { HDWallet, Roles } from "@midnight-ntwrk/wallet-sdk";

export type WalletRoleSeeds = {
  shielded: Uint8Array;
  unshielded: Uint8Array;
  dust: Uint8Array;
};

export function deriveWalletRoleSeeds(masterSeed: Uint8Array): WalletRoleSeeds {
  const result = HDWallet.fromSeed(masterSeed);
  if (result.type !== "seedOk") {
    throw new Error("The wallet seed cannot be used for HD key derivation.");
  }

  const account = result.hdWallet.selectAccount(0);
  const derive = (role: typeof Roles[keyof typeof Roles]) => {
    const key = account.selectRole(role).deriveKeyAt(0);
    if (key.type === "keyOutOfBounds") {
      throw new Error("The requested wallet derivation path is out of bounds.");
    }
    return Uint8Array.from(key.key);
  };

  try {
    return {
      shielded: derive(Roles.Zswap),
      unshielded: derive(Roles.NightExternal),
      dust: derive(Roles.Dust),
    };
  } finally {
    result.hdWallet.clear();
  }
}

export function clearWalletRoleSeeds(seeds: WalletRoleSeeds): void {
  seeds.shielded.fill(0);
  seeds.unshielded.fill(0);
  seeds.dust.fill(0);
}

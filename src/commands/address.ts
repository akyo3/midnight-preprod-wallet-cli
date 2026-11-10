// Derives and prints addresses without connecting to the network.
import {
  PublicKey,
  DustAddress,
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from "@midnightntwrk/wallet-sdk";
import { NETWORK_ID } from "../config";
import { createWalletKeys } from "../wallet";

type WalletAddresses = {
  unshielded: string;
  shielded: string;
  dust: string;
};

export function deriveWalletAddresses(seed: Buffer): WalletAddresses {
  const keys = createWalletKeys(seed);
  try {
    const shieldedAddress = new ShieldedAddress(
      new ShieldedCoinPublicKey(
        Buffer.from(keys.zswapSecretKeys.coinPublicKey, "hex"),
      ),
      new ShieldedEncryptionPublicKey(
        Buffer.from(keys.zswapSecretKeys.encryptionPublicKey, "hex"),
      ),
    );

    return {
      unshielded: PublicKey.fromKeyStore(keys.keystore).address,
      shielded: MidnightBech32m.encode(NETWORK_ID, shieldedAddress).asString(),
      dust: MidnightBech32m.encode(
        NETWORK_ID,
        new DustAddress(keys.dustSecretKey.publicKey),
      ).asString(),
    };
  } finally {
    keys.clearKeystoreSecret();
  }
}

export function addressCommand(seed: Buffer): void {
  const addresses = deriveWalletAddresses(seed);
  console.log("=== Your Addresses ===");
  console.log("Unshielded:", addresses.unshielded);
  console.log("Shielded:  ", addresses.shielded);
  console.log("DUST:      ", addresses.dust);
}

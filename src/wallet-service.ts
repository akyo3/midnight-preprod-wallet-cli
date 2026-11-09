import * as ledger from "@midnight-ntwrk/ledger-v8";
import {
  DustAddress,
  MidnightBech32m,
  ShieldedAddress,
  UnshieldedAddress,
  type CombinedTokenTransfer,
} from "@midnight-ntwrk/wallet-sdk";
import { bech32m } from "@scure/base";
import { NETWORK_ID } from "./config";
import { buildWallet, startAndSync, stopWallet, submitWithRetry } from "./wallet";

export type TransferOutput =
  | { kind: "shielded"; recipient: string; tokenType: string; amount: bigint }
  | { kind: "unshielded"; recipient: string; amount: bigint };

const transactionTtl = () => new Date(Date.now() + 10 * 60 * 1000);

function normalizeTokenType(value: string): string {
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error("Token type must be exactly 64 hexadecimal characters.");
  }
  return value.toLowerCase();
}

function parseAddress(value: string) {
  try {
    return MidnightBech32m.parse(value);
  } catch {
    throw new Error(`Invalid Midnight address: ${value}`);
  }
}

export function decodeShieldedAddress(value: string): ShieldedAddress {
  try {
    // @scure/base 2.4 defaults to BIP-173's 90-character limit, while a Midnight
    // shielded address is longer. Disable only that length limit; the codec still
    // validates the checksum, address kind, payload, and network below.
    const decoded = bech32m.decodeToBytes(value, false);
    const [prefix, type, network] = decoded.prefix.split("_");
    if (prefix !== "mn" || !type || network !== NETWORK_ID) throw new Error();
    return new MidnightBech32m(type, network, Buffer.from(decoded.bytes)).decode(
      ShieldedAddress,
      NETWORK_ID,
    );
  } catch {
    throw new Error(`Expected a shielded address for ${NETWORK_ID}: ${value}`);
  }
}

function decodeUnshieldedAddress(value: string): UnshieldedAddress {
  try {
    return parseAddress(value).decode(UnshieldedAddress, NETWORK_ID);
  } catch {
    throw new Error(`Expected an unshielded address for ${NETWORK_ID}: ${value}`);
  }
}

function decodeDustAddress(value: string): DustAddress {
  try {
    return parseAddress(value).decode(DustAddress, NETWORK_ID);
  } catch {
    throw new Error(`Expected a DUST address for ${NETWORK_ID}: ${value}`);
  }
}

export function createTokenTransfers(outputs: TransferOutput[]): CombinedTokenTransfer[] {
  return outputs.map((output): CombinedTokenTransfer => {
    if (output.kind === "shielded") {
      return {
        type: "shielded",
        outputs: [
          {
            amount: output.amount,
            receiverAddress: decodeShieldedAddress(output.recipient),
            type: normalizeTokenType(output.tokenType),
          },
        ],
      };
    }
    return {
      type: "unshielded",
      outputs: [
        {
          amount: output.amount,
          receiverAddress: decodeUnshieldedAddress(output.recipient),
          type: ledger.unshieldedToken().raw,
        },
      ],
    };
  });
}

type TransferBalances = {
  shielded: { balances: Record<string, bigint> };
  unshielded: { balances: Record<string, bigint> };
};

export function assertSufficientBalances(
  state: TransferBalances,
  outputs: readonly TransferOutput[],
): void {
  const required = new Map<string, bigint>();
  for (const output of outputs) {
    const tokenType =
      output.kind === "shielded"
        ? normalizeTokenType(output.tokenType)
        : ledger.unshieldedToken().raw;
    const key = `${output.kind}:${tokenType}`;
    required.set(key, (required.get(key) ?? 0n) + output.amount);
  }

  for (const [key, amount] of required) {
    const [kind, tokenType] = key.split(":") as [TransferOutput["kind"], string];
    const available = state[kind].balances[tokenType] ?? 0n;
    if (available < amount) {
      throw new Error(
        `Insufficient ${kind} funds for token ${tokenType}: ` +
          `need ${amount}, available ${available} base units.`,
      );
    }
  }
}

export async function transfer(seed: Buffer, outputs: TransferOutput[]): Promise<string> {
  if (outputs.length === 0) throw new Error("At least one transfer output is required.");
  for (const output of outputs) {
    if (output.amount <= 0n) throw new Error("Transfer amounts must be greater than zero.");
    if (output.kind === "shielded") normalizeTokenType(output.tokenType);
  }
  const tokenTransfers = createTokenTransfers(outputs);
  const bundle = await buildWallet(seed);
  const { facade, keystore, zswapSecretKeys, dustSecretKey } = bundle;

  let recipe: Awaited<ReturnType<typeof facade.transferTransaction>> | undefined;
  try {
    const state = await startAndSync(bundle, {
      waitForShielded: outputs.some((output) => output.kind === "shielded"),
    });
    assertSufficientBalances(state, outputs);
    recipe = await facade.transferTransaction(
      tokenTransfers,
      { shieldedSecretKeys: zswapSecretKeys, dustSecretKey },
      { ttl: transactionTtl(), payFees: true },
    );
    const signed = await facade.signRecipe(recipe, (payload) => keystore.signData(payload));
    const transaction = await facade.finalizeRecipe(signed);
    return await submitWithRetry(facade, transaction);
  } catch (error) {
    if (recipe) await facade.revert(recipe).catch(() => undefined);
    throw error;
  } finally {
    await stopWallet(bundle);
  }
}

export type DustAction = "register" | "deregister" | "redesignate";

type DustRegistrationCoin = {
  meta: { registeredForDustGeneration: boolean };
};

export function selectDustCoins<T extends DustRegistrationCoin>(
  coins: readonly T[],
  action: DustAction,
): T[] {
  const mustBeRegistered = action !== "register";
  return coins.filter(
    (coin) => coin.meta.registeredForDustGeneration === mustBeRegistered,
  );
}

export function updateDustRegistration(
  seed: Buffer,
  action: Exclude<DustAction, "redesignate">,
): Promise<string | undefined>;
export function updateDustRegistration(
  seed: Buffer,
  action: "redesignate",
  receiver: string,
): Promise<string | undefined>;
export async function updateDustRegistration(
  seed: Buffer,
  action: DustAction,
  receiver?: string,
): Promise<string | undefined> {
  const receiverAddress =
    action === "redesignate" ? decodeDustAddress(receiver ?? "") : undefined;
  const bundle = await buildWallet(seed);
  const { facade, keystore, zswapSecretKeys, dustSecretKey } = bundle;

  let recipe:
    | Awaited<ReturnType<typeof facade.registerNightUtxosForDustGeneration>>
    | undefined;
  try {
    const state = await startAndSync(bundle, { waitForDust: action !== "register" });
    const coins = selectDustCoins(state.unshielded.availableCoins, action);
    if (coins.length === 0) return undefined;

    recipe =
      action === "deregister"
        ? await facade.deregisterFromDustGeneration(
            coins,
            keystore.getPublicKey(),
            (payload) => keystore.signData(payload),
          )
        : await facade.registerNightUtxosForDustGeneration(
            coins,
            keystore.getPublicKey(),
            (payload) => keystore.signData(payload),
            receiverAddress ?? state.dust.address,
          );

    if (action === "register") {
      const transaction = await facade.finalizeRecipe(recipe);
      return await submitWithRetry(facade, transaction);
    }

    const balanced = await facade.balanceUnprovenTransaction(
      recipe.transaction,
      { shieldedSecretKeys: zswapSecretKeys, dustSecretKey },
      { ttl: transactionTtl(), tokenKindsToBalance: ["dust"] },
    );
    const transaction = await facade.finalizeRecipe(balanced);
    return await submitWithRetry(facade, transaction);
  } catch (error) {
    if (recipe) await facade.revert(recipe).catch(() => undefined);
    throw error;
  } finally {
    await stopWallet(bundle);
  }
}

// Builds the wallet facade and synchronizes only the state each command needs.
import { createHash } from "node:crypto";
import * as ledger from "@midnight-ntwrk/ledger-v8";
import {
  WalletFacade,
  ShieldedWallet,
  DustWallet,
  UnshieldedWallet,
  PublicKey,
  createKeystore,
  FacadeState,
  InMemoryTransactionHistoryStorage,
  TransactionHistoryStorage,
} from "@midnight-ntwrk/wallet-sdk";
import * as rx from "rxjs";
import { getNetworkConfig, NETWORK_ID } from "./config";
import { clearWalletRoleSeeds, deriveWalletRoleSeeds } from "./keys";
import { loadDustState, loadWalletState, saveWalletState } from "./wallet-state";

type WalletIdentity = {
  unshieldedPublicKey: string;
  shieldedCoinPublicKey: string;
  shieldedEncryptionPublicKey: string;
  dustPublicKey: bigint;
};

export function stateBelongsToWallet(
  serialized: string | undefined,
  kind: "shielded" | "unshielded" | "dust",
  identity: WalletIdentity,
): boolean {
  if (!serialized) return false;
  try {
    const snapshot = JSON.parse(serialized) as Record<string, unknown>;
    if (snapshot.networkId !== NETWORK_ID) return false;

    if (kind === "unshielded") {
      const publicKey = snapshot.publicKey as Record<string, unknown> | undefined;
      return publicKey?.publicKey === identity.unshieldedPublicKey;
    }
    if (kind === "shielded") {
      const publicKeys = snapshot.publicKeys as Record<string, unknown> | undefined;
      return (
        publicKeys?.coinPublicKey === identity.shieldedCoinPublicKey &&
        publicKeys.encryptionPublicKey === identity.shieldedEncryptionPublicKey
      );
    }

    const publicKey = snapshot.publicKey as Record<string, unknown> | undefined;
    return BigInt(String(publicKey?.publicKey)) === identity.dustPublicKey;
  } catch {
    return false;
  }
}

function acceptSavedState(
  serialized: string | undefined,
  kind: "shielded" | "unshielded" | "dust",
  identity: WalletIdentity,
): string | undefined {
  if (!serialized) return undefined;
  if (stateBelongsToWallet(serialized, kind, identity)) return serialized;
  console.warn(`Ignoring ${kind} checkpoint: it does not belong to the current wallet.`);
  return undefined;
}

export function createWalletKeys(seed: Buffer) {
  const roleSeeds = deriveWalletRoleSeeds(seed);
  const keystoreSecret = Buffer.from(roleSeeds.unshielded);
  let created = false;
  try {
    const keys = {
      zswapSecretKeys: ledger.ZswapSecretKeys.fromSeed(roleSeeds.shielded),
      dustSecretKey: ledger.DustSecretKey.fromSeed(roleSeeds.dust),
      keystore: createKeystore(keystoreSecret, NETWORK_ID),
      clearKeystoreSecret: () => keystoreSecret.fill(0),
    };
    created = true;
    return keys;
  } finally {
    clearWalletRoleSeeds(roleSeeds);
    if (!created) keystoreSecret.fill(0);
  }
}

type WalletKeys = ReturnType<typeof createWalletKeys>;

type SavedWalletStates = {
  shielded?: string;
  unshielded?: string;
  dust?: string;
};

function identifyWallet(keys: WalletKeys): WalletIdentity {
  return {
    unshieldedPublicKey: keys.keystore.getPublicKey(),
    shieldedCoinPublicKey: keys.zswapSecretKeys.coinPublicKey,
    shieldedEncryptionPublicKey: keys.zswapSecretKeys.encryptionPublicKey,
    dustPublicKey: keys.dustSecretKey.publicKey,
  };
}

function walletStateId(dustPublicKey: bigint): string {
  const digest = createHash("sha256").update(String(dustPublicKey)).digest("hex");
  return `${NETWORK_ID}-${digest.slice(0, 16)}`;
}

async function readSavedWalletStates(
  walletId: string,
  identity: WalletIdentity,
): Promise<SavedWalletStates> {
  const [shielded, unshielded, dust, legacyDust] = await Promise.all([
    loadWalletState(walletId, "shielded"),
    loadWalletState(walletId, "unshielded"),
    loadWalletState(walletId, "dust"),
    loadDustState(identity.dustPublicKey),
  ]);

  return {
    shielded: acceptSavedState(shielded, "shielded", identity),
    unshielded: acceptSavedState(unshielded, "unshielded", identity),
    dust: acceptSavedState(dust ?? legacyDust, "dust", identity),
  };
}

function walletConfiguration() {
  const endpoints = getNetworkConfig();
  return {
    networkId: NETWORK_ID,
    indexerClientConnection: {
      indexerHttpUrl: endpoints.indexerHttpUrl,
      indexerWsUrl: endpoints.indexerWsUrl,
    },
    costParameters: {
      additionalFeeOverhead: 300_000_000_000_000n,
      feeBlocksMargin: 5,
    },
    batchUpdates: { size: 100, timeout: 25, spacing: 0 },
    txHistoryStorage: new InMemoryTransactionHistoryStorage(
      TransactionHistoryStorage.TransactionHistoryCommonSchema,
    ),
    provingServerUrl: new URL(endpoints.proofServer),
    relayURL: new URL(endpoints.node),
  };
}

async function initializeFacade(keys: WalletKeys, saved: SavedWalletStates) {
  return WalletFacade.init({
    configuration: walletConfiguration(),
    shielded: (configuration) => {
      const wallet = ShieldedWallet(configuration);
      return saved.shielded
        ? wallet.restore(saved.shielded)
        : wallet.startWithSecretKeys(keys.zswapSecretKeys);
    },
    unshielded: (configuration) => {
      const wallet = UnshieldedWallet(configuration);
      return saved.unshielded
        ? wallet.restore(saved.unshielded)
        : wallet.startWithPublicKey(PublicKey.fromKeyStore(keys.keystore));
    },
    dust: (configuration) => {
      const wallet = DustWallet(configuration);
      if (saved.dust) {
        console.log("Resuming DUST sync from the saved checkpoint.");
        return wallet.restore(saved.dust);
      }
      const parameters = ledger.LedgerParameters.initialParameters().dust;
      return wallet.startWithSecretKey(keys.dustSecretKey, parameters);
    },
  });
}

export async function buildWallet(seed: Buffer) {
  const keys = createWalletKeys(seed);
  try {
    const identity = identifyWallet(keys);
    const walletId = walletStateId(identity.dustPublicKey);
    const saved = await readSavedWalletStates(walletId, identity);
    const facade = await initializeFacade(keys, saved);

    return {
      facade,
      keystore: keys.keystore,
      zswapSecretKeys: keys.zswapSecretKeys,
      dustSecretKey: keys.dustSecretKey,
      walletId,
      clearKeystoreSecret: keys.clearKeystoreSecret,
    };
  } catch (error) {
    keys.clearKeystoreSecret();
    throw error;
  }
}

export async function stopWallet(bundle: Awaited<ReturnType<typeof buildWallet>>) {
  try {
    await bundle.facade.stop();
  } finally {
    bundle.clearKeystoreSecret();
  }
}

type TransactionSubmitter<T> = {
  submitTransaction(transaction: T): Promise<string>;
};

export async function submitWithRetry<T>(
  submitter: TransactionSubmitter<T>,
  transaction: T,
  attempts = 3,
  delayMs = 2_000,
): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await submitter.submitTransaction(transaction);
    } catch (error) {
      if (attempt >= attempts) throw error;
      console.warn(`Submission attempt ${attempt} failed; retrying in ${delayMs}ms.`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Checks the synchronization state required by the current command.
 *
 * Only commands that use shielded balances wait for shielded synchronization.
 * Other commands avoid waiting for trial decryption of every shielded output.
 *
 * A wallet without a DUST registration has no relevant DUST events and may not
 * receive a connected update. An empty DUST state is complete only when no
 * NIGHT UTxO is registered.
 */
function isReallySynced(
  state: FacadeState,
  waitForDust: boolean,
  waitForShielded: boolean,
): boolean {
  const unshieldedOk = state.unshielded.progress.isStrictlyComplete();
  const shieldedOk = !waitForShielded || state.shielded.progress.isStrictlyComplete();
  if (!waitForDust) return unshieldedOk && shieldedOk;

  const dustProgress = state.dust.progress;
  const hasDustRegistration = state.unshielded.totalCoins.some(
    (coin) => coin.meta.registeredForDustGeneration,
  );
  const hasNoDustEvents =
    dustProgress.appliedIndex === 0n && dustProgress.highestRelevantWalletIndex === 0n;
  const dustOk =
    dustProgress.isStrictlyComplete() || (!hasDustRegistration && hasNoDustEvents);

  return unshieldedOk && shieldedOk && dustOk;
}

/**
 * Starts the facade and waits for the selected wallet states to synchronize.
 * Initial DUST registration can skip the global DUST replay with waitForDust.
 * Progress is redrawn every second, and a timeout fails explicitly instead of
 * returning partial state.
 */
export async function startAndSync(
  bundle: Awaited<ReturnType<typeof buildWallet>>,
  options: { waitForDust?: boolean; waitForShielded?: boolean; timeoutMs?: number } = {},
) {
  const waitForDust = options.waitForDust ?? true;
  const waitForShielded = options.waitForShielded ?? false;
  const timeoutMs = options.timeoutMs ?? (waitForDust ? 86_400_000 : 600_000);
  const { facade, zswapSecretKeys, dustSecretKey, walletId } = bundle;
  await facade.start(zswapSecretKeys, dustSecretKey);

  return new Promise<FacadeState>((resolve, reject) => {
    const startedAt = Date.now();
    let lastApplied = 0;
    let lastHighest = 0;
    let dustApplied = 0n;
    let dustHighest = 0n;
    let shieldedApplied = 0n;
    let shieldedHighest = 0n;
    let lastCheckpoint = 0n;
    let latestState: FacadeState | undefined;
    let saveQueue = Promise.resolve();
    let finished = false;

    const saveCheckpoint = () => {
      if (!latestState) return saveQueue;
      const state = latestState;
      saveQueue = saveQueue
        .catch(() => undefined)
        .then(() =>
          Promise.all([
            saveWalletState(walletId, "shielded", state.shielded.serialize()),
            saveWalletState(walletId, "unshielded", state.unshielded.serialize()),
            saveWalletState(walletId, "dust", state.dust.serialize()),
          ]),
        )
        .then(() => undefined);
      return saveQueue;
    };

    const draw = () => {
      const secs = Math.floor((Date.now() - startedAt) / 1000);
      const dustStatus = waitForDust
        ? `; DUST events ${dustApplied}/${dustHighest}`
        : "";
      const shieldedStatus = waitForShielded
        ? `; shielded events ${shieldedApplied}/${shieldedHighest}`
        : "";
      process.stdout.write(
        `\r  syncing... ${Math.min(lastApplied, lastHighest)}/${lastHighest} transactions` +
          `${dustStatus}${shieldedStatus} (${secs}s)`,
      );
    };
    const heartbeat = setInterval(draw, 1000);

    let sub: rx.Subscription | undefined;
    const timeout = setTimeout(async () => {
      if (finished) return;
      finished = true;
      clearInterval(heartbeat);
      sub?.unsubscribe();
      const timeoutError = new Error(
        `Sync timed out after ${timeoutMs / 1000}s. ` +
        (waitForDust
          ? "A first DUST sync replays the global event history and can take several hours."
          : "The NIGHT indexer did not finish syncing."),
      );
      try {
        await saveCheckpoint();
        reject(timeoutError);
      } catch (saveError) {
        reject(new AggregateError([timeoutError, saveError], "Sync and checkpoint save failed."));
      }
    }, timeoutMs);

    sub = facade.state().subscribe({
      next: (state) => {
        if (finished) return;
        const p = state.unshielded?.progress;
        if (p) {
          lastApplied = Number(p.appliedId);
          lastHighest = Number(p.highestTransactionId);
        }
        dustApplied = state.dust.progress.appliedIndex;
        dustHighest = state.dust.progress.highestRelevantWalletIndex;
        shieldedApplied = state.shielded.progress.appliedIndex;
        shieldedHighest = state.shielded.progress.highestRelevantWalletIndex;
        latestState = state;

        if (dustApplied - lastCheckpoint >= 10_000n) {
          lastCheckpoint = dustApplied;
          void saveCheckpoint().catch((error) =>
            console.error("Failed to save wallet checkpoint:", error),
          );
        }
        draw();

        if (!finished && isReallySynced(state, waitForDust, waitForShielded)) {
          finished = true;
          clearInterval(heartbeat);
          clearTimeout(timeout);
          sub?.unsubscribe();
          process.stdout.write("\n");
          void saveCheckpoint().then(() => resolve(state), reject);
        }
      },
      error: (error) => {
        if (finished) return;
        finished = true;
        clearInterval(heartbeat);
        clearTimeout(timeout);
        sub?.unsubscribe();
        void saveCheckpoint().then(
          () => reject(error),
          (saveError) =>
            reject(new AggregateError([error, saveError], "Sync and checkpoint save failed.")),
        );
      },
    });
    if (finished) sub.unsubscribe();
  });
}

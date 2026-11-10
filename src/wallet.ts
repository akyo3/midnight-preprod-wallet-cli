// Builds the wallet facade and synchronizes only the state each command needs.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import * as ledger from "@midnightntwrk/ledger-v9";
import {
  WalletFacade,
  ShieldedWallet,
  DustWallet,
  UnshieldedWallet,
  PublicKey,
  createKeystore,
  FacadeState,
  WalletSeeds,
} from "@midnightntwrk/wallet-sdk";
import * as rx from "rxjs";
import { getNetworkConfig, NETWORK_ID } from "./config";
import { clearWalletRoleSeeds, deriveWalletRoleSeeds } from "./keys";
import {
  loadDustState,
  loadWalletState,
  saveWalletState,
} from "./wallet-state";
import { loadWalletHistory, saveWalletHistory } from "./wallet-history";

type WalletIdentity = {
  unshieldedPublicKey: unknown;
  shieldedCoinPublicKey: unknown;
  shieldedEncryptionPublicKey: unknown;
  dustPublicKey: bigint;
};

function sameKey(left: unknown, right: unknown): boolean {
  return (
    left !== undefined && right !== undefined && isDeepStrictEqual(left, right)
  );
}

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
      const publicKey = snapshot.publicKey as
        Record<string, unknown> | undefined;
      return sameKey(publicKey?.publicKey, identity.unshieldedPublicKey);
    }
    if (kind === "shielded") {
      const publicKeys = snapshot.publicKeys as
        Record<string, unknown> | undefined;
      return (
        publicKeys !== undefined &&
        sameKey(publicKeys.coinPublicKey, identity.shieldedCoinPublicKey) &&
        sameKey(
          publicKeys.encryptionPublicKey,
          identity.shieldedEncryptionPublicKey,
        )
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
  console.warn(
    `Ignoring ${kind} checkpoint: it does not belong to the current wallet.`,
  );
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
      keystore: createKeystore(
        { kind: "schnorr", secret: keystoreSecret },
        NETWORK_ID,
      ),
      clearKeystoreSecret: () => {
        keystoreSecret.fill(0);
      },
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
  const digest = createHash("sha256")
    .update(String(dustPublicKey))
    .digest("hex");
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

function walletConfiguration(
  txHistoryStorage: Awaited<ReturnType<typeof loadWalletHistory>>["storage"],
) {
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
    txHistoryStorage,
    provingServerUrl: new URL(endpoints.proofServer),
    relayURL: new URL(endpoints.node),
  };
}

async function initializeFacade(
  seed: Buffer,
  saved: SavedWalletStates,
  keystore: WalletKeys["keystore"],
  txHistoryStorage: Awaited<ReturnType<typeof loadWalletHistory>>["storage"],
) {
  const roleSeeds = deriveWalletRoleSeeds(seed);
  try {
    return await WalletFacade.init({
      configuration: walletConfiguration(txHistoryStorage),
      shielded: (configuration) => {
        const wallet = ShieldedWallet(configuration);
        return saved.shielded
          ? wallet.restore(saved.shielded)
          : wallet.startWithSeed(roleSeeds.shielded);
      },
      unshielded: (configuration) => {
        const wallet = UnshieldedWallet(configuration);
        return saved.unshielded
          ? wallet.restore(saved.unshielded)
          : wallet.startWithPublicKey(PublicKey.fromKeyStore(keystore));
      },
      dust: (configuration) => {
        const wallet = DustWallet(configuration);
        if (saved.dust) {
          console.log("Resuming DUST sync from the saved checkpoint.");
          return wallet.restore(saved.dust);
        }
        return wallet.startWithSeed(roleSeeds.dust);
      },
    });
  } finally {
    clearWalletRoleSeeds(roleSeeds);
  }
}

export async function buildWallet(seed: Buffer) {
  const keys = createWalletKeys(seed);
  try {
    const identity = identifyWallet(keys);
    const walletId = walletStateId(identity.dustPublicKey);
    const saved = await readSavedWalletStates(walletId, identity);
    const { storage: txHistoryStorage, needsReplay } =
      await loadWalletHistory(walletId);
    if (needsReplay && (saved.shielded || saved.unshielded)) {
      console.log(
        "Rebuilding transaction history; replaying NIGHT and shielded state once.",
      );
    }
    const facade = await initializeFacade(
      seed,
      needsReplay ? { dust: saved.dust } : saved,
      keys.keystore,
      txHistoryStorage,
    );

    return {
      facade,
      keystore: keys.keystore,
      walletSeeds: WalletSeeds.fromMasterSeed(seed),
      walletId,
      txHistoryStorage,
      needsHistoryReplay: needsReplay,
      historyReadyToSave: !needsReplay,
      clearKeystoreSecret: keys.clearKeystoreSecret,
    };
  } catch (error) {
    keys.clearKeystoreSecret();
    throw error;
  }
}

export async function stopWallet(
  bundle: Awaited<ReturnType<typeof buildWallet>>,
) {
  let stopped = true;
  try {
    await bundle.facade.stop();
  } catch {
    stopped = false;
    console.warn(
      "Wallet shutdown failed. Check balance and history before retrying an operation.",
    );
  }
  try {
    if (bundle.historyReadyToSave) {
      await saveWalletHistory(bundle.walletId, bundle.txHistoryStorage);
    }
  } catch {
    stopped = false;
    console.warn(
      "Failed to save history on shutdown. A finalized transaction remains finalized; check history before retrying.",
    );
  } finally {
    bundle.clearKeystoreSecret();
  }
  return stopped;
}

type TransactionSubmitter<T> = {
  submitTransaction(transaction: T): Promise<string>;
};

function submissionFailureText(error: unknown): string {
  const seen = new Set<unknown>();
  const messages: string[] = [];
  let current = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    // Effect's FiberFailure.toString() includes the nested node error that its
    // message omits. Do not print this text: it can contain connection details.
    messages.push(String(current));
    current =
      typeof current === "object" && "cause" in current
        ? current.cause
        : undefined;
  }
  return messages.join("\n");
}

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
      const details = submissionFailureText(error);
      if (/Custom error:\s*170\b|InvalidDustSpendProof/i.test(details)) {
        throw new Error(
          "Transaction rejected: Custom error: 170 (InvalidDustSpendProof). " +
            "The node could not verify the DUST spend proof. " +
            "Let DUST synchronization finish and rebuild the transaction; " +
            "check the indexer and Proof Server compatibility if this persists. " +
            "The rejected transaction was not retried.",
          { cause: error },
        );
      }
      // A validation rejection cannot be repaired by resending the same bytes.
      // Preserve the first rejection instead of hiding it behind a pool ban.
      if (/Invalid Transaction|temporarily banned|\b101[02]\b/i.test(details)) {
        throw error;
      }
      const connectionFailure =
        /connection (?:closed|lost|reset|refused)|disconnected|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|1006.*Abnormal Closure/i.test(
          details,
        );
      if (!connectionFailure || attempt >= attempts) throw error;
      console.warn(
        `Submission attempt ${attempt} failed; retrying in ${delayMs}ms.`,
      );
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
  const shieldedOk =
    !waitForShielded || state.shielded.progress.isStrictlyComplete();
  if (!waitForDust) return unshieldedOk && shieldedOk;

  const dustProgress = state.dust.progress;
  const hasDustRegistration = state.unshielded.totalCoins.some(
    (coin) => coin.meta.registeredForDustGeneration,
  );
  const hasNoDustEvents =
    dustProgress.appliedIndex === 0n &&
    dustProgress.highestRelevantWalletIndex === 0n;
  const dustOk =
    dustProgress.isStrictlyComplete() ||
    (!hasDustRegistration && hasNoDustEvents);

  return unshieldedOk && shieldedOk && dustOk;
}

/**
 * Starts the facade and waits for the selected wallet states to synchronize.
 * Initial DUST registration can skip the global DUST replay with waitForDust.
 * Transaction commands also wait for the wallets to agree on the protocol.
 * Progress is redrawn every second, and a timeout fails explicitly instead of
 * returning partial state.
 */
export async function startAndSync(
  bundle: Awaited<ReturnType<typeof buildWallet>>,
  options: {
    waitForDust?: boolean;
    waitForShielded?: boolean;
    waitForProtocol?: boolean;
    timeoutMs?: number;
  } = {},
) {
  const waitForDust = options.waitForDust ?? true;
  const waitForShielded =
    (options.waitForShielded ?? false) || bundle.needsHistoryReplay;
  const waitForProtocol = options.waitForProtocol ?? false;
  const timeoutMs = options.timeoutMs ?? (waitForDust ? 86_400_000 : 600_000);
  const { facade, walletSeeds, walletId } = bundle;
  await facade.start(walletSeeds);

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
      // An old checkpoint may be ahead of a partially rebuilt history. Keep
      // replaying from the beginning on restart until the backfill is complete.
      if (bundle.needsHistoryReplay && !isReallySynced(state, false, true))
        return saveQueue;
      saveQueue = saveQueue
        .catch(() => undefined)
        // Persist history before advancing the cursors that would skip its events.
        .then(() => saveWalletHistory(walletId, bundle.txHistoryStorage))
        .then(() => {
          bundle.historyReadyToSave = true;
        })
        .then(() =>
          Promise.all([
            saveWalletState(walletId, "shielded", state.shielded.serialize()),
            saveWalletState(
              walletId,
              "unshielded",
              state.unshielded.serialize(),
            ),
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
      const protocol = latestState?.protocol;
      const protocolStatus =
        waitForProtocol && protocol?._tag === "Crossing"
          ? `; protocol crossing ${protocol.from} -> ${protocol.to}, waiting for ${protocol.behind.join(", ")}`
          : "";
      process.stdout.write(
        `\r  syncing... ${Math.min(lastApplied, lastHighest)}/${lastHighest} transactions` +
          `${dustStatus}${shieldedStatus}${protocolStatus} (${secs}s)`,
      );
    };
    const heartbeat = setInterval(draw, 1000);

    let sub: rx.Subscription | undefined;
    const finish = (error?: unknown, state?: FacadeState) => {
      if (finished) return;
      finished = true;
      clearInterval(heartbeat);
      clearTimeout(timeout);
      sub?.unsubscribe();
      process.stdout.write("\n");
      void saveCheckpoint().then(
        () => (state ? resolve(state) : reject(error)),
        (saveError) =>
          reject(
            state
              ? saveError
              : new AggregateError(
                  [error, saveError],
                  "Sync and checkpoint save failed.",
                ),
          ),
      );
    };
    const timeout = setTimeout(() => {
      const protocol = latestState?.protocol;
      finish(
        new Error(
          `Sync timed out after ${timeoutMs / 1000}s. ` +
            (waitForProtocol && protocol?._tag === "Crossing"
              ? `Protocol crossing ${protocol.from} -> ${protocol.to}: waiting for ${protocol.behind.join(", ")}.`
              : waitForDust
                ? "A first DUST sync replays the global event history and can take several hours."
                : "The NIGHT indexer did not finish syncing."),
        ),
      );
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

        if (
          !finished &&
          isReallySynced(state, waitForDust, waitForShielded) &&
          (!waitForProtocol || state.protocol._tag === "Settled")
        ) {
          finish(undefined, state);
        }
      },
      error: (error) => finish(error),
      complete: () =>
        finish(
          new Error(
            "Wallet state stream ended before synchronization completed.",
          ),
        ),
    });
    if (finished) sub.unsubscribe();
  });
}

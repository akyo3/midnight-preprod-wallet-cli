import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type WalletStateKind = "dust" | "shielded" | "unshielded";

function stateDirectory() {
  return path.resolve(process.env.WALLET_STATE_DIR ?? ".wallet-state");
}

function statePath(walletId: string, kind: WalletStateKind) {
  if (!/^[a-z0-9-]+$/i.test(walletId)) {
    throw new Error("Wallet state ID may contain only letters, numbers, and hyphens.");
  }
  return path.join(stateDirectory(), `${walletId}-${kind}.json`);
}

async function readState(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Reads the old DUST-only checkpoint so existing wallets do not lose hours of sync progress. */
export async function loadDustState(publicKey: bigint): Promise<string | undefined> {
  return await readState(path.join(stateDirectory(), `dust-${publicKey}.json`));
}

export async function loadWalletState(walletId: string, kind: WalletStateKind) {
  return await readState(statePath(walletId, kind));
}

export async function saveWalletState(
  walletId: string,
  kind: WalletStateKind,
  state: string,
): Promise<void> {
  await mkdir(stateDirectory(), { recursive: true });
  const destination = statePath(walletId, kind);
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, state, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  try {
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

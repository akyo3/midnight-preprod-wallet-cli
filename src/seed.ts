import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_SEED_FILE = ".wallet-seed";
const SEED_HEX_LENGTH = 64;

export function parseSeed(value: string): Buffer {
  const hex = value.trim().replace(/^0x/i, "");
  if (!new RegExp(`^[0-9a-fA-F]{${SEED_HEX_LENGTH}}$`).test(hex)) {
    throw new Error("Wallet seed must be exactly 32 bytes encoded as 64 hexadecimal characters.");
  }
  return Buffer.from(hex, "hex");
}

async function readSeedFile(file: string): Promise<Buffer | undefined> {
  try {
    const seed = parseSeed(await readFile(file, "utf8"));
    await chmod(file, 0o600);
    return seed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function loadOrCreateSeed(): Promise<Buffer> {
  const environmentSeed = process.env.WALLET_SEED;
  if (environmentSeed) return parseSeed(environmentSeed);

  const file = path.resolve(process.env.WALLET_SEED_FILE ?? DEFAULT_SEED_FILE);
  const existing = await readSeedFile(file);
  if (existing) return existing;

  const seed = randomBytes(32);
  await mkdir(path.dirname(file), { recursive: true });

  try {
    await writeFile(file, `${seed.toString("hex")}\n`, { flag: "wx", mode: 0o600 });
    console.log(`Created a new wallet seed in ${file}`);
    return seed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const concurrentlyCreated = await readSeedFile(file);
    if (!concurrentlyCreated) throw new Error(`Unable to read wallet seed from ${file}`);
    return concurrentlyCreated;
  }
}

// CLI entry point and command router.
import { addressCommand } from "./commands/address";
import { balanceCommand } from "./commands/balance";
import { deregisterDustCommand } from "./commands/deregister-dust";
import { historyCommand } from "./commands/history";
import { redesignateDustCommand } from "./commands/redesignate-dust";
import { registerDustCommand } from "./commands/register-dust";
import { sendCommand } from "./commands/send";
import {
  parseCombinedSendArguments,
  parseSendArguments,
  parseShieldedSendArguments,
  parseSingleArgument,
} from "./cli";
import { loadOrCreateSeed } from "./seed";

const commands = new Set([
  "address",
  "balance",
  "deregister-dust",
  "history",
  "redesignate-dust",
  "register-dust",
  "send",
  "send-combined",
  "send-shielded",
]);

async function runCommand(cmd: string, seed: Buffer) {
  switch (cmd) {
    case "address":
      addressCommand(seed);
      break;
    case "balance":
      await balanceCommand(seed);
      break;
    case "register-dust":
      await registerDustCommand(seed);
      break;
    case "deregister-dust":
      await deregisterDustCommand(seed);
      break;
    case "redesignate-dust":
      await redesignateDustCommand(
        seed,
        parseSingleArgument(
          process.argv.slice(3),
          "Usage: pnpm redesignate-dust <recipientDustAddress>",
        ),
      );
      break;
    case "history":
      await historyCommand(seed, process.argv[3]);
      break;
    case "send": {
      const { recipient, amount } = parseSendArguments(process.argv.slice(3));
      await sendCommand(seed, [{ kind: "unshielded", recipient, amount }]);
      break;
    }
    case "send-shielded": {
      const output = parseShieldedSendArguments(process.argv.slice(3));
      await sendCommand(seed, [{ kind: "shielded", ...output }]);
      break;
    }
    case "send-combined": {
      const { unshielded, shielded } = parseCombinedSendArguments(process.argv.slice(3));
      await sendCommand(seed, [
        { kind: "unshielded", ...unshielded },
        { kind: "shielded", ...shielded },
      ]);
      break;
    }
    default:
      throw new Error(`Command is not implemented: ${cmd}`);
  }
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(
      "Usage: pnpm [address|balance|history|send|send-shielded|send-combined|" +
        "register-dust|deregister-dust|redesignate-dust]",
    );
    return;
  }
  if (!commands.has(cmd)) {
    throw new Error(`Unknown command: ${cmd}. Run pnpm start -- --help for usage.`);
  }

  const seed = await loadOrCreateSeed();
  try {
    await runCommand(cmd, seed);
  } finally {
    seed.fill(0);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

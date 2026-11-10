const MICRO_NIGHT = 1_000_000n;

export function parseNightAmount(value: string): bigint {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) {
    throw new Error(
      "Amount must be a positive NIGHT value with at most 6 decimal places.",
    );
  }

  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(6, "0"));
  const amount = whole * MICRO_NIGHT + fraction;
  if (amount === 0n) throw new Error("Amount must be greater than zero.");
  return amount;
}

export function parseBaseUnits(value: string): bigint {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(
      "Amount must be a positive integer in the token's base units.",
    );
  }
  return BigInt(value);
}

export function parseTokenType(value: string): string {
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error("Token type must be exactly 64 hexadecimal characters.");
  }
  return value.toLowerCase();
}

export function parseSendArguments(args: string[], command = "send") {
  const values = withoutSeparator(args);
  if (values.length !== 2 || !values[0]) {
    throw new Error(
      `Usage: pnpm ${command} <recipientAddress> <amountInNight>`,
    );
  }
  return { recipient: values[0], amount: parseNightAmount(values[1]) };
}

export function withoutSeparator(args: string[]): string[] {
  return args[0] === "--" ? args.slice(1) : args;
}

export function parseCombinedSendArguments(args: string[]) {
  const values = withoutSeparator(args);
  if (values.length !== 5) {
    throw new Error(
      "Usage: pnpm send-combined <unshieldedAddress> <nightAmount> " +
        "<shieldedAddress> <tokenType> <baseUnits>",
    );
  }
  return {
    unshielded: { recipient: values[0], amount: parseNightAmount(values[1]) },
    shielded: {
      recipient: values[2],
      tokenType: parseTokenType(values[3]),
      amount: parseBaseUnits(values[4]),
    },
  };
}

export function parseShieldedSendArguments(args: string[]) {
  const values = withoutSeparator(args);
  if (values.length !== 3) {
    throw new Error(
      "Usage: pnpm send-shielded <shieldedAddress> <tokenType> <baseUnits>",
    );
  }
  return {
    recipient: values[0],
    tokenType: parseTokenType(values[1]),
    amount: parseBaseUnits(values[2]),
  };
}

export function parseSingleArgument(args: string[], usage: string): string {
  const values = withoutSeparator(args);
  if (values.length !== 1 || !values[0]) throw new Error(usage);
  return values[0];
}

/** Validate command syntax before loading or creating a wallet seed. */
export function parseCommand(command: string, args: string[]) {
  const values = withoutSeparator(args);
  switch (command) {
    case "address":
    case "balance":
    case "register-dust":
    case "deregister-dust":
      if (values.length !== 0) throw new Error(`Usage: pnpm ${command}`);
      return { command };
    case "history": {
      if (
        values.length > 1 ||
        (values[0] !== undefined && !/^[0-9a-f]{64}$/i.test(values[0]))
      ) {
        throw new Error(
          "Usage: pnpm history [history-hash: 64 hexadecimal characters]",
        );
      }
      return { command, hash: values[0]?.toLowerCase() };
    }
    case "redesignate-dust":
      return {
        command,
        receiver: parseSingleArgument(
          values,
          "Usage: pnpm redesignate-dust <recipientDustAddress>",
        ),
      };
    case "send":
      return { command, ...parseSendArguments(values) };
    case "send-shielded":
      return { command, ...parseShieldedSendArguments(values) };
    case "send-combined":
      return { command, ...parseCombinedSendArguments(values) };
    default:
      throw new Error(
        `Unknown command: ${command}. Run pnpm start -- --help for usage.`,
      );
  }
}

export type ParsedCommand = ReturnType<typeof parseCommand>;

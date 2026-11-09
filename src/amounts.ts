export function formatUnits(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = (absolute % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  const sign = negative ? "-" : "";
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

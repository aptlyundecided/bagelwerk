import chalk from "chalk";

export type CoreRuntimeKind = "flow" | "node";

const PLAIN_PREFIX_BY_KIND: Record<CoreRuntimeKind, string> = {
  flow: "⬢ FLOW",
  node: "◉ NODE",
};

export function formatCoreRuntimePrefix(kind: CoreRuntimeKind): string {
  const plainPrefix = PLAIN_PREFIX_BY_KIND[kind];

  switch (kind) {
    case "flow":
      return chalk.hex("#a855f7")(plainPrefix);
    case "node":
      return chalk.cyan(plainPrefix);
  }
}

export function formatCoreRuntimeLine(kind: CoreRuntimeKind, message: string): string {
  return `${formatCoreRuntimePrefix(kind)} ${message}`;
}

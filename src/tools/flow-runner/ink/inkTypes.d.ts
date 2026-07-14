declare module "ink" {
  import type React from "react";

  export const Box: React.ComponentType<Record<string, unknown>>;
  export const Text: React.ComponentType<Record<string, unknown>>;

  export function render(node: React.ReactElement): {
    waitUntilExit(): Promise<void>;
    unmount(): void;
  };

  export function useApp(): { exit(): void };
  export function useInput(
    handler: (input: string, key: { upArrow?: boolean; downArrow?: boolean; leftArrow?: boolean; rightArrow?: boolean; return?: boolean; escape?: boolean }) => void,
    options?: { isActive?: boolean },
  ): void;
}

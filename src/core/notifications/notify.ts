/**
 * macOS native notifications and interactive alerts.
 *
 * Two modes:
 * - `notify()` — fire-and-forget banner notification (Notification Center)
 * - `alert()` — blocking modal dialog that waits for user interaction
 *
 * Zero npm dependencies — uses system osascript (AppleScript) and
 * optionally terminal-notifier when installed.
 */
import { exec, execSync } from "node:child_process";
import { platform } from "node:os";

// ─── Banner Notification (non-blocking) ──────────────────────────────────────

export type NotifyOptions = {
  title: string;
  message: string;
  subtitle?: string;
  sound?: string; // macOS sound name, e.g. "Glass", "Ping", "Basso", "Hero"
};

function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function hasTerminalNotifier(): boolean {
  try {
    execSync("which terminal-notifier", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fire a macOS Notification Center banner (non-blocking).
 * Uses terminal-notifier if available, falls back to osascript.
 * Silently resolves on non-macOS platforms.
 */
export function notify(opts: NotifyOptions): Promise<void> {
  if (platform() !== "darwin") {
    return Promise.resolve();
  }

  if (hasTerminalNotifier()) {
    return notifyViaTerminalNotifier(opts);
  }
  return notifyViaOsascript(opts);
}

function notifyViaTerminalNotifier(opts: NotifyOptions): Promise<void> {
  const args = [
    "-title", JSON.stringify(opts.title),
    "-message", JSON.stringify(opts.message),
  ];
  if (opts.subtitle) args.push("-subtitle", JSON.stringify(opts.subtitle));
  if (opts.sound) args.push("-sound", opts.sound);
  args.push("-group", "flow-zone");

  return new Promise<void>((resolve) => {
    exec(`terminal-notifier ${args.join(" ")}`, () => resolve());
  });
}

function notifyViaOsascript(opts: NotifyOptions): Promise<void> {
  const title = escapeAppleScript(opts.title);
  const message = escapeAppleScript(opts.message);
  const subtitle = opts.subtitle ? ` subtitle "${escapeAppleScript(opts.subtitle)}"` : "";
  const sound = opts.sound ? ` sound name "${escapeAppleScript(opts.sound)}"` : "";

  const script = `display notification "${message}" with title "${title}"${subtitle}${sound}`;

  return new Promise<void>((resolve) => {
    exec(`osascript -e '${script}'`, () => resolve());
  });
}

// ─── Interactive Alert (blocking) ────────────────────────────────────────────

export type AlertButton = string;

export type AlertOptions = {
  title: string;
  message: string;
  buttons?: AlertButton[];         // Default: ["OK"]
  defaultButton?: AlertButton;     // Which button is highlighted
  cancelButton?: AlertButton;      // Which button means "cancel" (exit code 1)
  icon?: "stop" | "note" | "caution"; // Alert icon style
};

export type AlertResult = {
  button: string;                  // The label of the button the user clicked
  dismissed: boolean;              // True if cancel button was pressed
};

/**
 * Show a blocking macOS alert dialog.
 * The process blocks until the user clicks a button.
 * Returns which button was clicked.
 *
 * On non-macOS, resolves as if the default button was clicked.
 */
export function alert(opts: AlertOptions): Promise<AlertResult> {
  if (platform() !== "darwin") {
    const defaultBtn = opts.defaultButton ?? opts.buttons?.[0] ?? "OK";
    return Promise.resolve({ button: defaultBtn, dismissed: false });
  }

  const buttons = opts.buttons ?? ["OK"];
  const defaultButton = opts.defaultButton ?? buttons[buttons.length - 1];
  const cancelButton = opts.cancelButton;

  const title = escapeAppleScript(opts.title);
  const message = escapeAppleScript(opts.message);
  const buttonList = buttons.map((b) => `"${escapeAppleScript(b)}"`).join(", ");
  const defaultClause = ` default button "${escapeAppleScript(defaultButton)}"`;
  const cancelClause = cancelButton ? ` cancel button "${escapeAppleScript(cancelButton)}"` : "";
  const iconClause = opts.icon ? ` as ${opts.icon === "stop" ? "critical" : opts.icon === "caution" ? "warning" : "informational"}` : "";

  // Wrap in try/catch to detect cancel (error -128)
  const script = `
try
  set result to display alert "${title}" message "${message}" buttons {${buttonList}}${defaultClause}${cancelClause}${iconClause}
  return "button:" & (button returned of result)
on error number -128
  return "dismissed:${escapeAppleScript(cancelButton ?? buttons[0] ?? "Cancel")}"
end try
`.trim();

  return new Promise<AlertResult>((resolve, reject) => {
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (error, stdout) => {
      const output = stdout.trim();
      if (output.startsWith("dismissed:")) {
        resolve({ button: output.slice("dismissed:".length), dismissed: true });
      } else if (output.startsWith("button:")) {
        resolve({ button: output.slice("button:".length), dismissed: false });
      } else if (error) {
        // Unexpected error — treat as dismiss
        resolve({ button: cancelButton ?? buttons[0] ?? "OK", dismissed: true });
      } else {
        resolve({ button: output || defaultButton, dismissed: false });
      }
    });
  });
}

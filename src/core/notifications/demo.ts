#!/usr/bin/env tsx
/**
 * Interactive test for the human-ack node with macOS alert dialog.
 *
 * Run: npx tsx src/core/notifications/demo.ts
 *
 * This will:
 * 1. Fire a banner notification (non-blocking)
 * 2. Pop a blocking alert dialog — click Acknowledge or Dismiss
 * 3. Report what you clicked
 */
import { notify, alert } from "./index";

async function main() {
  console.log("1. Sending banner notification...");
  await notify({
    title: "🔔 Flow Zone",
    message: "A flow has finished — alert dialog coming next!",
    sound: "Glass",
  });
  console.log("   ✓ Banner sent (check Notification Center)\n");

  console.log("2. Showing blocking alert dialog...");
  console.log("   (A macOS dialog should appear — click a button)\n");

  const result = await alert({
    title: "🔔 Flow Checkpoint",
    message: "The flow 'platform-tour' has completed.\n\nDo you acknowledge and want to proceed?",
    buttons: ["Dismiss", "Acknowledge"],
    defaultButton: "Acknowledge",
    cancelButton: "Dismiss",
    icon: "note",
  });

  console.log(`   Result: button="${result.button}", dismissed=${result.dismissed}`);
  console.log(result.dismissed ? "\n   ⏭  You dismissed — flow would pause/fail." : "\n   ✅ You acknowledged — flow would continue!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

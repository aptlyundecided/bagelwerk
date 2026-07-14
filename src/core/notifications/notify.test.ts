import assert from "node:assert/strict";
import test from "node:test";
import { notify, alert } from "./notify";

test("notify resolves without throwing on macOS", async () => {
  await assert.doesNotReject(
    notify({
      title: "Test Notification",
      message: "This is a test from flow-zone.",
      sound: "Glass",
    })
  );
});

test("notify handles special characters in title and message", async () => {
  await assert.doesNotReject(
    notify({
      title: 'Title with "quotes" & backslash\\',
      message: "Message with 'single' and \"double\" quotes",
    })
  );
});

test("notify resolves when subtitle is provided", async () => {
  await assert.doesNotReject(
    notify({
      title: "Test",
      message: "Body",
      subtitle: "Subtitle here",
      sound: "Ping",
    })
  );
});

test("alert resolves with default button on non-darwin or returns user choice", async () => {
  // On macOS this will pop a real dialog — skip in CI.
  // This test just verifies the function signature and return shape.
  if (process.platform !== "darwin") {
    const result = await alert({
      title: "Test",
      message: "Non-macOS fallback test",
      buttons: ["Cancel", "OK"],
      defaultButton: "OK",
    });
    assert.equal(result.button, "OK");
    assert.equal(result.dismissed, false);
  } else {
    // On macOS we can't auto-test a blocking dialog in CI,
    // so just verify the type exports are correct.
    assert.equal(typeof alert, "function");
  }
});

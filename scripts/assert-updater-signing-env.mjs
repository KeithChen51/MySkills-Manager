import { access } from "node:fs/promises";

const key = process.env.TAURI_SIGNING_PRIVATE_KEY?.trim();
const keyPath = process.env.TAURI_SIGNING_PRIVATE_KEY_PATH?.trim();
const keyPassword = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD?.trim();

if (!key && !keyPath) {
  console.error("Missing updater signing key.");
  console.error(
    "Set TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH before updater builds.",
  );
  process.exit(1);
}

if (keyPath) {
  try {
    await access(keyPath);
  } catch {
    console.error(`Signing key file not found: ${keyPath}`);
    process.exit(1);
  }
}

if (!keyPassword) {
  console.warn(
    "TAURI_SIGNING_PRIVATE_KEY_PASSWORD is empty. Continue only if your private key has no password.",
  );
}

console.log("Updater signing env is configured.");

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

type TauriConfig = {
  build?: {
    devUrl?: string;
    beforeDevCommand?: string;
  };
};

function readTauriConfig(): TauriConfig {
  const configPath = path.resolve(process.cwd(), "src-tauri/tauri.conf.json");
  return JSON.parse(fs.readFileSync(configPath, "utf8")) as TauriConfig;
}

test("tauri dev command keeps the Vite port fixed to match devUrl", () => {
  const config = readTauriConfig();
  const build = config.build ?? {};

  assert.equal(
    build.devUrl,
    "http://localhost:1420",
    "tauri devUrl should keep using the expected local dev port",
  );
  assert.match(
    build.beforeDevCommand ?? "",
    /--port 1420/,
    "beforeDevCommand should pass the same port to Vite",
  );
  assert.match(
    build.beforeDevCommand ?? "",
    /--strictPort/,
    "beforeDevCommand should fail instead of silently switching ports",
  );
});

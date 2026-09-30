import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfigFile } from "../src/config.ts";

test("loadConfigFile returns undefined when no config exists", () => {
  const cfg = loadConfigFile("/tmp/non-existent-dir-12345");
  assert.equal(cfg, undefined);
});

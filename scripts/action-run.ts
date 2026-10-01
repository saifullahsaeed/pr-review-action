import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { CONFIG_FILENAMES } from "../src/config.ts";

const root = resolve(process.env.GITHUB_WORKSPACE ?? process.cwd());
const temporary = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), "harrier-action-"));
const out = join(temporary, "report");
mkdirSync(out);
let code = 2;
try {
  const base = process.env.HARRIER_BASE_SHA ?? "";
  const policy = join(temporary, "policy.json");
  let config = "{}";
  if (base) {
    if (!/^[a-f0-9]{40,64}$/i.test(base)) throw new Error("Invalid base commit SHA");
    try {
      execFileSync("git", ["cat-file", "-e", `${base}^{commit}`], { cwd: root, stdio: "pipe" });
    } catch {
      execFileSync("git", ["fetch", "--no-tags", "origin", base], { cwd: root, stdio: "pipe" });
    }
    const tree = execFileSync("git", ["ls-tree", "--name-only", base], { cwd: root, encoding: "utf8" }).trim().split("\n");
    const file = CONFIG_FILENAMES.find(f => tree.includes(f));
    if (file) config = execFileSync("git", ["show", `${base}:${file}`], { cwd: root, encoding: "utf8" });
  } else {
    // Non-PR runs use the checked-out revision's policy, not a working-tree override.
    const tree = execFileSync("git", ["ls-tree", "--name-only", "HEAD"], { cwd: root, encoding: "utf8" }).trim().split("\n");
    const file = CONFIG_FILENAMES.find(f => tree.includes(f));
    if (file) config = execFileSync("git", ["show", `HEAD:${file}`], { cwd: root, encoding: "utf8" });
  }
  const parsed = JSON.parse(config);
  // Keep artifact destination fixed; repository configuration cannot redirect it.
  delete parsed.outDir;
  writeFileSync(policy, JSON.stringify(parsed));
  const cli = resolve(import.meta.dirname, "../src/cli.ts");
  const args = [cli, "review", root, "--gate", "--safe-scanners", "--policy-file", policy, "--out", out];
  if (base) args.push("--baseline", base, "--diff", base);
  const failOn = process.env.HARRIER_FAIL_ON;
  if (failOn) args.push("--fail-on", failOn);
  if (process.env.HARRIER_ENABLE_LLM !== "true") args.push("--no-llm");
  if (process.env.HARRIER_LLM_BASE_URL) args.push("--endpoint", process.env.HARRIER_LLM_BASE_URL);
  if (process.env.HARRIER_LLM_MODEL) args.push("--model", process.env.HARRIER_LLM_MODEL);
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit", env: process.env });
  code = result.status ?? 2;
  if (!existsSync(join(out, "gate.json")) || !existsSync(join(out, "report.md"))) throw new Error("Review did not produce gate evidence");
} catch (error) {
  code = 2;
  const detail = error instanceof Error ? error.message : String(error);
  console.error(detail);
  writeFileSync(join(out, "report.md"), `<!-- harrier-quality-gate -->\n# Harrier quality gate — INCOMPLETE\n\nBaseline/policy setup failed. See job log for details.\n`);
  writeFileSync(join(out, "gate.json"), JSON.stringify({ status: "incomplete", exitCode: 2, reasons: ["Baseline/policy setup failed; see job log"] }, null, 2));
}
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `exit-code=${code}\nreport-dir=${out}\n`);
// Always leave publishing steps runnable. The Action enforces code in its final step.
process.exitCode = 0;

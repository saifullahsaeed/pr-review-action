import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";

export type ExecOutcome =
  | { kind: "ok"; code: number | null; stdout: string; stderr: string }
  | { kind: "missing" }
  | { kind: "failed"; detail: string };

/**
 * Run a scanner. "missing" is its own outcome on purpose: a tool that is not installed is
 * a gap to report, not an error to hide and not a clean run.
 */
export function runCommand(
  command: readonly string[],
  options: { cwd: string; timeoutMs: number },
): Promise<ExecOutcome> {
  return new Promise((resolve) => {
    const [file, ...args] = command;
    if (file === undefined) {
      resolve({ kind: "failed", detail: "empty command" });
      return;
    }
    let child: ChildProcess;
    try {
      child = spawn(file, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve({ kind: "failed", detail: String(error) });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (outcome: ExecOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") settle({ kind: "missing" });
      else settle({ kind: "failed", detail: error.message });
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle({ kind: "failed", detail: `timed out after ${options.timeoutMs}ms` });
    }, options.timeoutMs);
    child.on("close", (code) => {
      settle({ kind: "ok", code, stdout, stderr });
    });
  });
}

/** Most scanners exit non-zero when they find something. The output is the truth, not the code. */
export function outputOf(outcome: ExecOutcome): string | undefined {
  return outcome.kind === "ok" ? outcome.stdout : undefined;
}

import type { CommandResult } from "./types";
import { commandString } from "./util";

interface ProcessOptions {
  cwd: string;
  timeoutMs: number;
  stdin?: string;
  env?: Record<string, string | undefined>;
}

async function streamText(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) {
    return "";
  }
  return new Response(stream).text();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runProcess(command: string[], options: ProcessOptions): Promise<CommandResult> {
  const started = performance.now();
  const child = Bun.spawn(command, {
    cwd: options.cwd,
    stdin: options.stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: options.env
  });

  if (options.stdin !== undefined && child.stdin && typeof child.stdin !== "string") {
    child.stdin.write(options.stdin);
    child.stdin.end();
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timeoutHandle = setTimeout(() => resolve("timeout"), options.timeoutMs);
  });
  const exitPromise = child.exited.then((exitCode) => ({ kind: "exit" as const, exitCode }));
  const outcome = await Promise.race([exitPromise, timeoutPromise]);

  let exitCode: number | null;
  if (outcome === "timeout") {
    timedOut = true;
    exitCode = null;
    try {
      child.kill();
    } catch {
      // The process may have exited between the race and kill().
    }
    await Promise.race([child.exited.then(() => undefined), delay(1_000)]);
  } else {
    exitCode = outcome.exitCode;
  }

  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }
  const [stdout, stderr] = await Promise.all([streamText(child.stdout), streamText(child.stderr)]);
  return {
    command,
    cwd: options.cwd,
    exitCode,
    timedOut,
    stdout,
    stderr,
    durationMs: Math.round(performance.now() - started)
  };
}

export function renderProcessFailure(result: CommandResult): string {
  const status = result.timedOut ? `timed out after ${result.durationMs}ms` : `exited with ${result.exitCode}`;
  const stderr = result.stderr.trim();
  const stdout = result.stdout.trim();
  return [
    `${commandString(result.command)} ${status}`,
    stderr ? `stderr:\n${stderr}` : "",
    stdout ? `stdout:\n${stdout}` : ""
  ].filter(Boolean).join("\n\n");
}


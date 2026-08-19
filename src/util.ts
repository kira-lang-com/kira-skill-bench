import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function writeText(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path));
  await Bun.write(path, content);
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function truncate(value: string | undefined, max = 20_000): string | undefined {
  if (value === undefined || value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}\n… [truncated ${value.length - max} characters]`;
}

export function makeRunId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Split a command supplied by a human while retaining the common quoted-argument
 * behavior needed for Bun, Node, and small wrapper scripts. Complex shell syntax
 * should be put in a script and passed as the first command instead.
 */
export function splitCommand(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaping = false;

  for (const character of command.trim()) {
    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }

    if (character === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = undefined;
      } else {
        current += character;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current.length > 0) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (escaping) {
    current += "\\";
  }
  if (quote) {
    throw new Error(`Unclosed ${quote} quote in command: ${command}`);
  }
  if (current.length > 0) {
    parts.push(current);
  }
  if (parts.length === 0) {
    throw new Error("Command cannot be empty");
  }
  return parts;
}

export function commandString(command: string[]): string {
  return command.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

export function resolveFrom(baseDir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(baseDir, path);
}

export function caseArtifactDir(root: string, iteration: number, caseId: string): string {
  return join(root, `iteration-${String(iteration).padStart(3, "0")}`, caseId);
}


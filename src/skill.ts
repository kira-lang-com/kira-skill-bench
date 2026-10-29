import type { SkillEditRecord } from "./types";
import { writeText } from "./util";

export interface SkillValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  name?: string;
  description?: string;
}

export interface ParsedSkillUpdate {
  patch?: string;
  reason: string;
  summary?: string;
  raw: unknown;
}

export async function readSkill(path: string): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Skill file does not exist: ${path}`);
  }
  return file.text();
}

export function validateSkillText(skill: string): SkillValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!skill.trimStart().startsWith("---")) {
    errors.push("SKILL.md must begin with YAML frontmatter (---).");
    return { valid: false, errors, warnings };
  }

  const lines = skill.split(/\r?\n/);
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex < 0) {
    errors.push("YAML frontmatter is not closed with a second --- line.");
    return { valid: false, errors, warnings };
  }

  const frontmatter = lines.slice(1, closingIndex).join("\n");
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descriptionMatch = frontmatter.match(/^description:\s*(.+)$/m);
  const name = nameMatch ? unquoteYamlScalar(nameMatch[1].trim()) : undefined;
  const description = descriptionMatch ? unquoteYamlScalar(descriptionMatch[1].trim()) : undefined;

  if (!name) {
    errors.push("Frontmatter is missing name.");
  } else if (!/^[a-z0-9-]+$/.test(name)) {
    errors.push(`Skill name must use lowercase letters, digits, and hyphens: ${name}`);
  } else if (name.length > 64) {
    errors.push("Skill name must be 64 characters or fewer.");
  }

  if (!description) {
    errors.push("Frontmatter is missing description.");
  }

  const bodyLineCount = lines.length - closingIndex - 1;
  if (bodyLineCount > 500) {
    warnings.push(`Skill body has ${bodyLineCount} lines; the skill-creator guidance recommends staying under 500.`);
  }

  return { valid: errors.length === 0, errors, warnings, name, description };
}

function unquoteYamlScalar(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).trim();
  }
  return value.trim();
}

function parseJsonIfPossible(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return value;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function findField(value: unknown, keys: string[], depth = 0): unknown {
  if (depth > 3 || value === null || value === undefined) {
    return undefined;
  }
  const parsed = parseJsonIfPossible(value);
  if (parsed !== value) {
    return findField(parsed, keys, depth + 1);
  }
  if (typeof parsed !== "object") {
    return undefined;
  }

  const record = parsed as Record<string, unknown>;
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }
  for (const child of Object.values(record)) {
    const found = findField(child, keys, depth + 1);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

export function parseSkillUpdate(raw: unknown): ParsedSkillUpdate {
  const parsed = parseJsonIfPossible(raw);
  const patchField = findField(parsed, ["patch", "diff", "apply_patch", "changes"]);
  const reasonField = findField(parsed, ["reason", "rationale", "why"]);
  const summaryField = findField(parsed, ["summary", "changes", "changeSummary"]);
  const patch = typeof patchField === "string" ? patchField.trim() : typeof parsed === "string" ? parsed.trim() : undefined;

  return {
    patch: patch && patch.includes("@@") ? patch : undefined,
    reason: typeof reasonField === "string" && reasonField.trim().length > 0
      ? reasonField.trim()
      : "The improver did not provide a reason; inspect the recorded response.",
    summary: typeof summaryField === "string" ? summaryField.trim() : undefined,
    raw
  };
}

interface PatchHunk {
  start?: number;
  oldLineCount?: number;
  lines: string[];
}

interface ParsedPatch {
  hunks: PatchHunk[];
  applyPatchFormat: boolean;
}

function isSkillPath(path: string): boolean {
  const normalized = path.trim().replaceAll("\\", "/").replace(/^a\//, "").replace(/^b\//, "");
  return normalized === "SKILL.md" || normalized === "./SKILL.md";
}

function parsePatch(patch: string): ParsedPatch {
  const normalized = patch.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    throw new Error("Patch is empty.");
  }

  const rawLines = normalized.split("\n");
  const beginIndex = rawLines.findIndex((line) => line.trim() === "*** Begin Patch");
  const applyPatchFormat = beginIndex >= 0;
  let lines = rawLines;

  if (applyPatchFormat) {
    const endIndex = rawLines.findIndex((line, index) => index > beginIndex && line.trim() === "*** End Patch");
    if (endIndex < 0) {
      throw new Error("Patch starts with *** Begin Patch but has no *** End Patch.");
    }
    const updateLines = rawLines.filter((line) => line.startsWith("*** Update File:"));
    if (updateLines.length !== 1 || !isSkillPath(updateLines[0].slice("*** Update File:".length))) {
      throw new Error("Patch must update exactly SKILL.md.");
    }
    const updateIndex = rawLines.findIndex((line) => line.startsWith("*** Update File:"));
    lines = rawLines.slice(updateIndex + 1, endIndex);
  } else {
    const oldIndex = rawLines.findIndex((line) => line.startsWith("--- "));
    if (oldIndex >= 0) {
      const newIndex = rawLines.findIndex((line, index) => index > oldIndex && line.startsWith("+++ "));
      if (newIndex < 0 || !isSkillPath(rawLines[oldIndex].slice(4)) || !isSkillPath(rawLines[newIndex].slice(4))) {
        throw new Error("Unified patch must update exactly SKILL.md.");
      }
      lines = rawLines.slice(newIndex + 1);
    }
  }

  const hunks: PatchHunk[] = [];
  let current: PatchHunk | undefined;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      if (current) {
        hunks.push(current);
      }
      const header = line.match(/^@@(?: -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@)/);
      current = header
        ? { start: Number(header[1]), oldLineCount: Number(header[2] ?? 1), lines: [] }
        : applyPatchFormat
          ? { lines: [] }
          : undefined;
      if (!current) {
        throw new Error(`Invalid unified hunk header: ${line}`);
      }
      continue;
    }
    if (!current || line === "\\ No newline at end of file") {
      continue;
    }
    if (line.length === 0) {
      current.lines.push(" ");
    } else if (line.startsWith(" ") || line.startsWith("+") || line.startsWith("-")) {
      current.lines.push(line);
    } else if (line.trim().length > 0) {
      throw new Error(`Invalid patch line: ${line}`);
    }
  }
  if (current) {
    hunks.push(current);
  }
  if (hunks.length === 0) {
    throw new Error("Patch contains no hunks.");
  }
  return { hunks, applyPatchFormat };
}

function findLines(lines: string[], wanted: string[], from: number): number {
  if (wanted.length === 0) {
    return Math.min(from, lines.length);
  }
  for (let index = from; index <= lines.length - wanted.length; index += 1) {
    if (wanted.every((line, offset) => lines[index + offset] === line)) {
      return index;
    }
  }
  return -1;
}

export interface SkillPatchResult {
  skill?: string;
  errors: string[];
}

export function applySkillPatch(currentSkill: string, patch: string): SkillPatchResult {
  try {
    const parsed = parsePatch(patch);
    const hadFinalNewline = currentSkill.endsWith("\n");
    const normalizedSkill = currentSkill.replace(/\r\n/g, "\n");
    let lines = (hadFinalNewline ? normalizedSkill.slice(0, -1) : normalizedSkill).split("\n");
    let offset = 0;
    let searchFrom = 0;

    for (const hunk of parsed.hunks) {
      const oldLines = hunk.lines
        .filter((line) => line.startsWith(" ") || line.startsWith("-"))
        .map((line) => line.slice(1));
      const newLines = hunk.lines
        .filter((line) => line.startsWith(" ") || line.startsWith("+"))
        .map((line) => line.slice(1));

      let index: number;
      if (!parsed.applyPatchFormat && hunk.start !== undefined) {
        index = (hunk.oldLineCount === 0 ? hunk.start : hunk.start - 1) + offset;
      } else {
        index = findLines(lines, oldLines, searchFrom);
      }
      if (index < 0 || index > lines.length || !oldLines.every((line, lineOffset) => lines[index + lineOffset] === line)) {
        throw new Error("Patch context did not match the current SKILL.md.");
      }
      lines.splice(index, oldLines.length, ...newLines);
      offset += newLines.length - oldLines.length;
      searchFrom = index + newLines.length;
    }

    return { skill: `${lines.join("\n")}${hadFinalNewline ? "\n" : ""}`, errors: [] };
  } catch (error) {
    return { errors: [error instanceof Error ? error.message : String(error)] };
  }
}

export async function writeSkillVersion(path: string, skill: string): Promise<void> {
  await writeText(path, skill.endsWith("\n") ? skill : `${skill}\n`);
}

export interface CandidateSkill {
  skill: string;
  patch?: string;
  reason: string;
  summary?: string;
  validation: SkillValidation;
}

export function candidateFromImprover(raw: unknown, currentSkill: string): CandidateSkill {
  const parsed = parseSkillUpdate(raw);
  if (!parsed.patch) {
    return {
      skill: "",
      reason: parsed.reason,
      summary: parsed.summary,
      validation: {
        valid: false,
        errors: ["Improver response did not contain a patch with a Kira hunk."],
        warnings: []
      }
    };
  }
  const applied = applySkillPatch(currentSkill, parsed.patch);
  if (!applied.skill) {
    return {
      skill: "",
      patch: parsed.patch,
      reason: parsed.reason,
      summary: parsed.summary,
      validation: { valid: false, errors: applied.errors, warnings: [] }
    };
  }
  return {
    skill: applied.skill,
    patch: parsed.patch,
    reason: parsed.reason,
    summary: parsed.summary,
    validation: validateSkillText(applied.skill)
  };
}

export function editRecordForRejection(
  id: string,
  iteration: number,
  caseId: string,
  currentSkill: string,
  failure: SkillEditRecord["failure"],
  candidate: CandidateSkill
): SkillEditRecord {
  return {
    id,
    iteration,
    caseId,
    accepted: false,
    reason: candidate.reason,
    summary: candidate.summary,
    skillBefore: currentSkill,
    patch: candidate.patch,
    validationErrors: candidate.validation.errors,
    failure: failure
  };
}

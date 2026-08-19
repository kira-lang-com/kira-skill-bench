import type { BenchmarkCase } from "./types";

const codeFencePattern = /```([^\r\n`]*)\r?\n([\s\S]*?)```/g;
const likelyKiraStart = /^(?:\s*(?:import\s+\w+|(?:public\s+)?(?:enum|struct|class|function)\b|@[A-Za-z]|Test\s+\w+))/m;

export interface ExtractedSource {
  source: string;
  responseText: string;
  format: "fenced" | "plain" | "json-field";
}

export interface ExtractedProject {
  files: Record<string, string>;
  responseText: string;
  format: "json-project" | "file-blocks";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function parseStructuredText(value: string): unknown {
  let candidate = value.trim();
  const fenced = candidate.match(/^```(?:json|jsonc|text)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/i);
  if (fenced) {
    candidate = fenced[1].trim();
  }
  if (!candidate.startsWith("{") && !candidate.startsWith("[")) {
    return value;
  }
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return value;
  }
}

function normalizeProjectPath(value: string): string | undefined {
  const normalized = value.trim().replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes(":")) {
    return undefined;
  }
  const pieces = normalized.split("/");
  if (pieces.some((piece) => piece.length === 0 || piece === "." || piece === "..")) {
    return undefined;
  }
  if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function directProjectFiles(value: Record<string, unknown>): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [rawPath, contents] of Object.entries(value)) {
    const path = normalizeProjectPath(rawPath);
    if (path && path.endsWith(".kira") && typeof contents === "string") {
      files[path] = contents;
    }
  }
  return files;
}

function projectFilesFromValue(value: unknown, depth = 0): Record<string, string> {
  if (depth > 6 || value === null || value === undefined) {
    return {};
  }

  const parsed = typeof value === "string" ? parseStructuredText(value) : value;
  if (parsed !== value) {
    return projectFilesFromValue(parsed, depth + 1);
  }

  if (Array.isArray(parsed)) {
    const files: Record<string, string> = {};
    for (const child of parsed) {
      const record = asRecord(child);
      if (!record) {
        continue;
      }
      const rawPath = [record.path, record.file, record.filename, record.name]
        .find((candidate): candidate is string => typeof candidate === "string");
      const contents = [record.content, record.source, record.code, record.text, record.value]
        .find((candidate): candidate is string => typeof candidate === "string");
      const path = rawPath ? normalizeProjectPath(rawPath) : undefined;
      if (path && path.endsWith(".kira") && contents !== undefined) {
        files[path] = contents;
      }
    }
    return files;
  }

  const record = asRecord(parsed);
  if (!record) {
    return {};
  }

  const direct = directProjectFiles(record);
  if (Object.keys(direct).length > 0) {
    return direct;
  }

  for (const key of ["files", "project", "fileMap", "file_map", "outputs", "artifacts", "kira"]) {
    if (key in record) {
      const nested = projectFilesFromValue(record[key], depth + 1);
      if (Object.keys(nested).length > 0) {
        return nested;
      }
    }
  }

  for (const child of Object.values(record)) {
    const nested = projectFilesFromValue(child, depth + 1);
    if (Object.keys(nested).length > 0) {
      return nested;
    }
  }
  return {};
}

function pathFromFenceLabel(label: string): string | undefined {
  let candidate = label.trim();
  candidate = candidate.replace(/^kira(?:-lang)?\s*[:=]?\s*/i, "");
  candidate = candidate.replace(/^(?:file|path)\s*[:=]\s*/i, "");
  candidate = candidate.replace(/^['\"`]([\s\S]*)['\"`]$/, "$1").trim();
  return candidate.endsWith(".kira") ? normalizeProjectPath(candidate) : undefined;
}

function projectFilesFromFences(responseText: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const match of responseText.matchAll(codeFencePattern)) {
    const path = pathFromFenceLabel(match[1]);
    if (path) {
      files[path] = match[2].trim();
    }
  }
  return files;
}

function projectFilesFromBlocks(responseText: string): Record<string, string> {
  const files: Record<string, string> = {};
  const lines = responseText.split(/\r?\n/);
  let currentPath: string | undefined;
  let current: string[] = [];

  const flush = () => {
    if (currentPath) {
      files[currentPath] = current.join("\n").trim();
    }
    currentPath = undefined;
    current = [];
  };

  for (const line of lines) {
    const fileMarker = line.match(/^\s*(?:FILE|BEGIN FILE)\s*(?::|=|\s)\s*([^\s]+)\s*$/i);
    const headingMarker = line.match(/^\s*---\s*(?:FILE\s*:\s*)?([^\s]+\.kira)\s*---\s*$/i);
    const endMarker = /^\s*(?:END FILE|END_FILE)\s*$/i.test(line);
    if (fileMarker || headingMarker) {
      flush();
      const rawPath = (fileMarker ?? headingMarker)![1];
      currentPath = normalizeProjectPath(rawPath);
      continue;
    }
    if (endMarker) {
      flush();
      continue;
    }
    if (currentPath) {
      current.push(line);
    }
  }
  flush();
  return Object.fromEntries(Object.entries(files).filter(([path, contents]) => path.endsWith(".kira") && contents.length > 0));
}

function collectTextValues(value: unknown, output: string[] = [], depth = 0): string[] {
  if (depth > 4 || value === null || value === undefined) {
    return output;
  }
  if (typeof value === "string") {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      collectTextValues(child, output, depth + 1);
    }
    return output;
  }
  const record = asRecord(value);
  if (!record) {
    return output;
  }
  const preferredKeys = ["kira", "code", "source", "output_text", "text", "content", "result", "response"];
  for (const key of preferredKeys) {
    if (key in record) {
      collectTextValues(record[key], output, depth + 1);
    }
  }
  for (const [key, child] of Object.entries(record)) {
    if (!preferredKeys.includes(key)) {
      collectTextValues(child, output, depth + 1);
    }
  }
  return output;
}

export function responseToText(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  const textValues = collectTextValues(raw);
  if (textValues.length > 0) {
    return textValues.sort((left, right) => right.length - left.length)[0];
  }
  return JSON.stringify(raw, null, 2) ?? String(raw);
}

function cleanCodeCandidate(value: string): string {
  let result = value.trim();
  result = result.replace(/^```[^\r\n]*\r?\n/, "").replace(/\r?\n```\s*$/, "").trim();
  if (result.startsWith("kira\n")) {
    result = result.slice("kira\n".length).trimStart();
  }

  const startMatch = result.match(likelyKiraStart);
  if (startMatch && startMatch.index !== undefined && startMatch.index > 0) {
    result = result.slice(startMatch.index);
  }
  return result.trim();
}

export function extractKiraSource(raw: unknown): ExtractedSource {
  const responseText = responseToText(raw);
  const fencedCandidates: Array<{ label: string; source: string }> = [];
  for (const match of responseText.matchAll(codeFencePattern)) {
    fencedCandidates.push({ label: match[1].trim().toLowerCase(), source: cleanCodeCandidate(match[2]) });
  }

  const labeled = fencedCandidates.find(({ label }) => label === "kira" || label === "kira-lang" || label === "kira language");
  const fenced = labeled ?? fencedCandidates.find(({ source }) => likelyKiraStart.test(source));
  if (fenced) {
    return { source: fenced.source, responseText, format: "fenced" };
  }

  const candidate = cleanCodeCandidate(responseText);
  if (likelyKiraStart.test(candidate) && /\b(?:function|struct|enum|class)\b|@Main|\bTest\s+\w+/.test(candidate)) {
    return {
      source: candidate,
      responseText,
      format: responseText === candidate ? "plain" : "json-field"
    };
  }

  throw new Error("Agent response did not contain recognizable Kira source. Return a Kira file or a JSON object with a kira/code/source field.");
}

export function extractKiraProject(raw: unknown): ExtractedProject {
  const responseText = responseToText(raw);
  const structured = projectFilesFromValue(raw);
  if (Object.keys(structured).length > 0) {
    return { files: structured, responseText, format: "json-project" };
  }

  const fenced = projectFilesFromFences(responseText);
  if (Object.keys(fenced).length > 0) {
    return { files: fenced, responseText, format: "file-blocks" };
  }

  const blocks = projectFilesFromBlocks(responseText);
  if (Object.keys(blocks).length > 0) {
    return { files: blocks, responseText, format: "file-blocks" };
  }

  throw new Error("Agent response did not contain a Kira project file map. Return JSON with a files object or explicit .kira file blocks.");
}

export function stripPreloadedImports(source: string, benchmarkCase: BenchmarkCase): string {
  const preloadedNames = benchmarkCase.libraries.filter((library) => library.prelude).map((library) => library.name);
  if (preloadedNames.length === 0) {
    return source;
  }
  const namePattern = preloadedNames.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const importPattern = new RegExp(`^\\s*import\\s+(?:${namePattern})(?:\\s+as\\s+[A-Za-z_][A-Za-z0-9_]*)?\\s*$`, "i");
  return source
    .split(/\r?\n/)
    .filter((line) => !importPattern.test(line))
    .join("\n")
    .trim();
}

export function composeEvaluationSource(source: string, benchmarkCase: BenchmarkCase): string {
  const parts: string[] = [];
  let normalizedSource = stripPreloadedImports(source, benchmarkCase);
  if (benchmarkCase.evaluation.mode === "test") {
    // Test/Result/TestFailure live in Foundation. Keep exactly one import even
    // when the generated answer also imports it.
    normalizedSource = normalizedSource
      .split(/\r?\n/)
      .filter((line) => !/^\s*import\s+Foundation(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?\s*$/i.test(line))
      .join("\n")
      .trim();
    parts.push("import Foundation");
  }
  for (const library of benchmarkCase.libraries) {
    if (library.prelude) {
      parts.push(`// evaluator-preloaded fictional library: ${library.name}\n${library.prelude.trim()}`);
    }
  }
  parts.push(normalizedSource);
  if (benchmarkCase.evaluation.hiddenTests?.trim()) {
    parts.push(`// evaluator-hidden-tests\n${benchmarkCase.evaluation.hiddenTests.trim()}`);
  }
  return `${parts.filter((part) => part.trim().length > 0).join("\n\n").trim()}\n`;
}

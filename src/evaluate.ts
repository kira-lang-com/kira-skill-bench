import { dirname, join } from "node:path";
import type { BenchmarkCase, CaseResult, CommandResult, FailureRecord, ProjectSpec, TestSummary } from "./types";
import { composeEvaluationSource, extractKiraProject, extractKiraSource, stripPreloadedImports } from "./extract";
import { renderProcessFailure, runProcess } from "./process";
import { caseArtifactDir, ensureDir, truncate, writeJson, writeText } from "./util";
import { packageManifest } from "./cases";

export interface EvaluateOptions {
  runId: string;
  iteration: number;
  artifactRoot: string;
  kiraBinary: string;
  commandTimeoutMs: number;
}

const KIRA_TEST_SUMMARY = /(\d+)\s+passed,\s+(\d+)\s+failed,\s+(\d+)\s+skipped,\s+(\d+)\s+total\b/i;
const KIRA_LINT_RECEIPT = /\b\d+\s+lint\(s\)\s+ran\b|\breport\(s\)\s+from\s+\d+\s+lint\(s\)\b/i;

export function parseKiraTestSummary(stdout: string): TestSummary | undefined {
  const match = stdout.match(KIRA_TEST_SUMMARY);
  if (!match) {
    return undefined;
  }

  return {
    passed: Number(match[1]),
    failed: Number(match[2]),
    skipped: Number(match[3]),
    total: Number(match[4])
  };
}

export function isGenuineKiraTestPass(summary: TestSummary | undefined): boolean {
  return Boolean(
    summary &&
      summary.total > 0 &&
      summary.passed === summary.total &&
      summary.failed === 0 &&
      summary.skipped === 0
  );
}

export function isGenuineKiraLintPass(stdout: string, stderr = ""): boolean {
  return KIRA_LINT_RECEIPT.test(`${stdout}\n${stderr}`);
}

function commandFailure(
  benchmarkCase: BenchmarkCase,
  iteration: number,
  stage: FailureRecord["stage"],
  result: CommandResult,
  generatedSource: string,
  message = renderProcessFailure(result),
  generatedFiles?: Record<string, string>
): FailureRecord {
  return {
    caseId: benchmarkCase.id,
    title: benchmarkCase.title,
    iteration,
    stage,
    message,
    command: result.command,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
    generatedSource,
    generatedFiles
  };
}

function projectFileFailure(
  benchmarkCase: BenchmarkCase,
  iteration: number,
  message: string,
  files: Record<string, string>
): FailureRecord {
  return {
    caseId: benchmarkCase.id,
    title: benchmarkCase.title,
    iteration,
    stage: "extract",
    message,
    generatedSource: files[benchmarkCase.project?.entryFile ?? "app/main.kira"],
    generatedFiles: files
  };
}

export function hasKiraSemicolon(source: string): boolean {
  let inString = false;
  let escaped = false;
  let inComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inComment) {
      if (character === "\n") {
        inComment = false;
      }
      continue;
    }
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      inComment = true;
      index += 1;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === ";") {
      return true;
    }
  }
  return false;
}

function validateProjectFiles(project: ProjectSpec, files: Record<string, string>): string[] {
  const errors: string[] = [];
  const required = new Set(project.requiredFiles);
  for (const path of project.requiredFiles) {
    if (!(path in files)) {
      errors.push(`Project response is missing required file ${path}.`);
    }
  }
  for (const [path, contents] of Object.entries(files)) {
    if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.kira$/.test(path)) {
      errors.push(`Project response contains an invalid relative Kira path: ${path}.`);
    } else if (!required.has(path) && !project.allowAdditionalFiles) {
      errors.push(`Project response contains unexpected file ${path}.`);
    }
    if (/^\s*Test\s+[A-Za-z_][A-Za-z0-9_]*/m.test(contents)) {
      errors.push(`Generated file ${path} contains a Test declaration; hidden tests are evaluator-owned.`);
    }
    if (hasKiraSemicolon(contents)) {
      errors.push(`Generated file ${path} contains a semicolon; Kira source uses newlines instead.`);
    }
  }
  return errors;
}

export async function evaluateCase(
  benchmarkCase: BenchmarkCase,
  rawResponse: unknown,
  options: EvaluateOptions
): Promise<CaseResult> {
  const artifactDir = caseArtifactDir(options.artifactRoot, options.iteration, benchmarkCase.id);
  await ensureDir(artifactDir);

  const result: CaseResult = {
    caseId: benchmarkCase.id,
    title: benchmarkCase.title,
    iteration: options.iteration,
    attempt: 1,
    passed: false,
    commands: [],
    response: rawResponse
  };

  try {
    if (benchmarkCase.outputMode === "project") {
      if (!benchmarkCase.project) {
        throw new Error(`Project case ${benchmarkCase.id} has no project specification.`);
      }
      const extracted = extractKiraProject(rawResponse);
      const projectErrors = validateProjectFiles(benchmarkCase.project, extracted.files);
      result.files = extracted.files;
      result.responseText = extracted.responseText;
      if (projectErrors.length > 0) {
        result.failure = projectFileFailure(benchmarkCase, options.iteration, projectErrors.join("\n"), extracted.files);
        await writeJson(join(artifactDir, "evaluation.json"), result);
        return result;
      }
      const normalizedFiles = Object.fromEntries(
        Object.entries(extracted.files).map(([path, contents]) => [path, stripPreloadedImports(contents, benchmarkCase)])
      );
      const entrySource = normalizedFiles[benchmarkCase.project.entryFile];
      result.source = entrySource;
      result.preparedSource = composeEvaluationSource(entrySource, benchmarkCase);
      result.preparedFiles = { ...normalizedFiles, [benchmarkCase.project.entryFile]: result.preparedSource };
    } else {
      const extracted = extractKiraSource(rawResponse);
      result.source = extracted.source;
      result.responseText = extracted.responseText;
      if (/^\s*Test\s+[A-Za-z_][A-Za-z0-9_]*/m.test(extracted.source)) {
        throw new Error("Generated source contains a Test declaration; hidden tests are evaluator-owned.");
      }
      if (hasKiraSemicolon(extracted.source)) {
        throw new Error("Generated source contains a semicolon; Kira source uses newlines instead.");
      }
      result.preparedSource = composeEvaluationSource(extracted.source, benchmarkCase);
    }
  } catch (error) {
    result.failure = {
      caseId: benchmarkCase.id,
      title: benchmarkCase.title,
      iteration: options.iteration,
      stage: "extract",
      message: error instanceof Error ? error.message : String(error)
    };
    await writeJson(join(artifactDir, "evaluation.json"), result);
    return result;
  }

  const projectDir = join(artifactDir, "project");
  result.projectDir = projectDir;
  if (benchmarkCase.outputMode === "project" && result.preparedFiles) {
    for (const [relativePath, contents] of Object.entries(result.preparedFiles)) {
      const filePath = join(projectDir, relativePath);
      await ensureDir(dirname(filePath));
      await writeText(filePath, contents);
    }
  } else {
    const appDir = join(projectDir, "app");
    await ensureDir(appDir);
    await writeText(join(projectDir, "package.kira"), packageManifest(`case_${benchmarkCase.id.replace(/[^a-zA-Z0-9_]/g, "_")}`));
    await writeText(join(appDir, "main.kira"), result.preparedSource ?? "");
  }
  await writeText(join(artifactDir, "response.txt"), result.responseText ?? "");
  if (benchmarkCase.outputMode === "project" && result.files && result.preparedFiles) {
    for (const [relativePath, contents] of Object.entries(result.files)) {
      const generatedPath = join(artifactDir, "generated-project", relativePath);
      await ensureDir(dirname(generatedPath));
      await writeText(generatedPath, contents);
    }
    for (const [relativePath, contents] of Object.entries(result.preparedFiles)) {
      const preparedPath = join(artifactDir, "prepared-project", relativePath);
      await ensureDir(dirname(preparedPath));
      await writeText(preparedPath, contents);
    }
  } else {
    await writeText(join(artifactDir, "generated.kira"), result.source ?? "");
    await writeText(join(artifactDir, "prepared.kira"), result.preparedSource ?? "");
  }

  const check = await runProcess([options.kiraBinary, "check", projectDir], {
    cwd: projectDir,
    timeoutMs: options.commandTimeoutMs
  });
  result.commands.push(check);
  if (check.timedOut || check.exitCode !== 0) {
    result.failure = commandFailure(benchmarkCase, options.iteration, "check", check, result.source ?? "", renderProcessFailure(check), result.files);
    await writeJson(join(artifactDir, "evaluation.json"), result);
    return result;
  }

  if (benchmarkCase.evaluation.runLint) {
    const lint = await runProcess([options.kiraBinary, "lint", projectDir], {
      cwd: projectDir,
      timeoutMs: options.commandTimeoutMs
    });
    result.commands.push(lint);
    if (lint.timedOut || lint.exitCode !== 0 || !isGenuineKiraLintPass(lint.stdout, lint.stderr)) {
      result.failure = commandFailure(
        benchmarkCase,
        options.iteration,
        "lint",
        lint,
        result.source ?? "",
        renderProcessFailure(lint),
        result.files
      );
      await writeJson(join(artifactDir, "evaluation.json"), result);
      return result;
    }
  }

  if (benchmarkCase.evaluation.mode === "test") {
    const test = await runProcess([options.kiraBinary, "test"], {
      cwd: projectDir,
      timeoutMs: options.commandTimeoutMs
    });
    result.commands.push(test);
    const testSummary = parseKiraTestSummary(test.stdout);
    result.testSummary = testSummary;
    if (test.timedOut || test.exitCode !== 0 || !isGenuineKiraTestPass(testSummary)) {
      const summaryMessage = testSummary
        ? `Kira test summary: ${testSummary.passed} passed, ${testSummary.failed} failed, ${testSummary.skipped} skipped, ${testSummary.total} total.`
        : "Kira test output did not contain a complete pass summary.";
      result.failure = commandFailure(
        benchmarkCase,
        options.iteration,
        "test",
        test,
        result.source ?? "",
        `${summaryMessage}\n\n${renderProcessFailure(test)}`,
        result.files
      );
      await writeJson(join(artifactDir, "evaluation.json"), result);
      return result;
    }
  } else if (benchmarkCase.evaluation.mode === "run") {
    const run = await runProcess([options.kiraBinary, "run", projectDir], {
      cwd: projectDir,
      timeoutMs: options.commandTimeoutMs
    });
    result.commands.push(run);
    if (run.timedOut || run.exitCode !== 0) {
      result.failure = commandFailure(benchmarkCase, options.iteration, "run", run, result.source ?? "", renderProcessFailure(run), result.files);
      await writeJson(join(artifactDir, "evaluation.json"), result);
      return result;
    }
    for (const expected of benchmarkCase.evaluation.stdoutIncludes ?? []) {
      if (!run.stdout.includes(expected)) {
        result.failure = {
          caseId: benchmarkCase.id,
          title: benchmarkCase.title,
          iteration: options.iteration,
          stage: "assert",
          message: `Expected stdout to include ${JSON.stringify(expected)}. Actual stdout:\n${truncate(run.stdout) ?? ""}`,
          command: run.command,
          exitCode: run.exitCode,
          stdout: truncate(run.stdout),
          stderr: truncate(run.stderr),
          generatedSource: result.source
        };
        await writeJson(join(artifactDir, "evaluation.json"), result);
        return result;
      }
    }
  }

  result.passed = true;
  await writeJson(join(artifactDir, "evaluation.json"), result);
  return result;
}

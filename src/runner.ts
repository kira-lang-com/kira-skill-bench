import { join } from "node:path";
import type {
  AgentResponse,
  BenchmarkBatchResult,
  BenchmarkCase,
  CaseResult,
  FailureRecord,
  GenerateRequest,
  ImproveRequest,
  RunSummary,
  SkillEditHistoryEntry,
  SkillEditRecord
} from "./types";
import type { AgentDriver } from "./agent";
import { AgentInvocationError } from "./agent";
import { toAgentCaseView } from "./cases";
import { evaluateCase } from "./evaluate";
import { responseToText } from "./extract";
import {
  candidateFromImprover,
  editRecordForRejection,
  readSkill,
  validateSkillText,
  writeSkillVersion
} from "./skill";
import {
  caseArtifactDir,
  ensureDir,
  makeRunId,
  sha256,
  truncate,
  writeJson,
  writeText
} from "./util";

export interface RunnerOptions {
  skillPath: string;
  outputDir: string;
  runId?: string;
  cases: BenchmarkCase[];
  driver: AgentDriver;
  kiraBinary: string;
  agentTimeoutMs: number;
  commandTimeoutMs: number;
  maxIterations: number;
  applySkill: boolean;
}

const generationOutputContract = "Return exactly one Kira source file, with no Markdown explanation, no semicolon characters, and no Test declarations. Kira declarations and fields are separated by newlines. The evaluator appends hidden tests and runs kira check/test. One generation attempt is allowed for this case.";
const improvementOutputContract = "Return JSON with patch containing a minimal unified diff that updates only SKILL.md, reason explaining the generalizable change, and optional summary. Do not return the full skill. The harness applies and validates the patch locally. Preserve useful existing guidance; do not mention hidden tests or overfit to one case.";
const generalizationRules = [
  "Fix the smallest general rule that explains the observed failure; do not paste a one-off answer.",
  "Preserve correct existing instructions unless they conflict with the compiler evidence.",
  "Prefer concise imperative guidance and concrete syntax examples over speculative language lore.",
  "Do not add benchmark-specific hidden-test names, expected values, or instructions to cheat the evaluator.",
  "Keep the YAML frontmatter valid and keep the skill body usable for future Kira tasks."
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function generationOutputContractFor(benchmarkCase: BenchmarkCase): string {
  if (benchmarkCase.outputMode !== "project" || !benchmarkCase.project) {
    return generationOutputContract;
  }
  const requiredFiles = benchmarkCase.project.requiredFiles.map((path) => JSON.stringify(path)).join(", ");
  return `Return exactly one JSON object of the form {"files":{"path":"complete file contents"}}. The files object must contain exactly these required Kira project files: ${requiredFiles}. Use relative paths with forward slashes. Kira source never uses semicolon characters; separate declarations, fields, and statements with newlines. Do not return Markdown, explanation, Test declarations, hidden tests, or any extra files. The evaluator writes the returned files, appends hidden tests to ${benchmarkCase.project.entryFile}, then runs the real Kira check/lint/test commands. One generation attempt is allowed for this case.`;
}

function agentFailure(
  benchmarkCase: BenchmarkCase,
  iteration: number,
  error: unknown
): FailureRecord {
  if (error instanceof AgentInvocationError) {
    return {
      caseId: benchmarkCase.id,
      title: benchmarkCase.title,
      iteration,
      stage: "agent",
      message: error.message,
      stdout: truncate(error.stdout),
      stderr: truncate(error.stderr)
    };
  }
  return {
    caseId: benchmarkCase.id,
    title: benchmarkCase.title,
    iteration,
    stage: "agent",
    message: errorMessage(error)
  };
}

function caseResultForAgentFailure(
  benchmarkCase: BenchmarkCase,
  iteration: number,
  failure: FailureRecord
): CaseResult {
  return {
    caseId: benchmarkCase.id,
    title: benchmarkCase.title,
    iteration,
    attempt: 1,
    passed: false,
    commands: [],
    failure
  };
}

async function writeResponseArtifact(artifactDir: string, response: AgentResponse): Promise<void> {
  await writeText(join(artifactDir, "agent-response.txt"), responseToText(response));
  await writeJson(join(artifactDir, "agent-response.json"), response);
}

export class BenchmarkRunner {
  private readonly runId: string;
  private readonly artifactDir: string;
  private currentSkill = "";
  private readonly batches: BenchmarkBatchResult[] = [];
  private readonly edits: SkillEditRecord[] = [];

  constructor(private readonly options: RunnerOptions) {
    this.runId = options.runId ?? makeRunId();
    this.artifactDir = join(options.outputDir, this.runId);
  }

  async runBenchmark(): Promise<RunSummary> {
    await this.initialize();
    const batch = await this.runBatch(1, this.currentSkill);
    this.batches.push(batch);
    await writeSkillVersion(join(this.artifactDir, "final-SKILL.md"), this.currentSkill);
    await this.writeSummary("benchmark", batch.failures.length === 0);
    return this.summary("benchmark", batch.failures.length === 0, 1);
  }

  async runIterative(): Promise<RunSummary> {
    await this.initialize();
    let passed = false;
    let completedIterations = 0;

    for (let iteration = 1; iteration <= this.options.maxIterations; iteration += 1) {
      completedIterations = iteration;
      const batch = await this.runBatch(iteration, this.currentSkill);
      this.batches.push(batch);
      if (batch.failures.length === 0) {
        passed = true;
        break;
      }

      for (const failure of batch.failures) {
        await this.improveForFailure(iteration, failure);
      }
    }

    await writeSkillVersion(join(this.artifactDir, "final-SKILL.md"), this.currentSkill);
    await this.writeSummary("iterate", passed, completedIterations);
    return this.summary("iterate", passed, completedIterations);
  }

  private async initialize(): Promise<void> {
    await ensureDir(this.artifactDir);
    this.currentSkill = await readSkill(this.options.skillPath);
    const validation = validateSkillText(this.currentSkill);
    if (!validation.valid) {
      throw new Error(`Initial skill is invalid:\n${validation.errors.join("\n")}`);
    }
    await writeText(join(this.artifactDir, "initial-SKILL.md"), this.currentSkill);
    await writeJson(join(this.artifactDir, "manifest.json"), {
      runId: this.runId,
      mode: "pending",
      skillPath: this.options.skillPath,
      skillHash: sha256(this.currentSkill),
      agent: this.options.driver.name,
      cases: this.options.cases.map(({ id, title, tags }) => ({ id, title, tags })),
      maxIterations: this.options.maxIterations,
      applySkill: this.options.applySkill
    });
  }

  private async runBatch(iteration: number, skill: string): Promise<BenchmarkBatchResult> {
    const results: CaseResult[] = [];
    for (const benchmarkCase of this.options.cases) {
      const artifactDir = caseArtifactDir(this.artifactDir, iteration, benchmarkCase.id);
      await ensureDir(artifactDir);
      const request: GenerateRequest = {
        protocolVersion: 1,
        kind: "generate",
        runId: this.runId,
        iteration,
        attempt: 1,
        case: toAgentCaseView(benchmarkCase),
        skill,
        outputContract: generationOutputContractFor(benchmarkCase)
      };
      await writeJson(join(artifactDir, "generate-request.json"), request);

      let response: AgentResponse;
      try {
        response = await this.options.driver.generate(request);
        await writeResponseArtifact(artifactDir, response);
      } catch (error) {
        const failure = agentFailure(benchmarkCase, iteration, error);
        const result = caseResultForAgentFailure(benchmarkCase, iteration, failure);
        await writeJson(join(artifactDir, "evaluation.json"), result);
        results.push(result);
        continue;
      }

      const result = await evaluateCase(benchmarkCase, response, {
        runId: this.runId,
        iteration,
        artifactRoot: this.artifactDir,
        kiraBinary: this.options.kiraBinary,
        commandTimeoutMs: this.options.commandTimeoutMs
      });
      results.push(result);
    }

    const failures = results.flatMap((result) => result.failure ? [result.failure] : []);
    const batch: BenchmarkBatchResult = {
      runId: this.runId,
      iteration,
      skillHash: sha256(skill),
      results,
      failures
    };
    await writeJson(join(this.artifactDir, `batch-${String(iteration).padStart(3, "0")}.json`), batch);
    return batch;
  }

  private async improveForFailure(iteration: number, failure: FailureRecord): Promise<void> {
    const benchmarkCase = this.options.cases.find((candidate) => candidate.id === failure.caseId);
    if (!benchmarkCase) {
      throw new Error(`Cannot improve unknown case: ${failure.caseId}`);
    }

    const editNumber = this.edits.length + 1;
    const editId = `edit-${String(editNumber).padStart(3, "0")}`;
    const editDir = join(this.artifactDir, "edits", editId);
    await ensureDir(editDir);
    const request: ImproveRequest = {
      protocolVersion: 1,
      kind: "improve",
      runId: this.runId,
      iteration,
      case: toAgentCaseView(benchmarkCase),
      skillBefore: this.currentSkill,
      failure,
      history: this.edits.map(({ id, iteration: editIteration, caseId, accepted, reason, summary, patch, validationErrors }): SkillEditHistoryEntry => ({
        id,
        iteration: editIteration,
        caseId,
        accepted,
        reason,
        summary,
        patch,
        validationErrors
      })),
      generalizationRules,
      outputContract: improvementOutputContract
    };
    await writeJson(join(editDir, "improve-request.json"), request);

    let response: AgentResponse;
    try {
      response = await this.options.driver.improve(request);
      await writeResponseArtifact(editDir, response);
    } catch (error) {
      const record: SkillEditRecord = {
        id: editId,
        iteration,
      caseId: failure.caseId,
      accepted: false,
      reason: `Improver invocation failed: ${errorMessage(error)}`,
      skillBefore: this.currentSkill,
      validationErrors: ["No candidate skill was returned."],
        failure
      };
      this.edits.push(record);
      await writeJson(join(editDir, "edit.json"), record);
      await writeJson(join(this.artifactDir, "edit-history.json"), this.edits);
      return;
    }

    const candidate = candidateFromImprover(response, this.currentSkill);
    const changed = candidate.validation.valid && candidate.skill.trim() !== this.currentSkill.trim();
    if (!changed) {
      const errors = candidate.validation.errors.length > 0
        ? candidate.validation.errors
        : ["Candidate skill was valid but did not change the current skill."];
      const record = editRecordForRejection(editId, iteration, failure.caseId, this.currentSkill, failure, {
        ...candidate,
        validation: { ...candidate.validation, valid: false, errors }
      });
      this.edits.push(record);
      await writeJson(join(editDir, "edit.json"), record);
      await writeJson(join(this.artifactDir, "edit-history.json"), this.edits);
      return;
    }

    const record: SkillEditRecord = {
      id: editId,
      iteration,
      caseId: failure.caseId,
      accepted: true,
      reason: candidate.reason,
      summary: candidate.summary,
      skillBefore: this.currentSkill,
      skillAfter: candidate.skill,
      patch: candidate.patch,
      failure
    };
    this.currentSkill = candidate.skill;
    this.edits.push(record);
    await writeSkillVersion(join(editDir, "candidate-SKILL.md"), candidate.skill);
    await writeJson(join(editDir, "edit.json"), record);
    await writeJson(join(this.artifactDir, "edit-history.json"), this.edits);

    if (this.options.applySkill) {
      await writeSkillVersion(this.options.skillPath, this.currentSkill);
      await writeText(join(editDir, "applied-to.txt"), this.options.skillPath);
    }
  }

  private async writeSummary(mode: "benchmark" | "iterate", passed: boolean): Promise<void> {
    const summary = this.summary(mode, passed, this.batches.length);
    await writeJson(join(this.artifactDir, "summary.json"), summary);
    const manifestPath = join(this.artifactDir, "manifest.json");
    const manifest = JSON.parse(await Bun.file(manifestPath).text()) as Record<string, unknown>;
    await writeJson(manifestPath, {
      ...manifest,
      mode,
      passed,
      iterations: this.batches.length,
      finishedAt: new Date().toISOString()
    });
  }

  private summary(mode: "benchmark" | "iterate", passed: boolean, iterations: number): RunSummary {
    return {
      runId: this.runId,
      mode,
      skillPath: this.options.skillPath,
      artifactDir: this.artifactDir,
      iterations,
      batches: this.batches,
      edits: this.edits,
      finalSkillPath: join(this.artifactDir, "final-SKILL.md"),
      passed
    };
  }
}

export function formatRunSummary(summary: RunSummary): string {
  const lastBatch = summary.batches[summary.batches.length - 1];
  const passedCount = lastBatch?.results.filter((result) => result.passed).length ?? 0;
  const total = lastBatch?.results.length ?? 0;
  const editCount = summary.edits.filter((edit) => edit.accepted).length;
  const caseStatuses = lastBatch?.results.map((result) => {
    if (result.passed) {
      return `case ${result.caseId}: passed`;
    }

    const firstFailureLine = result.failure?.message.split(/\r?\n/, 1)[0] ?? "unknown failure";
    return `case ${result.caseId}: failed — ${firstFailureLine}`;
  }) ?? [];
  return [
    `${summary.mode} ${summary.passed ? "passed" : "did not pass"}: ${passedCount}/${total} cases in final iteration`,
    ...caseStatuses,
    `run: ${summary.runId}`,
    `artifacts: ${summary.artifactDir}`,
    `skill edits accepted: ${editCount}`,
    `final skill snapshot: ${summary.finalSkillPath}`
  ].join("\n");
}

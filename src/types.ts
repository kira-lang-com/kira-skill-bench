export type EvaluationMode = "test" | "check" | "run";
export type OutputMode = "source" | "project";

export interface ProjectSpec {
  /** Relative files the model must return for this project case. */
  requiredFiles: string[];
  /** File that receives evaluator-hidden tests. */
  entryFile: string;
  /** Root-level linter configuration file that must be compiled by `kira lint`. */
  lintFile?: string;
  /** Allow additional relative `.kira` files beyond requiredFiles. */
  allowAdditionalFiles?: boolean;
}

export interface LibrarySpec {
  name: string;
  kind: "builtin" | "fictional";
  purpose: string;
  contract: string;
  /** Optional source that the evaluator preloads into the generated package. */
  prelude?: string;
}

export interface EvaluationSpec {
  mode: EvaluationMode;
  hiddenTests?: string;
  /** Optional regular expressions that must appear in a run's stdout. */
  stdoutIncludes?: string[];
  /** Run `kira lint` after checking a model-authored project. */
  runLint?: boolean;
}

export interface BenchmarkCase {
  id: string;
  title: string;
  prompt: string;
  tags: string[];
  libraries: LibrarySpec[];
  outputMode?: OutputMode;
  project?: ProjectSpec;
  evaluation: EvaluationSpec;
  /** A local, deterministic answer used only by the fixture adapter/smoke tests. */
  fixtureSource?: string;
  /** A local, deterministic multi-file answer used only by fixture smoke tests. */
  fixtureFiles?: Record<string, string>;
}

export interface AgentCaseView {
  id: string;
  title: string;
  prompt: string;
  tags: string[];
  libraries: Array<Pick<LibrarySpec, "name" | "kind" | "purpose" | "contract">>;
  outputMode: OutputMode;
  project?: ProjectSpec;
}

export interface GenerateRequest {
  protocolVersion: 1;
  kind: "generate";
  runId: string;
  iteration: number;
  attempt: 1;
  case: AgentCaseView;
  skill: string;
  outputContract: string;
}

export interface FailureRecord {
  caseId: string;
  title: string;
  iteration: number;
  stage: "agent" | "extract" | "check" | "test" | "run" | "assert";
  message: string;
  command?: string[];
  exitCode?: number | null;
  timedOut?: boolean;
  stdout?: string;
  stderr?: string;
  generatedSource?: string;
  generatedFiles?: Record<string, string>;
}

export interface ImproveRequest {
  protocolVersion: 1;
  kind: "improve";
  runId: string;
  iteration: number;
  case: AgentCaseView;
  skillBefore: string;
  failure: FailureRecord;
  /** Compact ordered history: each prior edit is represented by its patch and rationale. */
  history: SkillEditHistoryEntry[];
  generalizationRules: string[];
  outputContract: string;
}

export interface SkillEditHistoryEntry {
  id: string;
  iteration: number;
  caseId: string;
  accepted: boolean;
  reason: string;
  summary?: string;
  patch?: string;
  validationErrors?: string[];
}

export interface SkillEditRecord {
  id: string;
  iteration: number;
  caseId: string;
  accepted: boolean;
  reason: string;
  summary?: string;
  patch?: string;
  skillBefore: string;
  skillAfter?: string;
  validationErrors?: string[];
  failure: FailureRecord;
}

export interface CommandResult {
  command: string[];
  cwd: string;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface TestSummary {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

export interface CaseResult {
  caseId: string;
  title: string;
  iteration: number;
  attempt: 1;
  passed: boolean;
  source?: string;
  files?: Record<string, string>;
  preparedFiles?: Record<string, string>;
  preparedSource?: string;
  projectDir?: string;
  response?: unknown;
  responseText?: string;
  commands: CommandResult[];
  testSummary?: TestSummary;
  failure?: FailureRecord;
}

export interface BenchmarkBatchResult {
  runId: string;
  iteration: number;
  skillHash: string;
  results: CaseResult[];
  failures: FailureRecord[];
}

export interface RunSummary {
  runId: string;
  mode: "benchmark" | "iterate";
  skillPath: string;
  artifactDir: string;
  iterations: number;
  batches: BenchmarkBatchResult[];
  edits: SkillEditRecord[];
  finalSkillPath?: string;
  passed: boolean;
}

export type AgentResponse = unknown;

import { pathToFileURL } from "node:url";
import { isAbsolute, resolve } from "node:path";
import type { AgentResponse, GenerateRequest, ImproveRequest } from "./types";
import { getBenchmarkCases } from "./cases";
import { renderProcessFailure, runProcess } from "./process";
import { splitCommand } from "./util";

export interface AgentDriver {
  readonly name: string;
  generate(request: GenerateRequest): Promise<AgentResponse>;
  improve(request: ImproveRequest): Promise<AgentResponse>;
}

export class AgentInvocationError extends Error {
  constructor(
    message: string,
    public readonly command?: string[],
    public readonly stdout?: string,
    public readonly stderr?: string
  ) {
    super(message);
    this.name = "AgentInvocationError";
  }
}

function parseAgentOutput(stdout: string): AgentResponse {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new AgentInvocationError("Agent returned no output.");
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // Plain Kira source is an intentional part of the protocol. Preserve it
    // verbatim so the source extractor can handle Markdown fences if present.
    return stdout;
  }
}

function canonicalizeFixtureSource(source: string): string {
  // The fixture answers predate the canonical no-semicolon style. Keep the
  // deterministic harness aligned with the same output contract as real agents.
  return source.replaceAll(";", "");
}

export class ProcessAgentDriver implements AgentDriver {
  readonly name: string;
  private readonly generator: string[];
  private readonly improver: string[];
  private readonly cwd: string;
  private readonly timeoutMs: number;

  constructor(options: {
    generatorCommand: string;
    improverCommand?: string;
    cwd: string;
    timeoutMs: number;
  }) {
    this.generator = splitCommand(options.generatorCommand);
    this.improver = splitCommand(options.improverCommand ?? options.generatorCommand);
    this.cwd = options.cwd;
    this.timeoutMs = options.timeoutMs;
    this.name = `process:${options.generatorCommand}`;
  }

  async generate(request: GenerateRequest): Promise<AgentResponse> {
    return this.call(this.generator, request);
  }

  async improve(request: ImproveRequest): Promise<AgentResponse> {
    return this.call(this.improver, request);
  }

  private async call(command: string[], request: GenerateRequest | ImproveRequest): Promise<AgentResponse> {
    const result = await runProcess(command, {
      cwd: this.cwd,
      timeoutMs: this.timeoutMs,
      stdin: `${JSON.stringify(request)}\n`
    });
    if (result.timedOut || result.exitCode !== 0) {
      throw new AgentInvocationError(renderProcessFailure(result), command, result.stdout, result.stderr);
    }
    return parseAgentOutput(result.stdout);
  }
}

export interface AgentModule {
  generate(request: GenerateRequest): Promise<AgentResponse> | AgentResponse;
  improve(request: ImproveRequest): Promise<AgentResponse> | AgentResponse;
}

export class ModuleAgentDriver implements AgentDriver {
  readonly name: string;
  private readonly modulePath: string;
  private readonly modulePromise: Promise<AgentModule>;

  constructor(modulePath: string, baseDir: string) {
    this.modulePath = modulePath;
    this.name = `module:${modulePath}`;
    const resolved = modulePath.startsWith("file:")
      ? modulePath
      : pathToFileURL(isAbsolute(modulePath) ? modulePath : resolve(baseDir, modulePath)).href;
    this.modulePromise = import(resolved).then((module) => {
      const candidate = (module.default ?? module) as Partial<AgentModule>;
      if (typeof candidate.generate !== "function" || typeof candidate.improve !== "function") {
        throw new Error(`Agent module must export generate(request) and improve(request): ${modulePath}`);
      }
      return candidate as AgentModule;
    });
  }

  async generate(request: GenerateRequest): Promise<AgentResponse> {
    return (await this.modulePromise).generate(request);
  }

  async improve(request: ImproveRequest): Promise<AgentResponse> {
    return (await this.modulePromise).improve(request);
  }
}

export class FixtureAgentDriver implements AgentDriver {
  readonly name = "fixture";

  async generate(request: GenerateRequest): Promise<AgentResponse> {
    const benchmarkCase = getBenchmarkCases([request.case.id])[0];
    if (!benchmarkCase) {
      throw new Error(`No benchmark case is registered for ${request.case.id}`);
    }
    if (process.env.KIRA_FIXTURE_FAIL_FIRST === "1" && request.iteration === 1) {
      return { kira: "This is intentionally not Kira source." };
    }
    if (benchmarkCase.outputMode === "project") {
      if (!benchmarkCase.fixtureFiles) {
        throw new Error(`No fixture project is registered for case ${request.case.id}`);
      }
      return {
        files: Object.fromEntries(
          Object.entries(benchmarkCase.fixtureFiles).map(([path, source]) => [path, canonicalizeFixtureSource(source)])
        )
      };
    }
    if (!benchmarkCase.fixtureSource) {
      throw new Error(`No fixture source is registered for case ${request.case.id}`);
    }
    return { kira: canonicalizeFixtureSource(benchmarkCase.fixtureSource) };
  }

  async improve(request: ImproveRequest): Promise<AgentResponse> {
    if (process.env.KIRA_FIXTURE_FAIL_FIRST === "1") {
      return {
        updatedSkill: `${request.skillBefore.trim()}\n\n<!-- fixture edit ${request.history.length + 1} -->\n`,
        reason: "Fixture improver demonstrates that each first-pass failure is surfaced with an auditable skill edit.",
        summary: "Added a harmless marker for the iterative smoke test."
      };
    }
    return {
      updatedSkill: request.skillBefore,
      reason: "Fixture improver keeps the skill unchanged; use a real improver to learn from failures.",
      summary: "No-op fixture improvement."
    };
  }
}

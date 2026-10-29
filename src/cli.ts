import { resolve } from "node:path";
import { FixtureAgentDriver, ModuleAgentDriver, ProcessAgentDriver, type AgentDriver } from "./agent";
import { getBenchmarkCases } from "./cases";
import { formatRunSummary, BenchmarkRunner } from "./runner";
import { resolveFrom } from "./util";

const defaultSkillPath = "skill/SKILL.md";

interface CliOptions {
  skill: string;
  out: string;
  caseIds: string[];
  agentCommand?: string;
  generatorCommand?: string;
  improverCommand?: string;
  agentModule?: string;
  fixtureAgent: boolean;
  kira: string;
  agentTimeoutMs: number;
  commandTimeoutMs: number;
  maxIterations: number;
  applySkill: boolean;
}

function printHelp(): void {
  console.log(`kira-skill-bench

Commands:
  benchmark             Run each case once with the current skill.
  iterate              Run benchmark iterations and improve the skill once per failure.
  list                 List the included benchmark cases.

Agent adapters:
  --agent-command CMD  Start a JSON-lines-compatible process for both generate and improve.
  --generator-command CMD
  --improver-command CMD
                       Use separate processes. Each receives one JSON request on stdin.
  --agent-module PATH  Import a Bun module exporting generate(request) and improve(request).
  --fixture-agent      Use the deterministic local fixture agent for smoke tests.

Common options:
  --skill PATH         Skill file (defaults to KIRA_SKILL_PATH or the configured Kira skill path).
  --case ID[,ID]       Case selection; default is all.
  --out DIR            Artifact root (default: ./runs).
  --kira PATH          Kira executable (default: kira).
  --max-iterations N   Iterations for iterate (default: 5).
  --apply-skill        Write accepted revisions back to --skill during iterate.
  --agent-timeout-ms N
  --command-timeout-ms N
                       Timeouts for agent and Kira subprocesses.

The process/module protocol is vendor-neutral. A Claude Agents SDK or OpenAI AppServer
wrapper can implement the two functions without changing this evaluator; the generated
programs' fictional libraries are just Kira benchmark fixtures.`);
}

function takeOption(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const equals = args.find((arg) => arg.startsWith(prefix));
  if (equals) {
    return equals.slice(prefix.length);
  }
  const index = args.indexOf(name);
  if (index >= 0) {
    return args[index + 1];
  }
  return undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name) || args.some((arg) => arg === `${name}=true`);
}

function numberOption(args: string[], name: string, fallback: number): number {
  const value = takeOption(args, name);
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
}

function parseOptions(args: string[]): CliOptions {
  const caseOption = takeOption(args, "--case") ?? "all";
  const caseIds = caseOption.split(",").map((value) => value.trim()).filter(Boolean);
  const skill = takeOption(args, "--skill") ?? process.env.KIRA_SKILL_PATH ?? defaultSkillPath;
  const out = takeOption(args, "--out") ?? "runs";
  const agentCommand = takeOption(args, "--agent-command");
  const generatorCommand = takeOption(args, "--generator-command");
  const improverCommand = takeOption(args, "--improver-command");
  const agentModule = takeOption(args, "--agent-module");
  const fixtureAgent = hasFlag(args, "--fixture-agent");

  const adapterCount = [fixtureAgent, Boolean(agentModule), Boolean(agentCommand || generatorCommand)].filter(Boolean).length;
  if (adapterCount > 1) {
    throw new Error("Choose one of --fixture-agent, --agent-module, or the process command options.");
  }
  if (!fixtureAgent && !agentModule && !agentCommand && !generatorCommand) {
    throw new Error("Select an agent adapter with --agent-command, --agent-module, or --fixture-agent.");
  }

  return {
    skill,
    out,
    caseIds,
    agentCommand,
    generatorCommand,
    improverCommand,
    agentModule,
    fixtureAgent,
    kira: takeOption(args, "--kira") ?? "kira",
    agentTimeoutMs: numberOption(args, "--agent-timeout-ms", 120_000),
    commandTimeoutMs: numberOption(args, "--command-timeout-ms", 45_000),
    maxIterations: numberOption(args, "--max-iterations", 5),
    applySkill: hasFlag(args, "--apply-skill")
  };
}

function makeDriver(options: CliOptions): AgentDriver {
  if (options.fixtureAgent) {
    return new FixtureAgentDriver();
  }
  if (options.agentModule) {
    return new ModuleAgentDriver(options.agentModule, process.cwd());
  }
  return new ProcessAgentDriver({
    generatorCommand: options.generatorCommand ?? options.agentCommand!,
    improverCommand: options.improverCommand,
    cwd: process.cwd(),
    timeoutMs: options.agentTimeoutMs
  });
}

async function main(): Promise<void> {
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command === "list") {
    for (const benchmarkCase of getBenchmarkCases(["all"])) {
      console.log(`${benchmarkCase.id}\t${benchmarkCase.title}`);
    }
    return;
  }
  if (command !== "benchmark" && command !== "bench" && command !== "iterate") {
    throw new Error(`Unknown command ${command}. Use benchmark, iterate, or list.`);
  }

  const options = parseOptions(args);
  const runner = new BenchmarkRunner({
    skillPath: resolveFrom(process.cwd(), options.skill),
    outputDir: resolveFrom(process.cwd(), options.out),
    cases: getBenchmarkCases(options.caseIds),
    driver: makeDriver(options),
    kiraBinary: options.kira,
    agentTimeoutMs: options.agentTimeoutMs,
    commandTimeoutMs: options.commandTimeoutMs,
    maxIterations: options.maxIterations,
    applySkill: options.applySkill
  });
  const summary = command === "iterate"
    ? await runner.runIterative()
    : await runner.runBenchmark();
  console.log(formatRunSummary(summary));
  process.exitCode = summary.passed ? 0 : 1;
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

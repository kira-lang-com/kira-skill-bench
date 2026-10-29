import type { GenerateRequest, ImproveRequest } from "../src/types";
import { join } from "node:path";

type AdapterRequest = GenerateRequest | ImproveRequest;
type JsonObject = Record<string, unknown>;

interface RpcMessage {
  id?: number | string;
  method?: string;
  params?: JsonObject;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

interface TurnState {
  text: string;
  sawAgentMessage: boolean;
  completed: boolean;
  violation?: string;
  error?: string;
}

function appServerBinary(): string {
  if (process.env.CODEX_APP_SERVER_BIN) {
    return process.env.CODEX_APP_SERVER_BIN;
  }
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, "Programs", "OpenAI", "Codex", "bin", "codex.exe");
  }
  return "codex";
}

function promptFor(request: AdapterRequest): string {
  if (request.kind === "generate") {
    const projectInstruction = request.case.outputMode === "project"
      ? "This case requests a complete Kira project file map; return that exact file map and nothing else."
      : "This case requests one complete Kira source file; return that source and nothing else.";
    return `You are the generator in a strict one-turn Kira syntax benchmark. This is your only model turn. You have no tools, no browsing, no shell, no file access, no MCP, and no follow-up. ${projectInstruction} Do not include explanation, Markdown fences, semicolon characters, or Test declarations. The evaluator supplies hidden tests.

<skill>
${request.skill}
</skill>

<public_task>
${request.case.prompt}
</public_task>

<project_layout>
${JSON.stringify(request.case.project ?? null, null, 2)}
</project_layout>

<library_contracts>
${JSON.stringify(request.case.libraries, null, 2)}
</library_contracts>

${request.outputContract}`;
  }

  return `You are the skill improver in a strict one-turn Kira benchmark. This is your only model turn. You have no tools, no browsing, no shell, no file access, no MCP, and no follow-up. Diagnose the concrete failure and make the smallest generalizable improvement to the skill. Do not copy hidden-test details into the skill.

<skill_before>
${request.skillBefore}
</skill_before>

<public_task>
${request.case.prompt}
</public_task>

<failure>
${JSON.stringify(request.failure, null, 2)}
</failure>

<complete_edit_history>
${JSON.stringify(request.history, null, 2)}
</complete_edit_history>

<generalization_rules>
${request.generalizationRules.map((rule) => `- ${rule}`).join("\n")}
</generalization_rules>

Return JSON with patch containing a minimal unified diff that updates only SKILL.md, reason explaining the reusable change, and optional summary. Do not re-output the complete skill. Use either standard unified-diff syntax or this exact apply-patch shape:
*** Begin Patch
*** Update File: SKILL.md
@@
-old line
+new line
*** End Patch
${request.outputContract}`;
}

class JsonRpcProcess {
  private readonly child: ReturnType<typeof Bun.spawn>;
  private readonly readerTask: Promise<void>;
  private readonly queue: RpcMessage[] = [];
  private readonly waiters: Array<{
    resolve: (message: RpcMessage) => void;
    reject: (error: Error) => void;
  }> = [];
  private closedError: Error | undefined;
  private nextId = 1;

  constructor(child: ReturnType<typeof Bun.spawn>) {
    this.child = child;
    this.readerTask = this.readStdout();
  }

  get done(): Promise<void> {
    return this.readerTask;
  }

  send(method: string, params?: JsonObject): number {
    const id = this.nextId++;
    const stdin = this.child.stdin;
    if (!stdin || typeof stdin === "string") {
      throw new Error("Codex app-server stdin is unavailable.");
    }
    stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return id;
  }

  notify(method: string, params?: JsonObject): void {
    const stdin = this.child.stdin;
    if (!stdin || typeof stdin === "string") {
      throw new Error("Codex app-server stdin is unavailable.");
    }
    stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  async next(): Promise<RpcMessage> {
    if (this.queue.length > 0) {
      return this.queue.shift()!;
    }
    if (this.closedError) {
      throw this.closedError;
    }
    return new Promise<RpcMessage>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  async request(method: string, params: JsonObject, onMessage: (message: RpcMessage) => void): Promise<unknown> {
    const id = this.send(method, params);
    while (true) {
      const message = await this.next();
      if (message.id === id) {
        if (message.error) {
          throw new Error(`${method} failed: ${message.error.message ?? JSON.stringify(message.error)}`);
        }
        return message.result;
      }
      onMessage(message);
    }
  }

  kill(): void {
    try {
      this.child.kill();
    } catch {
      // The process may already have exited.
    }
  }

  async waitForExit(): Promise<number> {
    return this.child.exited;
  }

  private enqueue(message: RpcMessage): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve(message);
    } else {
      this.queue.push(message);
    }
  }

  private fail(error: Error): void {
    this.closedError = error;
    while (this.waiters.length > 0) {
      this.waiters.shift()!.reject(error);
    }
  }

  private async readStdout(): Promise<void> {
    const stdout = this.child.stdout;
    if (!stdout || typeof stdout === "string") {
      this.fail(new Error("Codex app-server stdout is unavailable."));
      return;
    }

    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let pending = "";

    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          pending += decoder.decode();
          if (pending.trim().length > 0) {
            this.enqueue(JSON.parse(pending) as RpcMessage);
          }
          this.fail(new Error("Codex app-server closed stdout."));
          return;
        }

        pending += decoder.decode(chunk.value, { stream: true });
        let newline = pending.indexOf("\n");
        while (newline >= 0) {
          const line = pending.slice(0, newline).trim();
          pending = pending.slice(newline + 1);
          if (line.length > 0) {
            this.enqueue(JSON.parse(line) as RpcMessage);
          }
          newline = pending.indexOf("\n");
        }
      }
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

function inspectMessage(message: RpcMessage, state: TurnState): void {
  if (message.id !== undefined && message.method) {
    throw new Error(`Codex app-server requested a client action: ${message.method}`);
  }

  const method = message.method;
  const params = message.params ?? {};
  if (method && /^(?:item\/(?:commandExecution|fileChange|mcpToolCall|dynamicToolCall|collabAgentToolCall|subAgentActivity|webSearch|imageView|imageGeneration)|command\/exec|process\/)/.test(method)) {
    state.violation = `Codex app-server emitted a forbidden action notification: ${method}`;
    throw new Error(state.violation);
  }
  if (method === "error") {
    state.error = JSON.stringify(params);
    return;
  }
  if (method === "turn/completed") {
    state.completed = true;
    const turn = params.turn as JsonObject | undefined;
    if (turn?.status === "failed") {
      state.error = JSON.stringify(turn.error ?? turn);
    }
    return;
  }
  if (method === "item/agentMessage/delta") {
    const delta = params.delta;
    if (typeof delta === "string") {
      state.text += delta;
      state.sawAgentMessage = true;
    }
    return;
  }
  if (method === "item/started" || method === "item/completed") {
    const item = params.item as JsonObject | undefined;
    const itemType = item?.type;
    if (itemType === "agentMessage") {
      if (!state.sawAgentMessage && typeof item.text === "string") {
        state.text = item.text;
        state.sawAgentMessage = true;
      }
      return;
    }
    if (itemType === "reasoning" || itemType === "plan" || itemType === "userMessage") {
      return;
    }
    if (itemType) {
      state.violation = `Codex app-server emitted a tool/action item: ${itemType}`;
      throw new Error(state.violation);
    }
  }
}

async function runTurn(request: AdapterRequest): Promise<string> {
  const child = Bun.spawn([appServerBinary(), "app-server", "--stdio"], {
    cwd: process.cwd(),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe"
  });
  const rpc = new JsonRpcProcess(child);
  const stderrPromise = child.stderr ? new Response(child.stderr).text() : Promise.resolve("");
  const state: TurnState = { text: "", sawAgentMessage: false, completed: false };
  const timeoutMs = Number(process.env.CODEX_APP_SERVER_TIMEOUT_MS ?? 120_000);
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(`Codex app-server timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  const run = async (): Promise<void> => {
    await rpc.request(
      "initialize",
      {
        clientInfo: {
          name: "kira-skill-bench",
          title: "Kira skill benchmark",
          version: "0.1.0"
        },
        capabilities: {
          experimentalApi: true,
          optOutNotificationMethods: ["thread/started", "thread/status/changed", "thread/tokenUsage/updated"]
        }
      },
      (message) => inspectMessage(message, state)
    );
    rpc.notify("initialized");

    const threadResult = await rpc.request(
      "thread/start",
      {
        cwd: process.cwd(),
        model: process.env.CODEX_APP_SERVER_MODEL ?? "gpt-5.6-sol",
        ephemeral: true,
        approvalPolicy: "never",
        sandbox: "read-only",
        environments: [],
        dynamicTools: [],
        developerInstructions: "This benchmark permits exactly one model turn. Do not use tools, commands, browsing, files, MCP, subagents, or follow-up turns. Return only the requested output."
      },
      (message) => inspectMessage(message, state)
    ) as JsonObject;
    const thread = threadResult.thread as JsonObject | undefined;
    const threadId = thread?.id;
    if (typeof threadId !== "string") {
      throw new Error(`thread/start returned no thread id: ${JSON.stringify(threadResult)}`);
    }

    await rpc.request(
      "turn/start",
      {
        threadId,
        input: [{ type: "text", text: promptFor(request) }],
        model: process.env.CODEX_APP_SERVER_MODEL ?? "gpt-5.6-sol",
        effort: process.env.CODEX_APP_SERVER_EFFORT ?? "medium",
        summary: "none",
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly", networkAccess: false },
        environments: []
      },
      (message) => inspectMessage(message, state)
    );

    while (!state.completed) {
      inspectMessage(await rpc.next(), state);
    }
    if (state.error) {
      throw new Error(`Codex app-server turn failed: ${state.error}`);
    }
    if (!state.sawAgentMessage || !state.text.trim()) {
      throw new Error("Codex app-server returned no final agent message.");
    }
  };

  let caught: Error | undefined;
  const runPromise = run();
  try {
    await Promise.race([runPromise, timeout]);
  } catch (error) {
    caught = error instanceof Error ? error : new Error(String(error));
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    rpc.kill();
    await Promise.allSettled([runPromise, rpc.done, rpc.waitForExit(), stderrPromise]);
  }

  if (caught) {
    const stderr = await stderrPromise;
    throw new Error(`${caught.message}${stderr.trim() ? `\n${stderr.trim()}` : ""}`);
  }
  return state.text.trim();
}

const input = await new Response(Bun.stdin).text();
const request = JSON.parse(input) as AdapterRequest;
const output = await runTurn(request);

if (request.kind === "generate") {
  console.log(JSON.stringify({ kira: output }));
} else {
  console.log(output);
}

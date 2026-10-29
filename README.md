# Kira skill benchmark

This Bun project evaluates an agent that writes Kira source against the real `kira` compiler. It has two modes:

- `benchmark`: every case receives the current `SKILL.md`, a compact task prompt, and exactly one generation attempt. The generated source is placed in a temporary package, then checked and tested.
- `iterate`: runs benchmark batches and calls an improver once for every failure. The improver receives the current skill, the raw failure, and compact ordered history containing prior patches and rationales. Accepted revisions are versioned; use `--apply-skill` to write them back to the target skill.

The bundled skill is [`skill/SKILL.md`](skill/SKILL.md), and is the default used by the benchmark. Set `KIRA_SKILL_PATH` or pass `--skill` to use another copy.

The fictional `KiraTools` and `FlagKit` libraries are deterministic evaluator fixtures. Their contracts are included in the agent request, while their tiny Kira preludes are injected only into the evaluator. The tool-calling example is therefore a training shape, not an implementation of OpenAI or Anthropic tool protocols.

## Quick smoke test

The repository includes a deterministic fixture agent so the harness can be checked without model credentials:

```powershell
bun run fixture:bench
```

This is a local harness check for deterministic harness behavior. The real benchmark currently contains 39 cases, including five model-authored multi-file projects.

The same fixture through the real subprocess protocol is available for adapter smoke tests:

```powershell
bun run bench -- --agent-command "bun run adapters/fixture-process.ts"
```

## Run a real agent

### OpenAI Codex App Server

The included adapter launches the installed Codex App Server over stdio, sends exactly one turn per request, defaults to `gpt-5.6-sol` at medium effort, disables environments and dynamic tools, and rejects action items. Run the full benchmark with:

```powershell
bun run appserver:bench
```

Iterative improvement uses the same one-turn boundary; improvers return compact patches that the harness applies locally:

```powershell
bun run appserver:iterate -- --max-iterations 5
```

The preferred integration boundary is a single process that reads one JSON object from stdin and writes one response to stdout:

```powershell
bun run bench -- `
  --agent-command "bun run adapters/my-agent.ts" `
  --skill "C:\path\to\working-with-kira\SKILL.md"
```

The process receives `kind: "generate"` requests. For `iterate`, the same process receives `kind: "improve"` requests as well; improvement responses contain a minimal patch instead of re-outputting the whole skill. Use separate commands when the generator and improver are different agents:

```powershell
bun run iterate -- `
  --generator-command "bun run adapters/generator.ts" `
  --improver-command "bun run adapters/improver.ts" `
  --skill "C:\path\to\working-with-kira\SKILL.md" `
  --max-iterations 5 `
  --apply-skill
```

The process adapter is deliberately vendor-neutral. A Claude Agents SDK wrapper or an OpenAI AppServer wrapper can read the request, pass `request.skill` and `request.case.prompt` to its agent, and return either plain Kira or JSON such as:

```json
{"kira":"@Main\nfunction main() { return }"}
```

An in-process Bun module is also supported:

```powershell
bun run bench -- --agent-module adapters/my-agent-module.ts
```

That module must export `generate(request)` and `improve(request)`. The harness itself does not implement either vendor's tool-calling protocol; it only defines a stable request/response boundary around the generated Kira artifact.

Each generation attempt is strict one-shot evaluation: one model turn, no tools, no browsing, no shell, no MCP calls, no subagents, and no hidden retries. Vendor adapters must enforce that policy inside their runtime. Generated Kira must contain no semicolon syntax or `Test` declarations. The harness rejects any returned result that does not satisfy the benchmark contract; the SDK/AppServer wrapper is responsible for preventing extra turns and tool calls before returning it.

## What is evaluated

Each case has public requirements and evaluator-only scalar tests. The agent never receives the hidden test source. The evaluator:

1. extracts Kira from plain text, a Kira Markdown fence, or a JSON `kira`/`code`/`source` field;
2. for source cases, creates `package.kira` and `app/main.kira`; for project cases, writes the model-authored `package.kira`, `linter.kira`, and `app/*.kira` files;
3. injects the deterministic fictional-library prelude and hidden tests;
4. runs `kira check`, `kira lint` for project cases, and `kira test`; and
5. records the full command output, source, and failure stage.

The 39 bundled cases cover enums and `match`, arrays and `borrow`, mutable borrowing, Result handling, closures, struct methods, fictional libraries, small/medium/large app-shaped programs, synchronous Kira representations of programmatic tool-call workflows, and complete projects where the model authors `package.kira`, `linter.kira`, and one or more `app/*.kira` files.

## Artifacts and iteration

Runs are written below `runs/<run-id>/` by default. Important files include:

- `initial-SKILL.md` and `final-SKILL.md`;
- `iteration-###/<case-id>/generate-request.json`, generated/prepared source or project trees, and `evaluation.json`;
- `edits/edit-###/improve-request.json`, `candidate-SKILL.md`, and `edit.json`; and
- `edit-history.json` with every accepted or rejected edit, its rationale, failure, and complete before/after skill text.

The improver is instructed to make generalizable, concise changes and not to copy hidden-test details into the skill. Invalid or unchanged candidates are retained as rejected edits and never overwrite the current skill.

## Development checks

```powershell
bun test
bun run fixture:bench
```

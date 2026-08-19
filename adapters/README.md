# Agent adapter contract

The benchmark intentionally has no dependency on a model vendor. An adapter is a thin bridge from the harness request to an agent runtime such as the Claude Agents SDK or an OpenAI AppServer.

## Strict one-turn policy

Every generator attempt is exactly one model turn. The runtime wrapper must disable all tools, browsing, file access, shell access, MCP calls, subagents, and follow-up turns. It must return the first response immediately. The harness calls the adapter once per case; an adapter must not hide an internal retry or agent loop behind that call.

For Claude Agents SDK, configure the one-shot call with an empty tool list and no subagents. For OpenAI AppServer, send one model request with no tool definitions and do not send a follow-up response after the first output. If a runtime cannot enforce this, the adapter should reject the attempt rather than silently evaluating a tool-assisted answer.

The included `codex-app-server.ts` launches the installed Codex App Server over stdio. It defaults to `gpt-5.6-sol` at medium effort, starts an ephemeral thread, sends one `turn/start`, supplies empty environments and dynamic tools, and rejects command, file, MCP, dynamic-tool, collaboration, web, or image action items.

For a process adapter, read one JSON object from stdin and write one JSON object (or plain text) to stdout. The request has `kind` equal to `generate` or `improve`.

Generation requests contain:

- `skill`: the full current `SKILL.md`;
- `case.prompt`: the public task;
- `case.libraries`: fictional or built-in library contracts; and
- `outputContract`: return one Kira file, or for project cases one JSON `files` map with the required project files and nothing else.

Improvement requests additionally contain:

- `failure`: compiler/test stage, command output, and generated source;
- `skillBefore`: the exact skill used for that attempt; and
- `history`: every previous edit as a compact patch and rationale.

Return generation as `{ "kira": "..." }`. Return improvement as a minimal patch, not a second copy of the skill:

```json
{
  "patch": "(unified diff that updates only SKILL.md)",
  "reason": "Explain the reusable rule added and why the failure supports it.",
  "summary": "Optional short change summary."
}
```

The harness applies the patch to the current skill, validates the resulting document, and records complete before/after snapshots only in the run artifacts.

Keep model/runtime-specific authentication and tool wiring inside the adapter. The benchmark only invokes it once per case and captures its response.

Project cases require the model to author the actual `package.kira`, `linter.kira`, and `app/*.kira` files. The installed Kira CLI uses `linter.kira`, not `lint.kira`. Generated Kira has no semicolon syntax, and sibling app files share one package namespace rather than being imported as modules. The evaluator runs `kira check`, `kira lint`, and hidden `kira test` cases against the returned tree.

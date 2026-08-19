import { describe, expect, test } from "bun:test";
import { getBenchmarkCases } from "../src/cases";
import { hasKiraSemicolon, isGenuineKiraLintPass, isGenuineKiraTestPass, parseKiraTestSummary } from "../src/evaluate";
import { composeEvaluationSource, extractKiraProject, extractKiraSource, stripPreloadedImports } from "../src/extract";
import { applySkillPatch, candidateFromImprover, validateSkillText } from "../src/skill";
import { splitCommand } from "../src/util";

describe("agent protocol helpers", () => {
  test("splits quoted process commands", () => {
    expect(splitCommand('bun run "adapters/my agent.ts" --mode test')).toEqual([
      "bun",
      "run",
      "adapters/my agent.ts",
      "--mode",
      "test"
    ]);
  });

  test("extracts Kira from a structured response", () => {
    const extracted = extractKiraSource({
      output_text: "```kira\n@Main\nfunction main() { return }\n```"
    });
    expect(extracted.format).toBe("fenced");
    expect(extracted.source).toContain("@Main");
  });

  test("extracts a multi-file Kira project map", () => {
    const extracted = extractKiraProject({
      files: {
        "package.kira": "Package app_name {}",
        "linter.kira": "import Foundation",
        "app/main.kira": "@Main function main() { return }"
      }
    });
    expect(extracted.format).toBe("json-project");
    expect(Object.keys(extracted.files)).toEqual(["package.kira", "linter.kira", "app/main.kira"]);
  });
});

describe("case fixtures", () => {
  test("keeps hidden tests out of the agent case view", () => {
    const benchmarkCase = getBenchmarkCases(["focus-planner"])[0];
    expect(benchmarkCase.evaluation.hiddenTests).toContain("FocusClampsLowEnergy");
    expect(benchmarkCase.prompt).not.toContain("FocusClampsLowEnergy");
  });

  test("preloads fictional libraries and exactly one Foundation import", () => {
    const benchmarkCase = getBenchmarkCases(["tool-orchestration"])[0];
    const generated = `import Foundation\nimport KiraTools\n\n@Main\nfunction main() { return }`;
    const stripped = stripPreloadedImports(generated, benchmarkCase);
    expect(stripped).not.toContain("import KiraTools");
    const prepared = composeEvaluationSource(generated, benchmarkCase);
    expect(prepared.match(/import Foundation/g)?.length).toBe(1);
    expect(prepared).toContain("struct KiraTools");
    expect(prepared).toContain("evaluator-hidden-tests");
  });

  test("uses the correct borrowed-task hidden expectation", () => {
    const benchmarkCase = getBenchmarkCases(["borrowed-task-summary"])[0];
    expect(benchmarkCase.evaluation.hiddenTests).toContain(".Ok(91)");
    expect(benchmarkCase.evaluation.hiddenTests).not.toContain(".Ok(92)");
  });
});

describe("Kira test result parsing", () => {
  test("does not treat a zero exit code with failed tests as a pass", () => {
    const summary = parseKiraTestSummary("FAIL Example\n1 passed, 1 failed, 0 skipped, 2 total");
    expect(summary).toEqual({ passed: 1, failed: 1, skipped: 0, total: 2 });
    expect(isGenuineKiraTestPass(summary)).toBe(false);
  });

  test("requires every reported test to pass", () => {
    const summary = parseKiraTestSummary("ok Example\n2 passed, 0 failed, 0 skipped, 2 total");
    expect(isGenuineKiraTestPass(summary)).toBe(true);
    expect(isGenuineKiraTestPass(undefined)).toBe(false);
  });

  test("recognizes a real lint receipt", () => {
    expect(isGenuineKiraLintPass("ok: package — 1 lint(s) ran, nothing found")).toBe(true);
    expect(isGenuineKiraLintPass("ok: package — no lint is enabled")).toBe(false);
  });

  test("rejects semicolon syntax but ignores string content and comments", () => {
    expect(hasKiraSemicolon("let x = 1\nprint(\"a;b\")\n// ; in a comment")).toBe(false);
    expect(hasKiraSemicolon("let x = 1;\nreturn x")).toBe(true);
  });
});

describe("skill update validation", () => {
  const validSkill = `---
name: example-skill
description: A concise test skill.
---

# Example

Use the skill.
`;

  test("accepts valid frontmatter", () => {
    expect(validateSkillText(validSkill).valid).toBe(true);
  });

  test("applies a compact improver patch and rationale", () => {
    const patch = `*** Begin Patch
*** Update File: SKILL.md
@@
 # Example

 Use the skill.
+Prefer concrete examples.
*** End Patch`;
    const candidate = candidateFromImprover({
      patch,
      reason: "Add the missing rule to the reusable workflow.",
      summary: "Clarified the workflow."
    }, validSkill);
    expect(candidate.validation.valid).toBe(true);
    expect(candidate.reason).toContain("missing rule");
    expect(candidate.summary).toBe("Clarified the workflow.");
    expect(candidate.skill).toContain("Prefer concrete examples.");
    expect(candidate.patch).toContain("*** Update File: SKILL.md");
  });

  test("rejects an improver response without a patch", () => {
    const candidate = candidateFromImprover({ reason: "No safe edit." }, validSkill);
    expect(candidate.validation.valid).toBe(false);
    expect(candidate.validation.errors[0]).toContain("patch");
  });

  test("rejects a patch whose context is stale", () => {
    const result = applySkillPatch(validSkill, `*** Begin Patch
*** Update File: SKILL.md
@@
 # Missing heading
+bad
*** End Patch`);
    expect(result.skill).toBeUndefined();
    expect(result.errors[0]).toContain("context");
  });
});

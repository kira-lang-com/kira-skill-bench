import type { AgentCaseView, BenchmarkCase, LibrarySpec, ProjectSpec } from "./types";

const foundation: LibrarySpec = {
  name: "Foundation",
  kind: "builtin",
  purpose: "Kira's standard library; use it only when a standard value or API is needed.",
  contract: "Import Foundation at most once. The benchmark does not require any Foundation API for this task."
};

const kiraToolsPrelude = `
struct ToolIssue {
    let id: Int;
    let title: String;
}

struct ToolDetail {
    let id: Int;
    let points: Int;
}

struct GitHubTools {
    function searchIssues(repo: String, query: String) -> [ToolIssue] {
        var issues: [ToolIssue] = []
        issues.append(ToolIssue { id: 101; title: "LLVM backend" })
        issues.append(ToolIssue { id: 202; title: "Kira benchmark" })
        return issues
    }

    function getIssue(id: Int) -> ToolDetail {
        if id == 101 {
            return ToolDetail { id: 101; points: 8 }
        }

        return ToolDetail { id: 202; points: 13 }
    }
}

struct KiraTools {
    let github: GitHubTools;
}

function makeKiraTools() -> KiraTools {
    return KiraTools { github: GitHubTools {} }
}
`;

const flagKitPrelude = `
struct FlagKit {
    function read(name: String) -> Bool {
        if name == "enabled" {
            return true
        }

        return false
    }
}

function makeFlagKit() -> FlagKit {
    return FlagKit {}
}
`;

const focusPlannerSource = `
enum SessionMood {
    DeepFocus
    Steady
    Recharge
}

struct FocusSession {
    let title: String;
    let minutes: Int;
    let energy: Int;
}

function clampEnergy(value: Int) -> Int {
    if value < 0 {
        return 0
    }

    if value > 10 {
        return 10
    }

    return value
}

function focusScore(minutes: Int, energy: Int) -> Int {
    return minutes * clampEnergy(energy)
}

function pomodoroCount(minutes: Int) -> Int {
    if minutes <= 0 {
        return 0
    }

    var count = 0
    var remaining = minutes
    while remaining > 0 {
        count = count + 1
        remaining = remaining - 25
    }

    return count
}

function moodFor(score: Int) -> SessionMood {
    if score >= 300 {
        return .DeepFocus
    }

    if score >= 120 {
        return .Steady
    }

    return .Recharge
}

function moodLabel(mood: SessionMood) -> String {
    var label = "recharge"
    match mood {
        DeepFocus -> label = "deep focus"
        Steady -> label = "steady"
        Recharge -> label = "recharge"
    }
    return label
}

function planScore(sessions: borrow [FocusSession]) -> Int {
    var total = 0
    for session in sessions {
        total = total + focusScore(session.minutes, session.energy)
    }
    return total
}

@Main
function main() {
    print("PulsePad")
    return
}
`;

const toolPlannerSource = `
function totalIssuePoints() -> Int {
    let tools = makeKiraTools()
    let issues = tools.github.searchIssues("kira-lang/kira", "LLVM")
    var total = 0

    for issue in issues {
        let detail = tools.github.getIssue(issue.id)
        total = total + detail.points
    }

    return total
}

@Main
function main() {
    print(totalIssuePoints())
    return
}
`;

const flagPlannerSource = `
function enabledFlag() -> Bool {
    let kit = makeFlagKit()
    return kit.read("enabled")
}

function describeEnabled() -> String {
    if enabledFlag() {
        return "on"
    }

    return "off"
}

@Main
function main() {
    print(describeEnabled())
    return
}
`;

const borrowPlannerSource = `
struct FocusTask {
    let minutes: Int;
    let weight: Int;
}

function weightedMinutes(tasks: borrow [FocusTask]) -> Int {
    var total = 0
    for task in tasks {
        total = total + task.minutes * task.weight
    }
    return total
}

function longTaskCount(tasks: borrow [FocusTask], threshold: Int) -> Int {
    var count = 0
    for task in tasks {
        if task.minutes >= threshold {
            count = count + 1
        }
    }
    return count
}

@Main
function main() {
    print("tasks")
    return
}
`;

const baseBenchmarkCases: BenchmarkCase[] = [
  {
    id: "focus-planner",
    title: "Focus planner with enums, structs, arrays, and scalar tests",
    tags: ["core-syntax", "enum", "match", "borrow", "arrays"],
    libraries: [foundation],
    prompt: `Write one valid Kira source file for a small focus planner.

Define SessionMood with DeepFocus, Steady, and Recharge. Define FocusSession with title: String, minutes: Int, and energy: Int. Implement clampEnergy(value: Int) -> Int (clamp to 0...10), focusScore(minutes: Int, energy: Int) -> Int, pomodoroCount(minutes: Int) -> Int (count 25-minute blocks, including a partial final block), moodFor(score: Int) -> SessionMood (300+ is DeepFocus, 120+ is Steady, otherwise Recharge), moodLabel(mood: SessionMood) -> String with exact labels "deep focus", "steady", and "recharge", and planScore(sessions: borrow [FocusSession]) -> Int.

Use ordinary Kira syntax, explicit mutable variables, and a small @Main function. Do not add Test declarations; hidden scalar tests are appended by the evaluator. Return only the Kira source.`,
    evaluation: {
      mode: "test",
      hiddenTests: `
Test FocusClampsLowEnergy {
    test {
        return clampEnergy(-2)
    }

    expect {
        let expected: Result<Int, TestFailure> = .Ok(0)
        return expected
    }
}

Test FocusClampsHighEnergy {
    test {
        return clampEnergy(12)
    }

    expect {
        let expected: Result<Int, TestFailure> = .Ok(10)
        return expected
    }
}

Test FocusCountsPartialPomodoro {
    test {
        return pomodoroCount(45)
    }

    expect {
        let expected: Result<Int, TestFailure> = .Ok(2)
        return expected
    }
}

Test FocusUsesMoodThresholds {
    test {
        return moodLabel(moodFor(320))
    }

    expect {
        let expected: Result<String, TestFailure> = .Ok("deep focus")
        return expected
    }
}

Test FocusScoresPlan {
    test {
        let first = FocusSession { title: "Compiler work"; minutes: 25; energy: 8 }
        let second = FocusSession { title: "Docs"; minutes: 20; energy: 4 }
        var sessions: [FocusSession] = []
        sessions.append(first)
        sessions.append(second)
        return planScore(sessions)
    }

    expect {
        let expected: Result<Int, TestFailure> = .Ok(280)
        return expected
    }
}
`,
    },
    fixtureSource: focusPlannerSource
  },
  {
    id: "tool-orchestration",
    title: "Programmatic tool-call shape over a fictional KiraTools library",
    tags: ["programmatic-tools", "fictional-library", "struct-methods", "arrays"],
    libraries: [
      {
        name: "KiraTools",
        kind: "fictional",
        purpose: "A deterministic, local stand-in for repository tools; no network access is available.",
        contract: `The evaluator preloads KiraTools. Call makeKiraTools() to obtain a KiraTools value with a github field. The github object exposes searchIssues(repo: String, query: String) -> [ToolIssue] and getIssue(id: Int) -> ToolDetail. ToolIssue has id: Int and title: String; ToolDetail has id: Int and points: Int. searchIssues("kira-lang/kira", "LLVM") returns issue IDs 101 and 202; getIssue returns 8 and 13 points respectively. Do not redeclare these library types.`,
        prelude: kiraToolsPrelude
      }
    ],
    prompt: `Write one valid Kira source file that models a programmatic tool-calling workflow using the fictional KiraTools library.

The conceptual request shape is similar to: let issues = await tools.github.searchIssues(repo: "kira-lang/kira", query: "LLVM"); await parallel(issues.map { issue in tools.github.getIssue(id: issue.id) }). Kira's local evaluator is synchronous, so express the same intent with valid Kira values, a loop, and the supplied library. Implement totalIssuePoints() -> Int, returning the sum of points from every issue returned by the search. Add a small @Main function, but do not add Test declarations; the evaluator supplies hidden tests. Return only Kira source.`,
    evaluation: {
      mode: "test",
      hiddenTests: `
Test ToolCallsUseEveryIssue {
    test {
        return totalIssuePoints()
    }

    expect {
        let expected: Result<Int, TestFailure> = .Ok(21)
        return expected
    }
}
`,
    },
    fixtureSource: toolPlannerSource
  },
  {
    id: "fictional-library-adapter",
    title: "A tiny adapter around a made-up FlagKit library",
    tags: ["fictional-library", "methods", "if", "bool"],
    libraries: [
      {
        name: "FlagKit",
        kind: "fictional",
        purpose: "A local deterministic feature-flag library used to test library-aware prompting.",
        contract: `The evaluator preloads FlagKit. Call makeFlagKit() to obtain a FlagKit value. Its read(name: String) -> Bool method returns true only for the name "enabled". Do not redeclare the library type.`,
        prelude: flagKitPrelude
      }
    ],
    prompt: `Write one valid Kira source file using the fictional FlagKit library. Implement enabledFlag() -> Bool by reading the "enabled" flag from makeFlagKit(), and implement describeEnabled() -> String returning "on" when enabledFlag() is true and "off" otherwise. Add @Main and no Test declarations; hidden tests are supplied. Return only Kira source.`,
    evaluation: {
      mode: "test",
      hiddenTests: `
Test FlagAdapterReadsEnabled {
    test {
        return enabledFlag()
    }

    expect {
        let expected: Result<Bool, TestFailure> = .Ok(true)
        return expected
    }
}

Test FlagAdapterDescribesEnabled {
    test {
        return describeEnabled()
    }

    expect {
        let expected: Result<String, TestFailure> = .Ok("on")
        return expected
    }
}
`,
    },
    fixtureSource: flagPlannerSource
  },
  {
    id: "borrowed-task-summary",
    title: "Borrowed array traversal without moving the input",
    tags: ["ownership", "borrow", "arrays", "structs"],
    libraries: [],
    prompt: `Write one valid Kira source file for a task summary. Define FocusTask with minutes: Int and weight: Int. Implement weightedMinutes(tasks: borrow [FocusTask]) -> Int, summing minutes * weight, and longTaskCount(tasks: borrow [FocusTask], threshold: Int) -> Int, counting tasks whose minutes are at least threshold. Use borrow parameters so the same array can be read by both functions. Add a small @Main function and no Test declarations; hidden tests are supplied. Return only Kira source.`,
    evaluation: {
      mode: "test",
      hiddenTests: `
Test BorrowedTaskWeightedTotal {
    test {
        let first = FocusTask { minutes: 25; weight: 2 }
        let second = FocusTask { minutes: 40; weight: 1 }
        var tasks: [FocusTask] = []
        tasks.append(first)
        tasks.append(second)
        return weightedMinutes(tasks)
    }

    expect {
        let expected: Result<Int, TestFailure> = .Ok(90)
        return expected
    }
}

Test BorrowedTaskArrayCanBeReadAgain {
    test {
        let first = FocusTask { minutes: 25; weight: 2 }
        let second = FocusTask { minutes: 40; weight: 1 }
        var tasks: [FocusTask] = []
        tasks.append(first)
        tasks.append(second)
        let total = weightedMinutes(tasks)
        return longTaskCount(tasks, 30) + total
    }

    expect {
        let expected: Result<Int, TestFailure> = .Ok(91)
        return expected
    }
}
`,
    },
    fixtureSource: borrowPlannerSource
  }
];


const weatherKit: LibrarySpec = {
  name: "WeatherKit",
  kind: "fictional",
  purpose: "A deterministic local weather-reading library.",
  contract: "The evaluator preloads WeatherKit. makeWeatherKit() -> WeatherKit. WeatherKit.reading(city: borrow String) -> WeatherReading. WeatherReading has city: String and temperature: Int. Paris has temperature 18; every other city has temperature 12. Do not redeclare the library types.",
  prelude: [
    "struct WeatherReading { let city: String; let temperature: Int; }",
    "struct WeatherKit {",
    "    function reading(city: borrow String) -> WeatherReading {",
    "        if city == \"Paris\" { return WeatherReading { city: \"Paris\"; temperature: 18 } }",
    "        return WeatherReading { city: city; temperature: 12 }",
    "    }",
    "}",
    "function makeWeatherKit() -> WeatherKit { return WeatherKit {} }"
  ].join("\n")
};

const searchKit: LibrarySpec = {
  name: "SearchKit",
  kind: "fictional",
  purpose: "A deterministic local search-and-details API.",
  contract: "The evaluator preloads SearchKit. makeSearchKit() -> SearchKit. SearchKit.search(query: borrow String) -> [SearchRecord]. SearchKit.details(id: Int) -> SearchDetail. SearchRecord has id: Int and title: String; SearchDetail has id: Int and score: Int. search(compiler) returns IDs 1 and 2 with detail scores 5 and 8; any other query returns ID 3 with score 2. Do not redeclare the library types.",
  prelude: [
    "struct SearchRecord { let id: Int; let title: String; }",
    "struct SearchDetail { let id: Int; let score: Int; }",
    "struct SearchKit {",
    "    function search(query: borrow String) -> [SearchRecord] {",
    "        var records: [SearchRecord] = []",
    "        if query == \"compiler\" {",
    "            records.append(SearchRecord { id: 1; title: \"Compiler\" })",
    "            records.append(SearchRecord { id: 2; title: \"Runtime\" })",
    "        } else { records.append(SearchRecord { id: 3; title: \"Docs\" }) }",
    "        return records",
    "    }",
    "    function details(id: Int) -> SearchDetail {",
    "        if id == 1 { return SearchDetail { id: 1; score: 5 } }",
    "        if id == 2 { return SearchDetail { id: 2; score: 8 } }",
    "        return SearchDetail { id: 3; score: 2 }",
    "    }",
    "}",
    "function makeSearchKit() -> SearchKit { return SearchKit {} }"
  ].join("\n")
};

const batchTools: LibrarySpec = {
  name: "BatchTools",
  kind: "fictional",
  purpose: "A deterministic local batch API modeling programmatic tool orchestration.",
  contract: "The evaluator preloads BatchTools. makeBatchTools() -> BatchTools. BatchTools.search(queue: borrow String) -> [BatchJob] returns IDs 10 and 20. BatchTools.execute(id: Int) -> BatchResult returns cost 7 for ID 10 and 11 otherwise. BatchJob has id: Int and units: Int; BatchResult has id: Int and cost: Int. Express fan-out as a synchronous loop. Do not redeclare the library types.",
  prelude: [
    "struct BatchJob { let id: Int; let units: Int; }",
    "struct BatchResult { let id: Int; let cost: Int; }",
    "struct BatchTools {",
    "    function search(queue: borrow String) -> [BatchJob] {",
    "        var jobs: [BatchJob] = []",
    "        jobs.append(BatchJob { id: 10; units: 3 })",
    "        jobs.append(BatchJob { id: 20; units: 5 })",
    "        return jobs",
    "    }",
    "    function execute(id: Int) -> BatchResult {",
    "        if id == 10 { return BatchResult { id: 10; cost: 7 } }",
    "        return BatchResult { id: id; cost: 11 }",
    "    }",
    "}",
    "function makeBatchTools() -> BatchTools { return BatchTools {} }"
  ].join("\n")
};

const stockKit: LibrarySpec = {
  name: "StockKit",
  kind: "fictional",
  purpose: "A deterministic local inventory library.",
  contract: "The evaluator preloads StockKit. makeStockKit() -> StockKit. StockKit.quantity(sku: String) -> Int and StockKit.minimum(sku: String) -> Int. pencil has quantity 2 and minimum 5; paper has quantity 12 and minimum 10; unknown SKUs have quantity 0 and minimum 1. Do not redeclare the library types.",
  prelude: [
    "struct StockKit {",
    "    function quantity(sku: String) -> Int {",
    "        if sku == \"pencil\" { return 2 }",
    "        if sku == \"paper\" { return 12 }",
    "        return 0",
    "    }",
    "    function minimum(sku: String) -> Int {",
    "        if sku == \"pencil\" { return 5 }",
    "        if sku == \"paper\" { return 10 }",
    "        return 1",
    "    }",
    "}",
    "function makeStockKit() -> StockKit { return StockKit {} }"
  ].join("\n")
};

type ExtraTest = {
  name: string;
  body: string;
  type: string;
  expected: string;
};

function extraHiddenTests(items: ExtraTest[]): string {
  return items.map((item) => [
    "Test " + item.name + " {",
    "    test {",
    item.body.split("\n").map((line) => "        " + line).join("\n"),
    "    }",
    "",
    "    expect {",
    "        let expected: Result<" + item.type + ", TestFailure> = .Ok(" + item.expected + ")",
    "        return expected",
    "    }",
    "}",
    ""
  ].join("\n")).join("\n");
}

function extraCase(input: {
  id: string;
  title: string;
  prompt: string;
  tags: string[];
  source: string[];
  tests: ExtraTest[];
  libraries?: LibrarySpec[];
}): BenchmarkCase {
  return {
    id: input.id,
    title: input.title,
    prompt: input.prompt + " Follow the ownership rules in the skill: use borrow for read-only struct or String parameters when a value is reused or traversed.",
    tags: input.tags,
    libraries: input.libraries ?? [],
    evaluation: { mode: "test", hiddenTests: extraHiddenTests(input.tests) },
    fixtureSource: input.source.join("\n") + "\n\n@Main\nfunction main() {\n    return\n}\n"
  };
}

const additionalCases: BenchmarkCase[] = [
  extraCase({
    id: "range-sum",
    title: "Half-open integer ranges",
    tags: ["ranges", "for", "arithmetic"],
    prompt: "Implement sumRange(limit: Int) -> Int by summing 0..limit, where the range is half-open. Non-positive limits produce 0. Add @Main and no tests. Return only Kira source.",
    source: [
      "function sumRange(limit: Int) -> Int {",
      "    var total = 0",
      "    for i in 0..limit {",
      "        total = total + i",
      "    }",
      "    return total",
      "}"
    ],
    tests: [
      { name: "RangeSumFive", body: "return sumRange(5)", type: "Int", expected: "10" },
      { name: "RangeSumZero", body: "return sumRange(0)", type: "Int", expected: "0" },
      { name: "RangeSumNegative", body: "return sumRange(-3)", type: "Int", expected: "0" }
    ]
  }),
  extraCase({
    id: "clamp-and-absolute",
    title: "Branching arithmetic helpers",
    tags: ["if", "comparison", "functions"],
    prompt: "Implement absValue(value: Int) -> Int and clamp(value: Int, low: Int, high: Int) -> Int with explicit branches. Add @Main and no tests. Return only Kira source.",
    source: [
      "function absValue(value: Int) -> Int {",
      "    if value < 0 {",
      "        return 0 - value",
      "    }",
      "    return value",
      "}",
      "",
      "function clamp(value: Int, low: Int, high: Int) -> Int {",
      "    if value < low {",
      "        return low",
      "    }",
      "    if value > high {",
      "        return high",
      "    }",
      "    return value",
      "}"
    ],
    tests: [
      { name: "AbsoluteNegative", body: "return absValue(-4)", type: "Int", expected: "4" },
      { name: "AbsolutePositive", body: "return absValue(4)", type: "Int", expected: "4" },
      { name: "ClampBelow", body: "return clamp(-1, 0, 10)", type: "Int", expected: "0" },
      { name: "ClampInside", body: "return clamp(7, 0, 10)", type: "Int", expected: "7" },
      { name: "ClampAbove", body: "return clamp(12, 0, 10)", type: "Int", expected: "10" }
    ]
  }),
  extraCase({
    id: "enum-grade",
    title: "Exhaustive fieldless enum matching",
    tags: ["enum", "match", "strings"],
    prompt: "Define enum Grade with Low, Medium, High. Implement gradeFor(score: Int) -> Grade with thresholds 80 and 50, and gradeLabel(grade: Grade) -> String with labels low, medium, high. Add @Main and no tests. Return only Kira source.",
    source: [
      "enum Grade {",
      "    Low",
      "    Medium",
      "    High",
      "}",
      "",
      "function gradeFor(score: Int) -> Grade {",
      "    if score >= 80 {",
      "        return .High",
      "    }",
      "    if score >= 50 {",
      "        return .Medium",
      "    }",
      "    return .Low",
      "}",
      "",
      "function gradeLabel(grade: Grade) -> String {",
      "    var label = \"low\"",
      "    match grade {",
      "        Low -> label = \"low\"",
      "        Medium -> label = \"medium\"",
      "        High -> label = \"high\"",
      "    }",
      "    return label",
      "}"
    ],
    tests: [
      { name: "GradeLow", body: "return gradeLabel(gradeFor(20))", type: "String", expected: "\"low\"" },
      { name: "GradeMedium", body: "return gradeLabel(gradeFor(50))", type: "String", expected: "\"medium\"" },
      { name: "GradeHigh", body: "return gradeLabel(gradeFor(80))", type: "String", expected: "\"high\"" }
    ]
  }),
  extraCase({
    id: "payload-match",
    title: "Enum payload construction and matching",
    tags: ["enum", "payload", "match"],
    prompt: "Define enum Signal with Number carrying an Int and Empty without a payload. Implement makeSignal(value: Int) -> Signal, using Empty for negative input and Number(value) otherwise. Implement signalValue(signal: Signal) -> Int with exhaustive match. Add @Main and no tests. Return only Kira source.",
    source: [
      "enum Signal {",
      "    Number: Int",
      "    Empty",
      "}",
      "",
      "function makeSignal(value: Int) -> Signal {",
      "    if value < 0 {",
      "        return .Empty",
      "    }",
      "    return .Number(value)",
      "}",
      "",
      "function signalValue(signal: Signal) -> Int {",
      "    var result = 0",
      "    match signal {",
      "        Number(value) -> result = value",
      "        Empty -> result = 0",
      "    }",
      "    return result",
      "}"
    ],
    tests: [
      { name: "SignalKeepsNumber", body: "return signalValue(makeSignal(4))", type: "Int", expected: "4" },
      { name: "SignalMapsNegativeToEmpty", body: "return signalValue(makeSignal(-1))", type: "Int", expected: "0" }
    ]
  }),
  extraCase({
    id: "result-validation",
    title: "Result validation with attempt and handle",
    tags: ["result", "attempt", "handle", "enum"],
    prompt: "Define ValidationError with Negative and TooLarge. Implement validate(value: Int) -> Result<Int, ValidationError>, accepting 0...10 and returning the matching Error otherwise. Implement normalize(value: Int) -> Int using attempt, try, and handle so Negative becomes 0 and TooLarge becomes 10. Add @Main and no tests. Return only Kira source.",
    source: [
      "enum ValidationError {",
      "    Negative",
      "    TooLarge",
      "}",
      "",
      "function validate(value: Int) -> Result<Int, ValidationError> {",
      "    if value < 0 {",
      "        return .Error(.Negative)",
      "    }",
      "    if value > 10 {",
      "        return .Error(.TooLarge)",
      "    }",
      "    return .Ok(value)",
      "}",
      "",
      "function normalize(value: Int) -> Int {",
      "    var result = 0",
      "    attempt {",
      "        let checked = try validate(value)",
      "        result = checked",
      "    }",
      "    handle {",
      "        Negative {",
      "            result = 0",
      "        }",
      "        TooLarge {",
      "            result = 10",
      "        }",
      "    }",
      "    return result",
      "}"
    ],
    tests: [
      { name: "ValidationKeepsValid", body: "return normalize(4)", type: "Int", expected: "4" },
      { name: "ValidationClampsNegative", body: "return normalize(-2)", type: "Int", expected: "0" },
      { name: "ValidationClampsLarge", body: "return normalize(20)", type: "Int", expected: "10" }
    ]
  }),
  extraCase({
    id: "counter-method",
    title: "Mutable struct field and method calls",
    tags: ["struct", "methods", "mutable-state"],
    prompt: "Define Counter with mutable value: Int and bump(amount: Int) -> Int that updates and returns value. Implement countFrom(start: Int, amount: Int) -> Int by constructing Counter and calling the method. Add @Main and no tests. Return only Kira source.",
    source: [
      "struct Counter {",
      "    var value: Int;",
      "    function bump(amount: Int) -> Int {",
      "        self.value = self.value + amount",
      "        return self.value",
      "    }",
      "}",
      "",
      "function countFrom(start: Int, amount: Int) -> Int {",
      "    var counter = Counter { value: start }",
      "    return counter.bump(amount)",
      "}"
    ],
    tests: [
      { name: "CounterAdds", body: "return countFrom(3, 4)", type: "Int", expected: "7" },
      { name: "CounterHandlesNegativeAmount", body: "return countFrom(10, -3)", type: "Int", expected: "7" }
    ]
  }),
  extraCase({
    id: "printable-badge",
    title: "Printable struct method",
    tags: ["annotation", "printable", "struct"],
    prompt: "Define an @Printable Badge struct with label: String and onPrint() -> String returning label. Implement badgeText() -> String by constructing a ready Badge. Add @Main and no tests. Return only Kira source.",
    source: [
      "@Printable",
      "struct Badge {",
      "    let label: String;",
      "    function onPrint() -> String {",
      "        return self.label",
      "    }",
      "}",
      "",
      "function badgeText() -> String {",
      "    let badge = Badge { label: \"ready\" }",
      "    return badge.onPrint()",
      "}"
    ],
    tests: [{ name: "BadgeUsesPrintableText", body: "return badgeText()", type: "String", expected: "\"ready\"" }]
  }),
  extraCase({
    id: "array-statistics",
    title: "Borrowed array statistics",
    tags: ["arrays", "borrow", "loops", "scalars"],
    prompt: "Implement sumValues(values: borrow [Int]) -> Int and countAbove(values: borrow [Int], threshold: Int) -> Int with for-in. Add @Main and no tests. Return only Kira source.",
    source: [
      "function sumValues(values: borrow [Int]) -> Int {",
      "    var total = 0",
      "    for value in values {",
      "        total = total + value",
      "    }",
      "    return total",
      "}",
      "",
      "function countAbove(values: borrow [Int], threshold: Int) -> Int {",
      "    var count = 0",
      "    for value in values {",
      "        if value > threshold {",
      "            count = count + 1",
      "        }",
      "    }",
      "    return count",
      "}"
    ],
    tests: [
      { name: "ArrayStatisticsSum", body: "var values: [Int] = []\nvalues.append(2)\nvalues.append(5)\nvalues.append(8)\nreturn sumValues(values)", type: "Int", expected: "15" },
      { name: "ArrayStatisticsCount", body: "var values: [Int] = []\nvalues.append(2)\nvalues.append(5)\nvalues.append(8)\nlet total = sumValues(values)\nreturn countAbove(values, 4) + total", type: "Int", expected: "17" }
    ]
  }),
  extraCase({
    id: "mutable-borrow-array",
    title: "Borrow-mut array writeback",
    tags: ["borrow-mut", "arrays", "mutation"],
    prompt: "Implement addOne(values: borrow mut [Int]) -> Int. Increment every array element in place with an index range and return the sum of updated elements. Add @Main and no tests. Return only Kira source.",
    source: [
      "function addOne(values: borrow mut [Int]) -> Int {",
      "    var total = 0",
      "    for index in 0..values.count {",
      "        values[index] = values[index] + 1",
      "        total = total + values[index]",
      "    }",
      "    return total",
      "}"
    ],
    tests: [
      { name: "MutableBorrowUpdatesElements", body: "var values: [Int] = []\nvalues.append(2)\nvalues.append(4)\nlet total = addOne(values)\nreturn total + values[0] + values[1]", type: "Int", expected: "16" }
    ]
  }),
  extraCase({
    id: "ternary-max",
    title: "Ternary expression and equality boundary",
    tags: ["conditional", "ternary", "comparison"],
    prompt: "Implement maxValue(left: Int, right: Int) -> Int with a ternary and signLabel(value: Int) -> String returning negative, zero, or positive. Add @Main and no tests. Return only Kira source.",
    source: [
      "function maxValue(left: Int, right: Int) -> Int {",
      "    return left > right ? left : right",
      "}",
      "",
      "function signLabel(value: Int) -> String {",
      "    if value < 0 { return \"negative\" }",
      "    if value == 0 { return \"zero\" }",
      "    return \"positive\"",
      "}"
    ],
    tests: [
      { name: "TernaryChoosesRight", body: "return maxValue(3, 8)", type: "Int", expected: "8" },
      { name: "TernaryChoosesLeft", body: "return maxValue(9, 2)", type: "Int", expected: "9" },
      { name: "SignLabelZero", body: "return signLabel(0)", type: "String", expected: "\"zero\"" }
    ]
  }),
  extraCase({
    id: "while-break",
    title: "While loop with break",
    tags: ["while", "break", "control-flow"],
    prompt: "Implement firstAtLeast(limit: Int) -> Int. Start at zero, repeatedly add seven, break once value is at least limit, and return value. Avoid compound assignment. Add @Main and no tests.",
    source: [
      "function firstAtLeast(limit: Int) -> Int {",
      "    var value = 0",
      "    while value < 100 {",
      "        if value >= limit { break }",
      "        value = value + 7",
      "    }",
      "    return value",
      "}"
    ],
    tests: [
      { name: "WhileBreakRoundsUp", body: "return firstAtLeast(20)", type: "Int", expected: "21" },
      { name: "WhileBreakAtZero", body: "return firstAtLeast(0)", type: "Int", expected: "0" },
      { name: "WhileBreakSmallLimit", body: "return firstAtLeast(1)", type: "Int", expected: "7" }
    ]
  }),
  extraCase({
    id: "continue-odd-sum",
    title: "Continue and modulo in a range",
    tags: ["continue", "ranges", "modulo"],
    prompt: "Implement sumOdd(limit: Int) -> Int. Iterate over 0..limit, use continue to skip even numbers, and sum odd numbers. Add @Main and no tests.",
    source: [
      "function sumOdd(limit: Int) -> Int {",
      "    var total = 0",
      "    for value in 0..limit {",
      "        if value % 2 == 0 { continue }",
      "        total = total + value",
      "    }",
      "    return total",
      "}"
    ],
    tests: [
      { name: "ContinueSumsOdds", body: "return sumOdd(8)", type: "Int", expected: "16" },
      { name: "ContinueEmptyRange", body: "return sumOdd(0)", type: "Int", expected: "0" }
    ]
  }),
  extraCase({
    id: "width-cast",
    title: "Explicit integer width conversion",
    tags: ["width-types", "casts", "numeric"],
    prompt: "Implement widen(value: U16) -> Int with an explicit Int conversion and addWidth(left: U16, right: U16) -> Int. Add @Main and no tests.",
    source: [
      "function widen(value: U16) -> Int {",
      "    return Int(value)",
      "}",
      "",
      "function addWidth(left: U16, right: U16) -> Int {",
      "    return Int(left) + Int(right)",
      "}"
    ],
    tests: [
      { name: "WidthCastConverts", body: "let value: U16 = 7\nreturn widen(value)", type: "Int", expected: "7" },
      { name: "WidthCastAdds", body: "let left: U16 = 4\nlet right: U16 = 5\nreturn addWidth(left, right)", type: "Int", expected: "9" }
    ]
  }),
  extraCase({
    id: "string-router",
    title: "String equality routing",
    tags: ["strings", "branching", "api-shape"],
    prompt: "Implement routeFor(name: String) -> String returning dashboard for dashboard, settings for settings, and unknown otherwise. Add @Main and no tests.",
    source: [
      "function routeFor(name: String) -> String {",
      "    if name == \"dashboard\" { return \"dashboard\" }",
      "    if name == \"settings\" { return \"settings\" }",
      "    return \"unknown\"",
      "}"
    ],
    tests: [
      { name: "StringRouterDashboard", body: "return routeFor(\"dashboard\")", type: "String", expected: "\"dashboard\"" },
      { name: "StringRouterSettings", body: "return routeFor(\"settings\")", type: "String", expected: "\"settings\"" },
      { name: "StringRouterUnknown", body: "return routeFor(\"help\")", type: "String", expected: "\"unknown\"" }
    ]
  }),
  extraCase({
    id: "closure-transform",
    title: "Closure parameter and callback invocation",
    tags: ["closures", "functions", "callbacks"],
    prompt: "Implement applyTransform(value: Int, transform: (Int) -> Int) -> Int by calling the closure, plus triple(value: Int) -> Int. Add @Main and no tests.",
    source: [
      "function applyTransform(value: Int, transform: (Int) -> Int) -> Int {",
      "    return transform(value)",
      "}",
      "",
      "function triple(value: Int) -> Int {",
      "    return value * 3",
      "}"
    ],
    tests: [
      { name: "ClosureUsesNamedFunction", body: "return applyTransform(4, triple)", type: "Int", expected: "12" },
      { name: "ClosureUsesInlineLambda", body: "return applyTransform(5, { value in return value + 2 })", type: "Int", expected: "7" }
    ]
  }),
  extraCase({
    id: "switch-bucket",
    title: "Branching bucket decision",
    tags: ["branching", "control-flow", "accumulator"],
    prompt: "Implement bucket(value: Int) -> Int with if/else branches: 0 returns 1, 1 returns 2, and every other value returns 3. Use an accumulator and one final return. Add @Main and no tests.",
    source: [
      "function bucket(value: Int) -> Int {",
      "    var result = 3",
      "    if value == 0 { result = 1 }",
      "    if value == 1 { result = 2 }",
      "    return result",
      "}"
    ],
    tests: [
      { name: "SwitchBucketZero", body: "return bucket(0)", type: "Int", expected: "1" },
      { name: "SwitchBucketOne", body: "return bucket(1)", type: "Int", expected: "2" },
      { name: "SwitchBucketDefault", body: "return bucket(9)", type: "Int", expected: "3" }
    ]
  }),
  extraCase({
    id: "nested-point",
    title: "Struct method over geometric fields",
    tags: ["struct", "methods", "arithmetic"],
    prompt: "Define Point with x and y Int fields and manhattan() -> Int. Implement distance(left: Point, right: Point) -> Int with absolute coordinate differences. Add @Main and no tests.",
    source: [
      "struct Point {",
      "    let x: Int;",
      "    let y: Int;",
      "    function manhattan() -> Int {",
      "        var xValue = self.x",
      "        if xValue < 0 { xValue = 0 - xValue }",
      "        var yValue = self.y",
      "        if yValue < 0 { yValue = 0 - yValue }",
      "        return xValue + yValue",
      "    }",
      "}",
      "",
      "function distance(left: Point, right: Point) -> Int {",
      "    var xValue = left.x - right.x",
      "    if xValue < 0 { xValue = 0 - xValue }",
      "    var yValue = left.y - right.y",
      "    if yValue < 0 { yValue = 0 - yValue }",
      "    return xValue + yValue",
      "}"
    ],
    tests: [
      { name: "PointMethodSumsCoordinates", body: "return Point { x: -3; y: 4 }.manhattan()", type: "Int", expected: "7" },
      { name: "PointDistanceUsesBothAxes", body: "return distance(Point { x: 1; y: 2 }, Point { x: 4; y: 0 })", type: "Int", expected: "5" }
    ]
  }),
  extraCase({
    id: "weather-library",
    title: "Fictional weather library adapter",
    tags: ["fictional-library", "structs", "methods", "strings"],
    libraries: [weatherKit],
    prompt: "Use fictional WeatherKit. Implement temperatureFor(city: borrow String) -> Int with makeWeatherKit().reading(city).temperature and isWarm(city: borrow String) -> Bool for temperatures at least 15. Add @Main and no tests.",
    source: [
      "function temperatureFor(city: borrow String) -> Int {",
      "    let kit = makeWeatherKit()",
      "    let reading = kit.reading(city)",
      "    return reading.temperature",
      "}",
      "",
      "function isWarm(city: borrow String) -> Bool {",
      "    return temperatureFor(city) >= 15",
      "}"
    ],
    tests: [
      { name: "WeatherReadsParis", body: "return temperatureFor(\"Paris\")", type: "Int", expected: "18" },
      { name: "WeatherParisIsWarm", body: "return isWarm(\"Paris\")", type: "Bool", expected: "true" },
      { name: "WeatherUnknownIsCool", body: "return isWarm(\"Oslo\")", type: "Bool", expected: "false" }
    ]
  }),
  extraCase({
    id: "search-library",
    title: "Fictional search library with detail fan-out",
    tags: ["fictional-library", "programmatic-tools", "arrays", "loops"],
    libraries: [searchKit],
    prompt: "Use fictional SearchKit. Call SearchKit.search(query) and then SearchKit.details(record.id). Implement totalSearchScore(query: borrow String) -> Int by searching, looping over every returned record, fetching details by ID, and summing scores. Add @Main and no tests.",
    source: [
      "function totalSearchScore(query: String) -> Int {",
      "    let kit = makeSearchKit()",
      "    let records = kit.search(query)",
      "    var total = 0",
      "    for record in records {",
      "        let detail = kit.details(record.id)",
      "        total = total + detail.score",
      "    }",
      "    return total",
      "}"
    ],
    tests: [
      { name: "SearchLibraryFansOut", body: "return totalSearchScore(\"compiler\")", type: "Int", expected: "13" },
      { name: "SearchLibraryHandlesOtherQuery", body: "return totalSearchScore(\"docs\")", type: "Int", expected: "2" }
    ]
  }),
  extraCase({
    id: "batch-tool-fanout",
    title: "Synchronous representation of a parallel tool fan-out",
    tags: ["programmatic-tools", "fictional-library", "arrays", "loops"],
    libraries: [batchTools],
    prompt: "Use fictional BatchTools. Call BatchTools.search(queue) and BatchTools.execute(job.id). Implement totalBatchCost(queue: borrow String) -> Int by searching for jobs, then synchronously looping over every job as the local representation of a parallel execute fan-out and summing result costs. Add @Main and no tests.",
    source: [
      "function totalBatchCost(queue: String) -> Int {",
      "    let tools = makeBatchTools()",
      "    let jobs = tools.search(queue)",
      "    var total = 0",
      "    for job in jobs {",
      "        let result = tools.execute(job.id)",
      "        total = total + result.cost",
      "    }",
      "    return total",
      "}"
    ],
    tests: [{ name: "BatchFanoutSumsEveryResult", body: "return totalBatchCost(\"nightly\")", type: "Int", expected: "18" }]
  }),
  extraCase({
    id: "invoice-ledger",
    title: "Medium invoice ledger with borrowed items",
    tags: ["medium", "structs", "arrays", "borrow", "integer-math"],
    prompt: "Define LineItem with price and quantity Int fields. Implement lineTotal(item: LineItem) -> Int and invoiceTotal(items: borrow [LineItem], taxPercent: Int) -> Int using integer subtotal * taxPercent / 100. Add @Main and no tests.",
    source: [
      "struct LineItem {",
      "    let price: Int;",
      "    let quantity: Int;",
      "}",
      "",
      "function lineTotal(item: borrow LineItem) -> Int { return item.price * item.quantity }",
      "",
      "function invoiceTotal(items: borrow [LineItem], taxPercent: Int) -> Int {",
      "    var subtotal = 0",
      "    for item in items { subtotal = subtotal + lineTotal(item) }",
      "    return subtotal + subtotal * taxPercent / 100",
      "}"
    ],
    tests: [
      { name: "InvoiceLineTotal", body: "return lineTotal(LineItem { price: 7; quantity: 3 })", type: "Int", expected: "21" },
      { name: "InvoiceAddsIntegerTax", body: "var items: [LineItem] = []\nitems.append(LineItem { price: 10; quantity: 2 })\nitems.append(LineItem { price: 7; quantity: 1 })\nreturn invoiceTotal(items, 10)", type: "Int", expected: "29" }
    ]
  }),
  extraCase({
    id: "reading-log",
    title: "Reading log with enum-specific page weights",
    tags: ["medium", "enum", "match", "arrays", "borrow"],
    prompt: "Define ReadingKind with Book and Article, Reading with kind: ReadingKind and pages: Int, weightedPages(item: Reading) -> Int where books count full pages and articles count pages / 2, and totalWeightedPages(items: borrow [Reading]) -> Int. Add @Main and no tests.",
    source: [
      "enum ReadingKind {",
      "    Book",
      "    Article",
      "}",
      "struct Reading {",
      "    let kind: ReadingKind;",
      "    let pages: Int;",
      "}",
      "function weightedPages(item: borrow Reading) -> Int {",
      "    var result = item.pages / 2",
      "    match item.kind {",
      "        Book -> result = item.pages",
      "        Article -> result = item.pages / 2",
      "    }",
      "    return result",
      "}",
      "function totalWeightedPages(items: borrow [Reading]) -> Int {",
      "    var total = 0",
      "    for item in items { total = total + weightedPages(item) }",
      "    return total",
      "}"
    ],
    tests: [
      { name: "ReadingBookKeepsPages", body: "return weightedPages(Reading { kind: .Book; pages: 100 })", type: "Int", expected: "100" },
      { name: "ReadingArticleHalvesPages", body: "return weightedPages(Reading { kind: .Article; pages: 99 })", type: "Int", expected: "49" },
      { name: "ReadingTotalsKinds", body: "var items: [Reading] = []\nitems.append(Reading { kind: .Book; pages: 40 })\nitems.append(Reading { kind: .Article; pages: 20 })\nreturn totalWeightedPages(items)", type: "Int", expected: "50" }
    ]
  }),
  extraCase({
    id: "delivery-planner",
    title: "Large delivery planner with status matching",
    tags: ["large", "enum", "structs", "arrays", "borrow", "match"],
    prompt: "Define DeliveryStatus with Ready, InTransit, Delivered and Delivery with distance, priority, and status. Implement deliveryScore(delivery: Delivery) -> Int as distance + priority * 10 plus status bonus 0, 5, or 10, and planScore(deliveries: borrow [Delivery]) -> Int. Add @Main and no tests.",
    source: [
      "enum DeliveryStatus {",
      "    Ready",
      "    InTransit",
      "    Delivered",
      "}",
      "struct Delivery {",
      "    let distance: Int;",
      "    let priority: Int;",
      "    let status: DeliveryStatus;",
      "}",
      "function deliveryScore(delivery: borrow Delivery) -> Int {",
      "    var bonus = 0",
      "    match delivery.status {",
      "        Ready -> bonus = 0",
      "        InTransit -> bonus = 5",
      "        Delivered -> bonus = 10",
      "    }",
      "    return delivery.distance + delivery.priority * 10 + bonus",
      "}",
      "function planScore(deliveries: borrow [Delivery]) -> Int {",
      "    var total = 0",
      "    for delivery in deliveries { total = total + deliveryScore(delivery) }",
      "    return total",
      "}"
    ],
    tests: [
      { name: "DeliveryReadyScore", body: "return deliveryScore(Delivery { distance: 8; priority: 2; status: .Ready })", type: "Int", expected: "28" },
      { name: "DeliveryDeliveredScore", body: "return deliveryScore(Delivery { distance: 8; priority: 2; status: .Delivered })", type: "Int", expected: "38" },
      { name: "DeliveryPlanTotals", body: "var deliveries: [Delivery] = []\ndeliveries.append(Delivery { distance: 8; priority: 2; status: .Ready })\ndeliveries.append(Delivery { distance: 4; priority: 1; status: .InTransit })\nreturn planScore(deliveries)", type: "Int", expected: "47" }
    ]
  }),
  extraCase({
    id: "inventory-reorder",
    title: "Large inventory planner around fictional StockKit",
    tags: ["large", "fictional-library", "structs", "arrays", "borrow", "strings"],
    libraries: [stockKit],
    prompt: "Use fictional StockKit. Define InventoryItem with sku: String and requested: Int. Implement needsReorder(item: InventoryItem) -> Bool by comparing quantity to minimum, and reorderCount(items: borrow [InventoryItem]) -> Int. Add @Main and no tests.",
    source: [
      "struct InventoryItem {",
      "    let sku: String;",
      "    let requested: Int;",
      "}",
      "function needsReorder(item: borrow InventoryItem) -> Bool {",
      "    let kit = makeStockKit()",
      "    return kit.quantity(item.sku) < kit.minimum(item.sku)",
      "}",
      "function reorderCount(items: borrow [InventoryItem]) -> Int {",
      "    var count = 0",
      "    for item in items {",
      "        if needsReorder(item) { count = count + 1 }",
      "    }",
      "    return count",
      "}"
    ],
    tests: [
      { name: "InventoryPencilNeedsReorder", body: "return needsReorder(InventoryItem { sku: \"pencil\"; requested: 5 })", type: "Bool", expected: "true" },
      { name: "InventoryPaperDoesNotNeedReorder", body: "return needsReorder(InventoryItem { sku: \"paper\"; requested: 1 })", type: "Bool", expected: "false" },
      { name: "InventoryCountsReorders", body: "var items: [InventoryItem] = []\nitems.append(InventoryItem { sku: \"pencil\"; requested: 5 })\nitems.append(InventoryItem { sku: \"paper\"; requested: 1 })\nitems.append(InventoryItem { sku: \"eraser\"; requested: 2 })\nreturn reorderCount(items)", type: "Int", expected: "2" }
    ]
  }),
  extraCase({
    id: "budget-ledger",
    title: "Budget ledger with category totals",
    tags: ["medium", "structs", "arrays", "borrow", "strings"],
    prompt: "Define BudgetLine with category: String and cents: Int. Implement totalCents(lines: borrow [BudgetLine]) -> Int and categoryCents(lines: borrow [BudgetLine], category: String) -> Int. Add @Main and no tests.",
    source: [
      "struct BudgetLine {",
      "    let category: String;",
      "    let cents: Int;",
      "}",
      "function totalCents(lines: borrow [BudgetLine]) -> Int {",
      "    var total = 0",
      "    for line in lines { total = total + line.cents }",
      "    return total",
      "}",
      "function categoryCents(lines: borrow [BudgetLine], category: String) -> Int {",
      "    var total = 0",
      "    for line in lines {",
      "        if line.category == category { total = total + line.cents }",
      "    }",
      "    return total",
      "}"
    ],
    tests: [
      { name: "BudgetTotalsAllLines", body: "var lines: [BudgetLine] = []\nlines.append(BudgetLine { category: \"food\"; cents: 300 })\nlines.append(BudgetLine { category: \"travel\"; cents: 500 })\nreturn totalCents(lines)", type: "Int", expected: "800" },
      { name: "BudgetFiltersCategory", body: "var lines: [BudgetLine] = []\nlines.append(BudgetLine { category: \"food\"; cents: 300 })\nlines.append(BudgetLine { category: \"travel\"; cents: 500 })\nlines.append(BudgetLine { category: \"food\"; cents: 125 })\nreturn categoryCents(lines, \"food\")", type: "Int", expected: "425" }
    ]
  }),
  extraCase({
    id: "calendar-agenda",
    title: "Calendar agenda with overlap scoring",
    tags: ["large", "structs", "arrays", "borrow", "comparisons"],
    prompt: "Define Meeting with start, duration, and importance Int fields. Implement meetingEnd(meeting: Meeting) -> Int, conflict(left: Meeting, right: Meeting) -> Bool for overlapping intervals, and conflictCount(meetings: borrow [Meeting]) -> Int counting adjacent conflicts. Add @Main and no tests.",
    source: [
      "struct Meeting {",
      "    let start: Int;",
      "    let duration: Int;",
      "    let importance: Int;",
      "}",
      "function meetingEnd(meeting: borrow Meeting) -> Int { return meeting.start + meeting.duration }",
      "function conflict(left: borrow Meeting, right: borrow Meeting) -> Bool {",
      "    return left.start < meetingEnd(right) && right.start < meetingEnd(left)",
      "}",
      "function conflictCount(meetings: borrow [Meeting]) -> Int {",
      "    var count = 0",
      "    if meetings.count < 2 { return 0 }",
      "    for index in 0..meetings.count {",
      "        if index + 1 < meetings.count && conflict(meetings[index], meetings[index + 1]) { count = count + 1 }",
      "    }",
      "    return count",
      "}"
    ],
    tests: [
      { name: "CalendarEnd", body: "return meetingEnd(Meeting { start: 10; duration: 25; importance: 1 })", type: "Int", expected: "35" },
      { name: "CalendarDetectsOverlap", body: "return conflict(Meeting { start: 10; duration: 25; importance: 1 }, Meeting { start: 20; duration: 5; importance: 2 })", type: "Bool", expected: "true" },
      { name: "CalendarDetectsNoOverlap", body: "return conflict(Meeting { start: 10; duration: 5; importance: 1 }, Meeting { start: 20; duration: 5; importance: 2 })", type: "Bool", expected: "false" },
      { name: "CalendarCountsAdjacentConflicts", body: "var meetings: [Meeting] = []\nmeetings.append(Meeting { start: 0; duration: 10; importance: 1 })\nmeetings.append(Meeting { start: 5; duration: 3; importance: 1 })\nmeetings.append(Meeting { start: 20; duration: 3; importance: 1 })\nreturn conflictCount(meetings)", type: "Int", expected: "1" }
    ]
  }),
  extraCase({
    id: "pipeline-summary",
    title: "Pipeline stage aggregation",
    tags: ["large", "enum", "structs", "arrays", "match", "borrow"],
    prompt: "Define Stage with Queued, Running, Succeeded, Failed and Job with stage: Stage and units: Int. Implement stageWeight(stage: Stage) -> Int returning 0, 1, 2, or -1, and pipelineScore(jobs: borrow [Job]) -> Int summing units * stageWeight. Add @Main and no tests.",
    source: [
      "enum Stage {",
      "    Queued",
      "    Running",
      "    Succeeded",
      "    Failed",
      "}",
      "struct Job {",
      "    let stage: Stage;",
      "    let units: Int;",
      "}",
      "function stageWeight(stage: Stage) -> Int {",
      "    var weight = 0",
      "    match stage {",
      "        Queued -> weight = 0",
      "        Running -> weight = 1",
      "        Succeeded -> weight = 2",
      "        Failed -> weight = -1",
      "    }",
      "    return weight",
      "}",
      "function pipelineScore(jobs: borrow [Job]) -> Int {",
      "    var total = 0",
      "    for job in jobs { total = total + job.units * stageWeight(job.stage) }",
      "    return total",
      "}"
    ],
    tests: [
      { name: "PipelineWeightsRunning", body: "return stageWeight(.Running)", type: "Int", expected: "1" },
      { name: "PipelineWeightsFailed", body: "return stageWeight(.Failed)", type: "Int", expected: "-1" },
      { name: "PipelineScoresJobs", body: "var jobs: [Job] = []\njobs.append(Job { stage: .Running; units: 3 })\njobs.append(Job { stage: .Succeeded; units: 4 })\njobs.append(Job { stage: .Failed; units: 2 })\nreturn pipelineScore(jobs)", type: "Int", expected: "9" }
    ]
  }),
  extraCase({
    id: "priority-queue",
    title: "Priority queue scan with a small app model",
    tags: ["large", "structs", "arrays", "borrow", "selection"],
    prompt: "Define QueueItem with name: String and priority: Int. Implement highestPriority(items: borrow [QueueItem]) -> Int returning the greatest priority or 0 for an empty array, and urgentCount(items: borrow [QueueItem], threshold: Int) -> Int. Add @Main and no tests.",
    source: [
      "struct QueueItem {",
      "    let name: String;",
      "    let priority: Int;",
      "}",
      "function highestPriority(items: borrow [QueueItem]) -> Int {",
      "    if items.count == 0 { return 0 }",
      "    var highest = items[0].priority",
      "    for item in items { if item.priority > highest { highest = item.priority } }",
      "    return highest",
      "}",
      "function urgentCount(items: borrow [QueueItem], threshold: Int) -> Int {",
      "    var count = 0",
      "    for item in items { if item.priority >= threshold { count = count + 1 } }",
      "    return count",
      "}"
    ],
    tests: [
      { name: "PriorityQueueFindsHighest", body: "var items: [QueueItem] = []\nitems.append(QueueItem { name: \"a\"; priority: 2 })\nitems.append(QueueItem { name: \"b\"; priority: 9 })\nreturn highestPriority(items)", type: "Int", expected: "9" },
      { name: "PriorityQueueCountsUrgent", body: "var items: [QueueItem] = []\nitems.append(QueueItem { name: \"a\"; priority: 2 })\nitems.append(QueueItem { name: \"b\"; priority: 9 })\nitems.append(QueueItem { name: \"c\"; priority: 7 })\nreturn urgentCount(items, 7)", type: "Int", expected: "2" },
      { name: "PriorityQueueEmptyIsZero", body: "var items: [QueueItem] = []\nreturn highestPriority(items)", type: "Int", expected: "0" }
    ]
  }),
  extraCase({
    id: "scoreboard",
    title: "Team scoreboard with match points",
    tags: ["large", "structs", "arrays", "borrow", "branching"],
    prompt: "Define Match with homeScore and awayScore Int fields and implement matchPoints(match: Match) -> Int returning 3 for a home win, 1 for a draw, 0 otherwise, plus seasonPoints(matches: borrow [Match]) -> Int. Add @Main and no tests.",
    source: [
      "struct Match {",
      "    let homeScore: Int;",
      "    let awayScore: Int;",
      "}",
      "function matchPoints(game: borrow Match) -> Int {",
      "    if game.homeScore > game.awayScore { return 3 }",
      "    if game.homeScore == game.awayScore { return 1 }",
      "    return 0",
      "}",
      "function seasonPoints(games: borrow [Match]) -> Int {",
      "    var total = 0",
      "    for game in games { total = total + matchPoints(game) }",
      "    return total",
      "}"
    ],
    tests: [
      { name: "ScoreboardHomeWin", body: "return matchPoints(Match { homeScore: 2; awayScore: 1 })", type: "Int", expected: "3" },
      { name: "ScoreboardDraw", body: "return matchPoints(Match { homeScore: 1; awayScore: 1 })", type: "Int", expected: "1" },
      { name: "ScoreboardSeasonTotal", body: "var matches: [Match] = []\nmatches.append(Match { homeScore: 2; awayScore: 1 })\nmatches.append(Match { homeScore: 0; awayScore: 0 })\nmatches.append(Match { homeScore: 0; awayScore: 4 })\nreturn seasonPoints(matches)", type: "Int", expected: "4" }
    ]
  }),
  extraCase({
    id: "text-metrics",
    title: "Text category metrics without string concatenation",
    tags: ["strings", "branching", "small-app"],
    prompt: "Implement wordKind(word: String) -> String returning greeting for hello, farewell for bye, and other otherwise. Implement kindScore(word: String) -> Int returning 3, 2, or 1 using wordKind. Add @Main and no tests.",
    source: [
      "function wordKind(word: borrow String) -> String {",
      "    if word == \"hello\" { return \"greeting\" }",
      "    if word == \"bye\" { return \"farewell\" }",
      "    return \"other\"",
      "}",
      "function kindScore(word: borrow String) -> Int {",
      "    let kind = wordKind(word)",
      "    if kind == \"greeting\" { return 3 }",
      "    if kind == \"farewell\" { return 2 }",
      "    return 1",
      "}"
    ],
    tests: [
      { name: "TextMetricsGreeting", body: "return kindScore(\"hello\")", type: "Int", expected: "3" },
      { name: "TextMetricsFarewell", body: "return wordKind(\"bye\")", type: "String", expected: "\"farewell\"" },
      { name: "TextMetricsOther", body: "return kindScore(\"kira\")", type: "Int", expected: "1" }
    ]
  })
];

const projectLinterSource = `import Foundation

Lint FileLength {
    let code: String = "KLINT003"
    let severity: String = "warning"
    let enabled: Bool = true
    let limit: Int = 700
}`;

function projectPackageSource(name: string): string {
  return `Package ${name} {
    let version = "0.1.0"
    let kira = "0.1.0"
    let kind = PackageKind.App
    let defaults = Defaults { executionMode: Backend.Vm, buildTarget: BuildTarget.Host }
}`;
}

function projectFiles(packageName: string, main: string, extraFiles: Record<string, string> = {}): Record<string, string> {
  return {
    "package.kira": projectPackageSource(packageName),
    "linter.kira": projectLinterSource,
    ...extraFiles,
    "app/main.kira": main
  };
}

interface ProjectCaseInput {
  id: string;
  title: string;
  prompt: string;
  tags: string[];
  files: Record<string, string>;
  tests: ExtraTest[];
  libraries?: LibrarySpec[];
}

function projectCase(input: ProjectCaseInput): BenchmarkCase {
  const requiredFiles = Object.keys(input.files);
  const project: ProjectSpec = {
    requiredFiles,
    entryFile: "app/main.kira",
    lintFile: "linter.kira",
    allowAdditionalFiles: false
  };
  return {
    id: input.id,
    title: input.title,
    prompt: `${input.prompt}

Write a complete project, not a single source snippet. Return the exact files listed by the project layout: package.kira, linter.kira, and the requested app files. The installed Kira CLI calls the root lint configuration linter.kira (not lint.kira). package.kira must define an App package with version and kira version 0.1.0 and VM/Host defaults. linter.kira must import Foundation and enable FileLength as a warning with a limit of 700. Kira never uses semicolon characters; separate declarations and statements with newlines. All app/*.kira files share one package namespace, so do not import sibling app files such as inventory or weather. Libraries named in the library contracts are evaluator-preloaded fixtures, so do not import or redeclare those library names. Do not put Test declarations in any returned file; hidden tests are appended by the evaluator.`,
    tags: input.tags,
    libraries: input.libraries ?? [],
    outputMode: "project",
    project,
    evaluation: { mode: "test", runLint: true, hiddenTests: extraHiddenTests(input.tests) },
    fixtureFiles: input.files
  };
}

const projectCases: BenchmarkCase[] = [
  projectCase({
    id: "project-focus-board",
    title: "Complete focus board project with manifest, linter, and app entrypoint",
    tags: ["project", "package", "linter", "enum", "match", "borrow", "arrays"],
    prompt: "Build a small FocusBoard app. In app/main.kira define CardState with Planned, Active, and Done, define Card with title: String, points: Int, and state: CardState, implement stateWeight(state: CardState) -> Int returning 0, 1, and 2, implement boardScore(cards: borrow [Card]) -> Int summing points times state weight, and implement openPoints(cards: borrow [Card]) -> Int summing points for Planned and Active cards. Add a small @Main function.",
    files: projectFiles("focus_board", `import Foundation

enum CardState {
    Planned
    Active
    Done
}

struct Card {
    let title: String;
    let points: Int;
    let state: CardState;
}

function stateWeight(state: CardState) -> Int {
    var weight = 0
    match state {
        Planned -> weight = 0
        Active -> weight = 1
        Done -> weight = 2
    }
    return weight
}

function boardScore(cards: borrow [Card]) -> Int {
    var total = 0
    for card in cards {
        total = total + card.points * stateWeight(card.state)
    }
    return total
}

function openPoints(cards: borrow [Card]) -> Int {
    var total = 0
    for card in cards {
        if card.state == .Planned || card.state == .Active {
            total = total + card.points
        }
    }
    return total
}

@Main
function main() {
    print("FocusBoard")
    return
}`),
    tests: [
      { name: "ProjectFocusWeightsActive", body: "return stateWeight(.Active)", type: "Int", expected: "1" },
      { name: "ProjectFocusScoresCards", body: "var cards: [Card] = []\ncards.append(Card { title: \"plan\"; points: 2; state: .Planned })\ncards.append(Card { title: \"ship\"; points: 3; state: .Active })\ncards.append(Card { title: \"done\"; points: 5; state: .Done })\nreturn boardScore(cards)", type: "Int", expected: "13" },
      { name: "ProjectFocusCountsOpenPoints", body: "var cards: [Card] = []\ncards.append(Card { title: \"plan\"; points: 2; state: .Planned })\ncards.append(Card { title: \"ship\"; points: 3; state: .Active })\ncards.append(Card { title: \"done\"; points: 5; state: .Done })\nreturn openPoints(cards)", type: "Int", expected: "5" }
    ]
  }),
  projectCase({
    id: "project-inventory-app",
    title: "Multi-file inventory app using a fictional stock library",
    tags: ["project", "package", "linter", "fictional-library", "multi-file", "borrow", "arrays"],
    libraries: [stockKit],
    prompt: "Build a small inventory reorder app with app/inventory.kira and app/main.kira. In app/inventory.kira define InventoryItem with sku: String and requested: Int. Use the supplied StockKit library to implement reorderUnits(sku: borrow String) -> Int, returning the quantity needed to reach the SKU minimum, and totalReorder(items: borrow [InventoryItem]) -> Int. Also implement inventoryValue(items: borrow [InventoryItem]) -> Int using the current quantity and the prices pencil=3 and paper=2. app/main.kira should contain @Main and may call the inventory functions.",
    files: projectFiles("inventory_app", `import Foundation

function sampleReorder() -> Int {
    var items: [InventoryItem] = []
    items.append(InventoryItem { sku: "pencil"; requested: 5 })
    items.append(InventoryItem { sku: "paper"; requested: 1 })
    return totalReorder(items)
}

@Main
function main() {
    print("Inventory")
    print(sampleReorder())
    return
}`, {
      "app/inventory.kira": `struct InventoryItem {
    let sku: String;
    let requested: Int;
}

function reorderUnits(sku: borrow String) -> Int {
    let kit = makeStockKit()
    if sku == "pencil" {
        let quantity = kit.quantity("pencil")
        let minimum = kit.minimum("pencil")
        if quantity < minimum {
            return minimum - quantity
        }
        return 0
    }
    if sku == "paper" {
        let quantity = kit.quantity("paper")
        let minimum = kit.minimum("paper")
        if quantity < minimum {
            return minimum - quantity
        }
        return 0
    }
    return 1
}

function totalReorder(items: borrow [InventoryItem]) -> Int {
    var total = 0
    for item in items {
        total = total + reorderUnits(item.sku)
    }
    return total
}

function inventoryValue(items: borrow [InventoryItem]) -> Int {
    let kit = makeStockKit()
    var total = 0
    for item in items {
        if item.sku == "pencil" {
            total = total + kit.quantity("pencil") * 3
        }
        if item.sku == "paper" {
            total = total + kit.quantity("paper") * 2
        }
    }
    return total
}`
    }),
    tests: [
      { name: "ProjectInventoryReordersPencils", body: "return reorderUnits(\"pencil\")", type: "Int", expected: "3" },
      { name: "ProjectInventoryTotalsReorder", body: "var items: [InventoryItem] = []\nitems.append(InventoryItem { sku: \"pencil\"; requested: 5 })\nitems.append(InventoryItem { sku: \"paper\"; requested: 1 })\nreturn totalReorder(items)", type: "Int", expected: "3" },
      { name: "ProjectInventoryValuesStock", body: "var items: [InventoryItem] = []\nitems.append(InventoryItem { sku: \"pencil\"; requested: 1 })\nitems.append(InventoryItem { sku: \"paper\"; requested: 1 })\nreturn inventoryValue(items)", type: "Int", expected: "30" }
    ]
  }),
  projectCase({
    id: "project-tool-queue",
    title: "Complete batch tool queue app split across project files",
    tags: ["project", "package", "linter", "fictional-library", "programmatic-tools", "multi-file", "structs"],
    libraries: [batchTools],
    prompt: "Build a QueueDesk app with app/tooling.kira and app/main.kira. In app/tooling.kira define QueueSummary with jobs: Int and totalCost: Int, implement summarizeQueue(queue: borrow String) -> QueueSummary by calling makeBatchTools(), searching the queue, and synchronously looping over every returned job to execute it and add each cost, and implement queueCost(queue: borrow String) -> Int. app/main.kira should contain @Main and call the helper. This is a Kira representation of programmatic tool orchestration; do not invent async syntax or tool protocol declarations.",
    files: projectFiles("queue_desk", `import Foundation

@Main
function main() {
    let summary = summarizeQueue("build")
    print("QueueDesk")
    print(summary.jobs)
    print(summary.totalCost)
    return
}`, {
      "app/tooling.kira": `struct QueueSummary {
    let jobs: Int;
    let totalCost: Int;
}

function summarizeQueue(queue: borrow String) -> QueueSummary {
    let tools = makeBatchTools()
    let jobs = tools.search(queue)
    var total = 0
    for job in jobs {
        let result = tools.execute(job.id)
        total = total + result.cost
    }
    return QueueSummary { jobs: jobs.count; totalCost: total }
}

function queueCost(queue: borrow String) -> Int {
    return summarizeQueue(queue).totalCost
}`
    }),
    tests: [
      { name: "ProjectQueueCountsJobs", body: "return summarizeQueue(\"build\").jobs", type: "Int", expected: "2" },
      { name: "ProjectQueueSumsCosts", body: "return queueCost(\"build\")", type: "Int", expected: "18" }
    ]
  }),
  projectCase({
    id: "project-budget-ledger",
    title: "Budget ledger application with enum state and multi-file domain model",
    tags: ["project", "package", "linter", "multi-file", "enum", "match", "borrow", "arrays"],
    prompt: "Build a BudgetLens app with app/ledger.kira and app/main.kira. In app/ledger.kira define InvoiceState with Draft, Sent, Paid, and Overdue and Invoice with number: Int, cents: Int, and state: InvoiceState. Implement stateWeight(state: InvoiceState) -> Int returning 0, 1, 2, and -1, outstandingCents(invoices: borrow [Invoice]) -> Int summing Sent and Overdue invoices, and ledgerScore(invoices: borrow [Invoice]) -> Int summing cents times stateWeight. app/main.kira should contain @Main.",
    files: projectFiles("budget_lens", `import Foundation

function sampleLedgerScore() -> Int {
    var invoices: [Invoice] = []
    invoices.append(Invoice { number: 1; cents: 100; state: .Sent })
    invoices.append(Invoice { number: 2; cents: 50; state: .Paid })
    return ledgerScore(invoices)
}

@Main
function main() {
    print("BudgetLens")
    print(sampleLedgerScore())
    return
}`, {
      "app/ledger.kira": `enum InvoiceState {
    Draft
    Sent
    Paid
    Overdue
}

struct Invoice {
    let number: Int;
    let cents: Int;
    let state: InvoiceState;
}

function stateWeight(state: InvoiceState) -> Int {
    var weight = 0
    match state {
        Draft -> weight = 0
        Sent -> weight = 1
        Paid -> weight = 2
        Overdue -> weight = -1
    }
    return weight
}

function outstandingCents(invoices: borrow [Invoice]) -> Int {
    var total = 0
    for invoice in invoices {
        if invoice.state == .Sent || invoice.state == .Overdue {
            total = total + invoice.cents
        }
    }
    return total
}

function ledgerScore(invoices: borrow [Invoice]) -> Int {
    var total = 0
    for invoice in invoices {
        total = total + invoice.cents * stateWeight(invoice.state)
    }
    return total
}`
    }),
    tests: [
      { name: "ProjectBudgetWeightsOverdue", body: "return stateWeight(.Overdue)", type: "Int", expected: "-1" },
      { name: "ProjectBudgetFindsOutstanding", body: "var invoices: [Invoice] = []\ninvoices.append(Invoice { number: 1; cents: 100; state: .Sent })\ninvoices.append(Invoice { number: 2; cents: 50; state: .Paid })\ninvoices.append(Invoice { number: 3; cents: 25; state: .Overdue })\nreturn outstandingCents(invoices)", type: "Int", expected: "125" },
      { name: "ProjectBudgetScoresLedger", body: "var invoices: [Invoice] = []\ninvoices.append(Invoice { number: 1; cents: 100; state: .Sent })\ninvoices.append(Invoice { number: 2; cents: 50; state: .Paid })\ninvoices.append(Invoice { number: 3; cents: 25; state: .Overdue })\nreturn ledgerScore(invoices)", type: "Int", expected: "175" }
    ]
  }),
  projectCase({
    id: "project-weather-planner",
    title: "Weather-aware city planner with package, linter, and domain module",
    tags: ["project", "package", "linter", "fictional-library", "multi-file", "borrow", "strings", "arrays"],
    libraries: [weatherKit],
    prompt: "Build a CityDay planner with app/weather.kira and app/main.kira. In app/weather.kira define CityPlan with city: String and minimum: Int. Use the supplied WeatherKit library to implement comfortable(plan: borrow CityPlan) -> Bool by reading the city's temperature and comparing it to minimum, and comfortableCount(plans: borrow [CityPlan]) -> Int. app/main.kira should contain @Main and use the helper. Do not redeclare WeatherKit or its result type.",
    files: projectFiles("city_day", `import Foundation

@Main
function main() {
    var plans: [CityPlan] = []
    plans.append(CityPlan { city: "Paris"; minimum: 15 })
    plans.append(CityPlan { city: "Berlin"; minimum: 15 })
    print("CityDay")
    print(comfortableCount(plans))
    return
}`, {
      "app/weather.kira": `struct CityPlan {
    let city: String;
    let minimum: Int;
}

function comfortable(plan: borrow CityPlan) -> Bool {
    let kit = makeWeatherKit()
    let reading = kit.reading(plan.city)
    return reading.temperature >= plan.minimum
}

function comfortableCount(plans: borrow [CityPlan]) -> Int {
    var count = 0
    for plan in plans {
        if comfortable(plan) {
            count = count + 1
        }
    }
    return count
}`
    }),
    tests: [
      { name: "ProjectWeatherParisIsComfortable", body: "return comfortable(CityPlan { city: \"Paris\"; minimum: 15 })", type: "Bool", expected: "true" },
      { name: "ProjectWeatherCountsPlans", body: "var plans: [CityPlan] = []\nplans.append(CityPlan { city: \"Paris\"; minimum: 15 })\nplans.append(CityPlan { city: \"Berlin\"; minimum: 15 })\nreturn comfortableCount(plans)", type: "Int", expected: "1" }
    ]
  })
];

export const benchmarkCases: BenchmarkCase[] = [...baseBenchmarkCases, ...additionalCases, ...projectCases];

export function getBenchmarkCases(ids?: string[]): BenchmarkCase[] {
  if (!ids || ids.length === 0 || ids.includes("all")) {
    return benchmarkCases;
  }

  const wanted = new Set(ids);
  const selected = benchmarkCases.filter((benchmarkCase) => wanted.has(benchmarkCase.id));
  const missing = ids.filter((id) => !benchmarkCases.some((benchmarkCase) => benchmarkCase.id === id));
  if (missing.length > 0) {
    throw new Error(`Unknown benchmark case(s): ${missing.join(", ")}`);
  }
  return selected;
}

export function toAgentCaseView(benchmarkCase: BenchmarkCase): AgentCaseView {
  return {
    id: benchmarkCase.id,
    title: benchmarkCase.title,
    prompt: benchmarkCase.prompt,
    tags: benchmarkCase.tags,
    outputMode: benchmarkCase.outputMode ?? "source",
    project: benchmarkCase.project,
    libraries: benchmarkCase.libraries.map(({ name, kind, purpose, contract }) => ({
      name,
      kind,
      purpose,
      contract
    }))
  };
}

export function packageManifest(packageName = "kira_skill_bench_case"): string {
  return `Package ${packageName} {
    let version = "0.1.0"
    let kira = "0.1.0"
    let kind = PackageKind.App
    let defaults = Defaults { executionMode: Backend.Vm, buildTarget: BuildTarget.Host }
}`;
}

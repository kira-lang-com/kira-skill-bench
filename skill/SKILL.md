---
name: working-with-kira
description: This skill helps you write and validate Kira code efficiently across multiple backends (VM, LLVM-native, hybrid, and wasm) by providing syntax guidance, error diagnostics, and debugging support. Use it when creating, editing, or executing Kira projects to ensure your code runs correctly and consistently regardless of the chosen backend.
---

## Parity = the law
Same source, all backends agree: `vm`, `llvm` (native), `hybrid`, `wasm32-emscripten`. `--backend vm|llvm|hybrid` works on `run`/`build`/`check`; the default comes from `package.kira`'s `Defaults.executionMode`. **VM has no FFI** → libs using Kira Graphics / UI Foundation need `hybrid`/`llvm`. DONE = works (or rejected with a diagnostic) on every targeted backend, not one.

Project: `package.kira` + `linter.kira` + `app/main.kira` holding `@Main`. The installed CLI calls the root lint file `linter.kira`, not `lint.kira`. Use this manifest spelling exactly, with no semicolons:
```kira
Package app_name {
    let version = "0.1.0"
    let kira = "0.1.0"
    let kind = PackageKind.App
    let defaults = Defaults { executionMode: Backend.Vm, buildTarget: BuildTarget.Host }
}
```
Before returning a project, verify the field names, quoted version strings, `PackageKind.App`, `Backend.Vm`, `BuildTarget.Host`, and the colon/comma syntax in `Defaults`. For a linter, use this shape, written on separate lines:
```kira
import Foundation

construct FileLength() extends Lint {
    let code: String = "KLINT003"
    let level: LintLevel = .Warn
    let limit: Int = 700
}
```
A lint override is a construct-family declaration: `construct <Name>() extends Lint { … }`. Every lint ships a sensible default level, so `linter.kira` states only the few you want different — do not enumerate every lint; a package that agrees with the defaults writes no `linter.kira` at all and is still linted. `let level: LintLevel = .Warn` sets the level: `.Allow` (off — nothing is walked, costs nothing), `.Warn` (reported, build continues — the default for almost everything), `.Deny` (reported, build fails). Disable a lint with `level: .Allow`.

## Canonical Kira spelling
Kira does not use semicolon characters. Never emit `;` in source, manifests, linter files, or project output. Separate fields, declarations, statements, and match arms with newlines; use commas only where the grammar explicitly requires them, such as the `Defaults` fields above. Do not copy semicolon-heavy examples from other languages.

In a multi-file package, every `app/*.kira` file shares the package namespace and is compiled together. Do not import sibling files such as `app/inventory.kira` or `app/weather.kira`; call their declarations directly. A benchmark library contract marked evaluator-preloaded is already injected into that package. Do not import or redeclare that fictional library name. Import only a module that the package actually provides or declares as a dependency.

## Core syntax
- `let` immutable, `var` mutable, and the type is optional (`let n: Int = 3`). Use `@Main function main() { ... return }` and `function f(a: Int) -> Int {}`.
- Types: `Int` (64-bit signed) `Float` (64-bit) `Bool String`; width scalars `I8 I16 I32 U8 U16 U32 U64` and `F32`; `RawPtr CString CBool`. `Int` and `Float` are the 64-bit integer and float — there is no `I64` or `F64`. `Int32` aliases `I32`; `Byte` is `type Byte = U8`. No implicit widening between two written widths (`u8 + u32` = `KSEM071`); a literal adapts to the width it is written into and bare `Int` pairs with any int width. Convert with `Int(x) U64(x) F32(x)…`, range-checked (traps if the value does not fit).
- Functions that return no value omit the return type entirely. Never invent a return type for them.
- Annotations: `@Main @Native @Runtime @FFI.Extern @State @Printable @MainThread @MainThreadLifecycle`.
- Methods inside struct/class body, implicit `self`: `struct Point { var x: Int function sum() -> Int { return self.x } }`. Build `Point { x: 1 }`.
- `@Printable` means define `onPrint() -> String`. `print(v)` dispatches to it.
- Arrays `[Any]` (element type in brackets): `var xs: [Int] = []`, `xs.append(3)`, `xs.count`, `xs[0]`, `for v in xs {}`. A `for` variable is each element, not its index or identifier; when iterating structs, pass the required field to APIs expecting a scalar (for example, `for item in items { process(item.id) }`). Struct may own array field.
- A function named `count` should count matching elements unless the request explicitly asks for a sum. Increment with `count = count + 1` and do not add an unrelated numeric field merely because it is available.
- Imports: `import Foundation` (bare → names in scope), `import X as Y`. Imports are **file-scoped**: each file that uses a module imports it itself, so importing Foundation (or any library) in several files of one package is correct, not an error. Top-level declaration names are globally unique across the package — redeclaring one, including a name Foundation provides, is `KSEM003`.
- For an actual project, resolve every non-core import: a local `import X` requires the compiler to find `X.kira` at the expected path or a verified package dependency. Never invent an import or API from task prose alone.
- A benchmark library contract explicitly marked evaluator-preloaded is the exception: its declarations are injected into the package by the evaluator. Use the declared API directly, without importing or redeclaring that library, and do not apply the unresolved-module stop to that contract.
- Treat declaration verification as a hard precondition for using a non-core import: record the exact signature of every invoked symbol—including constructors and follow-up operations—before emitting the call. If declarations are unavailable, report the missing API information instead of deriving a call name or receiver from task prose. At every call, match the declared parameter types, ownership, and return type: pass borrowed arguments directly, preserve returned collection element types instead of imposing a guessed annotation, and project the required field when either an element or returned struct must supply a scalar. KSEM114 means remove `move` because the callee borrows the argument; KSEM063 means pass a value of the declared parameter type, projecting a struct field when necessary. Call declared methods through their receiver and declared free functions directly. KSEM097 means the receiver lacks that method; KSEM061 means no imported or local free function has that name, so inspect the declarations and use the exact declared operation instead of guessing another call shape.

## Enums + match
```kira
enum E { InvalidFormat: String = "def"   // single payload + default
         UnexpectedEnd }                  // payload-less
let e: E = .InvalidFormat                 // expected type supplies E
match e { InvalidFormat(t) -> { ... } UnexpectedEnd -> { ... } }  // unqualified inside, payload bound; no semicolons between arms
```
`match` is exhaustive (missing/dup-arm diagnostics). `Result<Value,Failure>` is the canonical 2-variant (`.Ok(v)` or `.Error(f)` in an expected `Result` context). Do not assume fieldless enums are Copy. Follow the ordinary ownership rules when passing them.
For a user-facing enum `label` function, honor exact labels stated by the task; if no labels are stated, preserve each variant's spelling rather than inventing spaces or case changes.

## Expected-type `.member`
Kira uses a leading-dot expression when the surrounding position supplies its expected type. Anchors include typed locals/fields/defaults, function arguments and returns, typed array elements, the other side of a comparison, and an outer enum payload.
```kira
let tone: Tone = .Red
let tones: [Tone] = [.Red, .Label("hi")]
score(.Green)
function defaultTone() -> Tone { return .Red }
if backend == .VM { print("vm") }

let animal: Animal = .Dog()             // concrete subclass expected as Animal
let child: some Widget = .Text()        // declaration satisfying Widget
let tone2: Tone = .makeTone()           // compatible named function result
apply(6, .twice)                         // compatible named callback
```
This is expected-type name resolution, not static members. `let x = .Red` has no anchor (or the anchor is a non-enum type) and fails with `KSEM119`; Kira adds a type (`let x: Tone = .Red`) or keeps `Tone.Red`. A leading dot naming a variant the anchored enum does not have fails with `KSEM120`. The qualified spelling remains valid.

## Classes / inheritance
`class` adds inheritance over `struct`. `class Child extends Left, Right { override let value = 11 function t() -> Int { return Left.doubled() + Right.value } }` — multi-parent, `override` field default, parent-qualified field/method access, exact-signature overrides, parity across backends.

## Closures
Closures use values such as `{ x in ... }`; trailing-callback `app.onFrame { frame in ... }` (binds as final fn arg), and zero-param `app.tick { in ... }`. For a callback that returns no value, follow the declared no-return form and omit its return type. Capture `let` by value and `var` as shared-mutable. Nested and multiple closures share by lexical scope on all backends. Non-Copy capture into an escaping closure = KSEM117 (reject).

## Control flow
`if/else`, `while`, `x ? a : b`, `break`, `continue`, and `return` are standard. In a sentinel loop, check the exit condition before mutating when the initial value may already satisfy it. No `switch`/`case`/`default` — dispatch an enum with `match`. Range `for i in start..end` is half-open Int (`0..5` → 0..4), `i` is immutable, and the range is empty if `start >= end`. Replace a manual counter loop with `for i in 0..n {}`. `..` is valid only in a for slot.

## attempt / try / handle
Linear `Result` unwrap uses the `try` keyword, not `?`, and desugars to `match` on vm/hybrid. `try` must initialize a new `let` directly inside the `attempt` body. Write `let v = try operation()` and then assign or use `v` separately. Do not place `try` in an assignment to an existing `var` or nest it in another expression.
```kira
attempt {
    let v = try render()
    print(v)
}
handle {
    MissingNode(r) { print(r) }
    InvalidState(r) { print(r) }
}
```
`try expr`: Ok → value flows on; Error → jump to matching handle (binds payload). Diagnostics: try-outside-attempt, try-on-non-Result, missing/unknown handle case, incompatible failure enums.

## Ownership = Rust affine
Non-Copy MOVES on use; use-after-move = compile error. An untagged parameter is owned/consumed, so pass an owned value explicitly as `move value` (for example, `moodLabel(move mood)`) or declare a read-only parameter as `borrow Any`. When a parameter is only inspected, traversed, or forwarded to borrowing APIs, declare it as `value: borrow Any`. Call-site ownership is determined by the callee: pass an argument directly to a `borrow` parameter even when the caller owns that value, and use `move` only when the callee's parameter is owned. Propagate borrowing through read-only helper chains: `function label(value: borrow String) -> String` may receive a borrowed argument, while forwarding that argument to an owned parameter attempts an invalid ownership transfer. If a callee owns a `String` or struct argument, do not forward a borrowed parameter to it, and do not pass the same owned value to two consuming calls. KSEM108 means the callee owns the argument. Params: `borrow Any` (read alias), `borrow mut Any` (mutable alias + writeback), untagged = owned/consumed. Prefer `borrow` on hot read paths (avoid deep copy). Invalid code must fail compile, not crash.

## FFI / native
```kira
@Native function doNative(user_data: RawPtr, v: Int) -> Int {}
@FFI.Extern {
    library: kira_runtime
    symbol: kira_dynamic_write_f32_at
    abi: c
}
function dynWriteF32At(ptr: RawPtr, offset: U64, value: F32)
```
Native state: `nativeState(S{...})` → `nativeUserData(s)` → later `nativeRecover<S>(tok)`. Cost: `nativeRecover` materializes the whole struct each call; struct-array marshal across `@Native` = deep copy O(fields×elems), flat `[Float]`/raw buffer = cheap memcpy; closures don't survive nativeState round-trip (pass via `borrow` app). Per-element crossing is the cost — batch into one span/bulk FFI call.

## async / tasks / channels
`async function` marks a task entry point — a body spawned with `Task { … }`, not called directly (direct call = `KSEM354`; only an `async function` is a valid task target = `KSEM352`). Its params are owned or copied, never borrowed (`KSEM353`). `async` is contextual (a local named `async` still binds).
```kira
async function total(a: Int, b: Int) -> Int { return a + b }

let handle = Task { total(40, 2) }   // args evaluate now; body runs at first drive
print(handle.await)                  // 42
```
A `Task { … }` body is one call to an `async function` (chosen among overloads) or a bare numeric literal; a body of any other shape (an expression, a method call) is `KSEM159`. Its arguments and result may be **any `Send` value** — `Int Float Bool String`, arrays, structs, classes, enums, `Any`, `RawPtr`, `distinct` — the same set channels carry (a value that owns storage crosses as a token into per-run storage and is recovered on the other side). The only type gate is `Send`: a non-`Send` argument or result — a closure/function value, a captured `var`, a task handle, native-state — is refused with `KSEM312`. Arity is bounded by the fixed task slots. A handle has exactly three ops (anything else `KSEM158`): `.await` (drive to completion, take the result — a `Void` body joins as `Int` `0`), `.requestCancel()` (ask a not-yet-run task not to run; awaiting it after traps), `.detach()` (drive and discard; awaiting after traps, as does joining twice). `taskYield()` is a cooperative suspend point; `taskSleep(ms)` advances a **virtual** clock then yields (nothing sleeps in real time, so ordering is identical on every backend). What a task takes and returns must be `Send` (`KSEM312`).

Channels are an ordered handoff. `Channel<Any>()` returns the **sender**; read the **receiver** off it as `.receiver` (one channel however many reads). `sender.send(v)`, `receiver.receive()`, `end.close()` on either end; anything else (incl. `.raw`) is `KSEM367`. `receive()` suspends and is fallible, so it is written `let v = try rx.receive()` inside an `attempt`; a drained closed channel answers `ChannelError.Closed` (cover it in `handle`), while sending to a channel whose receiver is gone traps. `Sender<Any>`/`Receiver<Any>` are distinct types; payloads must be `Send`.

## Main thread
`@Main` runs on Kira's application **helper thread**, not the operating-system main thread. A framework that must use the process main thread marks its target `@MainThread` and reaches it only through one of three explicit operations, each taking a single direct call in a trailing block:
```kira
@MainThread function makeView(text: String) -> String { return text }

let view = MainThread.invoke { makeView("Kira") }   // waits, returns the value
let later = MainThread.spawn { makeView("later") }  // queues, handle with only `.await`
MainThread.post { makeView("notify") }              // queues, no result (Void)
```
A direct call to an `@MainThread` function from the helper is rejected. Arguments and results are owned `Send` copies — no `borrow mut` across the boundary. `@MainThreadLifecycle` marks a zero-argument `Void` function that, called from `@Main`, starts a preserved event loop pinned to the process main thread and returns immediately; the instance keeps its locals and call stack across cooperative slices, its whole transitive call tree stays main-thread pinned, and multiple instances share slices and coexist with `@MainThread` work. Both annotations are unavailable on WebAssembly (`KSEM338`), and `@MainThread` cannot also be `@Main`.

## CLI
`kira new <name>` · `kira add <pkg>` · `kira check [--backend b] <path>` (analyze, fast) · `kira run` (build+exec) · `kira build` (native/wasm artifact) · `kira test <path>` (run `Test` decls) · `knvm llvm install` (provision the LLVM bundle, required before llvm/native/hybrid builds). `<path>` = dir, manifest, or single `.kira`.

## Test
```kira
construct SumsRange() extends Test {
    test {
        var s = 0
        for i in 0..5 {
            s = s + i
        }
        return s
    }
    expect {
        let e: Result<Any, TestFailure> = .Ok(10)
        return e
    }
}
```
A test case is a construct-family declaration: `construct <Name>() extends Test { test {…} expect {…} }`. `Test` is a family the test package declares (`tests-kik/harness`), not a compiler keyword. Both members use `Any`: `test() -> Any` and `expect() -> Result<Any, TestFailure>`, so the measured value erases into `Any` at `.Ok(10)`. Write the family's specialization `Result<Any, TestFailure>` exactly — `Result<Int, TestFailure>` is a different specialization and is rejected (`KSEM032`); build a helper's `Result<Int,…>` then unpack it. Use `import Foundation` once. `kira test` must end "0 failed". Reduce each test to a scalar it measures. A `return` solely inside a match or if arm infers no value → KSEM031, so use a `var out` accumulator. A trap test with `.Error(.Runtime(""))` passes iff the body traps.

## Catches (don't guess from Rust/Swift/TS)
- Keyword is `function`, never `fn`/`func`/`def`. No `pub`/`mut` keyword (use `var`). Return type accepts both `-> Int` and `): Int` (colon common); omit it for no-return functions.
- **No `++`/`--`/`+=`/compound assign** — write `i = i + 1`. Count up with `for i in 0..n`.
- **No string `+` concat, no `"\(x)"` interpolation** — text via `@Printable onPrint()` or pass values straight to `print`.
- **No builtin null/nil/optional** — model absence with your own enum or `Result`; `None` only exists if declared.
- Inside a method fields are bare (`value`) or `self.x`. Array API is `.append`/`.count`/`xs[i]` — not push/len/size; typed-uninit decl `var xs: [Int]` is allowed.

## Gotchas
- `print` is line-buffered: the default `StdoutHost` writes via Rust `println!`, flushing on each newline, so redirected and piped output arrives in full.
- `knvm binstall` builds the compiler optimized and installs it under `~/.kira/toolchains/dev/<version>/`, pointing the `kira` launcher at it — the launcher runs the *installed* toolchain, so `cargo build` alone does not change what `kira` runs; rerun `knvm binstall` after compiler changes (or invoke `./target/release/kira` directly). `knvm sinstall` installs the tools themselves — `knvm`, the launcher, the language server — out of the checkout. Only matters when working on Kira itself.
- KIR001 "not executable in current backend pipeline" = lowering gap; `kira check` names construct+span.
- Headless env may SIGKILL (137) GUI/graphics `kira run`; validate with `kira check` + `kira test` instead.

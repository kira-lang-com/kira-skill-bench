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

Lint FileLength {
    let code: String = "KLINT003"
    let severity: String = "warning"
    let enabled: Bool = true
    let limit: Int = 700
}
```

## Canonical Kira spelling
Kira does not use semicolon characters. Never emit `;` in source, manifests, linter files, or project output. Separate fields, declarations, statements, and match arms with newlines; use commas only where the grammar explicitly requires them, such as the `Defaults` fields above. Do not copy semicolon-heavy examples from other languages.

In a multi-file package, every `app/*.kira` file shares the package namespace and is compiled together. Do not import sibling files such as `app/inventory.kira` or `app/weather.kira`; call their declarations directly. A benchmark library contract marked evaluator-preloaded is already injected into that package. Do not import or redeclare that fictional library name. Import only a module that the package actually provides or declares as a dependency.

## Core syntax
- `let` immutable, `var` mutable, and the type is optional (`let n: I64 = 3`). Use `@Main function main() { ... return }` and `function f(a: Int) -> Int {}`.
- Types: `Int Float Bool String`, width ints `I8…U64`, floats `F32 F64`, and `RawPtr CString CBool`. Cast `Int(x) U64(x) F32(x)…` = same-kind identity at runtime. Int auto-widens into a wider parameter.
- Functions that return no value omit the return type entirely. Never invent a return type for them.
- Annotations: `@Main @Native @Runtime @FFI.Extern @State @Printable`.
- Methods inside struct/class body, implicit `self`: `struct Point { var x: Int function sum() -> Int { return self.x } }`. Build `Point { x: 1 }`.
- `@Printable` means define `onPrint() -> String`. `print(v)` dispatches to it.
- Arrays `[T]`: `var xs: [Int] = []`, `xs.append(3)`, `xs.count`, `xs[0]`, `for v in xs {}`. A `for` variable is each element, not its index or identifier; when iterating structs, pass the required field to APIs expecting a scalar (for example, `for item in items { process(item.id) }`). Struct may own array field.
- A function named `count` should count matching elements unless the request explicitly asks for a sum. Increment with `count = count + 1` and do not add an unrelated numeric field merely because it is available.
- Imports: `import Foundation` (bare → names in scope), `import X as Y`. Top-level names globally unique (dup=KSEM003); don't import Foundation twice.
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
This is expected-type name resolution, not static members. `let x = .Red` has no anchor and fails with `KSEM166`; Kira adds a type (`let x: Tone = .Red`) or keeps `Tone.Red`. An anchored but missing/incompatible member fails with `KSEM167`. The qualified spelling remains valid.

## Classes / inheritance
`class` adds inheritance over `struct`. `class Child extends Left, Right { override let value = 11 function t() -> I64 { return Left.doubled() + Right.value } }` — multi-parent, `override` field default, parent-qualified field/method access, exact-signature overrides, parity across backends.

## Closures
Closures use values such as `{ x in ... }`; trailing-callback `app.onFrame { frame in ... }` (binds as final fn arg), and zero-param `app.tick { in ... }`. For a callback that returns no value, follow the declared no-return form and omit its return type. Capture `let` by value and `var` as shared-mutable. Nested and multiple closures share by lexical scope on all backends. Non-Copy capture into an escaping closure = KSEM117 (reject).

## Control flow
`if/else`, `while`, `x ? a : b`, `break`, `continue`, and `return` are standard. In a sentinel loop, check the exit condition before mutating when the initial value may already satisfy it. `switch x { case 1 { ... } }` uses a brace block, not `->`. Range `for i in start..end` is half-open Int (`0..5` → 0..4), `i` is immutable, and the range is empty if `start >= end`. Replace a manual counter loop with `for i in 0..n {}`. `..` is valid only in a for slot.

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
Non-Copy MOVES on use; use-after-move = compile error. An untagged parameter is owned/consumed, so pass an owned value explicitly as `move value` (for example, `moodLabel(move mood)`) or declare a read-only parameter as `borrow T`. When a parameter is only inspected, traversed, or forwarded to borrowing APIs, declare it as `value: borrow T`. Call-site ownership is determined by the callee: pass an argument directly to a `borrow` parameter even when the caller owns that value, and use `move` only when the callee's parameter is owned. Propagate borrowing through read-only helper chains: `function label(value: borrow String) -> String` may receive a borrowed argument, while forwarding that argument to an owned parameter attempts an invalid ownership transfer. If a callee owns a `String` or struct argument, do not forward a borrowed parameter to it, and do not pass the same owned value to two consuming calls. KSEM108 means the callee owns the argument. Params: `borrow T` (read alias), `borrow mut T` (mutable alias + writeback), untagged = owned/consumed. Prefer `borrow` on hot read paths (avoid deep copy). Invalid code must fail compile, not crash.

## FFI / native
```kira
@Native function doNative(user_data: RawPtr, v: I64) -> I64 {}
@FFI.Extern {
    library: kira_runtime
    symbol: kira_dynamic_write_f32_at
    abi: c
}
function dynWriteF32At(ptr: RawPtr, offset: U64, value: F32)
```
Native state: `nativeState(S{...})` → `nativeUserData(s)` → later `nativeRecover<S>(tok)`. Cost: `nativeRecover` materializes the whole struct each call; struct-array marshal across `@Native` = deep copy O(fields×elems), flat `[Float]`/raw buffer = cheap memcpy; closures don't survive nativeState round-trip (pass via `borrow` app). Per-element crossing is the cost — batch into one span/bulk FFI call.

## CLI
`kira new <name>` · `kira add <pkg>` · `kira check [--backend b] <path>` (analyze, fast) · `kira run` (build+exec) · `kira build` (native/wasm artifact) · `kira test <path>` (run `Test` decls) · `kira fetch-llvm` (before llvm/native). `<path>` = dir, manifest, or single `.kira`.

## Test
```kira
Test SumsRange {
    test {
        var s = 0
        for i in 0..5 {
            s = s + i
        }
        return s
    }
    expect {
        let e: Result<Int, TestFailure> = .Ok(10)
        return e
    }
}
```
Use `import Foundation` once. `kira test` must end "0 failed". Reduce each test to a SCALAR (Int, Bool, or String) because the runner compares scalars only. A `return` solely inside a match or if arm infers no value → KSEM031, so use a `var out` accumulator. A trap test with `.Error(.Runtime(""))` passes iff the body traps.

## Catches (don't guess from Rust/Swift/TS)
- Keyword is `function`, never `fn`/`func`/`def`. No `pub`/`mut` keyword (use `var`). Return type accepts both `-> Int` and `): Int` (colon common); omit it for no-return functions.
- **No `++`/`--`/`+=`/compound assign** — write `i = i + 1`. Count up with `for i in 0..n`.
- **No string `+` concat, no `"\(x)"` interpolation** — text via `@Printable onPrint()` or pass values straight to `print`.
- **No builtin null/nil/optional** — model absence with your own enum or `Result`; `None` only exists if declared.
- Inside a method fields are bare (`value`) or `self.x`. Array API is `.append`/`.count`/`xs[i]` — not push/len/size; typed-uninit decl `var xs: [Int]` is allowed.

## Gotchas
- `print` block-buffered → output LOST when stdout redirected and host exits without flush. Use pty (`script -q F kira run …`), trust exit code, or runtime log markers (they fflush).
- `zig build` refreshes the `~/.kira/toolchains/dev` snapshot `kira` runs from — only matters when working on Kira itself.
- KIR001 "not executable in current backend pipeline" = lowering gap; `kira check` names construct+span.
- Headless env may SIGKILL (137) GUI/graphics `kira run`; validate with `kira check` + `kira test` instead.

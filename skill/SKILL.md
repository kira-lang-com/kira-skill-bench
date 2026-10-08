---
name: working-with-kira
description: Write, check and run Kira code with the KLF-hosted `kira` compiler (klf-kira, installed by knvm). Use it whenever you create or edit `.kira` files, `package.kira` manifests or Kira libraries, so the code compiles on the current compiler and reads as idiomatic Kira, not C written in Kira syntax.
---

# Working with Kira

The compiler is `kira`, the Kira language defined in `.klfd` files (the klf-kira repository) and built by the Kira Language Framework. `knvm` installs it. What it accepts is listed in klf-kira's `languages/kira/docs/subset.md`. When the prose and the compiler disagree, the compiler is right: run `kira check`.

Done means `kira check` is clean, and the code follows the "Write good Kira" rules below. Code that compiles but swallows errors, compares magic numbers or hand-rolls loops is not done.

## Toolchain

- `kira check [<path>]` reports diagnostics and writes nothing. It is fast; run it after every edit. `<path>` is a package directory, its manifest or any file in it.
- `kira run <path> [-- args]` builds an executable and runs it. `kira build <path> -o out` builds. `-o`'s extension, or `--emit kir|klbc|bin|lib|shared|ridl|run`, chooses the output. `--target <triple>` cross-compiles, and `--release` builds a release.
- `kira build --emit ridl -o X.ridl <library>` writes a library's RIDL contract.
- `kira format [--check] <path>` formats in place, with a width of 100 and 4 spaces.
- `knvm install latest` installs a release. `knvm binstall` builds and installs a klf-kira checkout as the dev toolchain, and `knvm sinstall` installs `knvm` and the launchers. The `kira` launcher runs the installed toolchain, so rerun `knvm binstall` after changing the compiler.
- There is no `kira test`, `kira lint` or `--backend`. Tests build with `--test` (see below).
- Diagnostics are numeric: `error[3025]`. The thousands band is the family: 1xxx lexer, 2xxx parser, 3xxx semantics, 4xxx packages, 5xxx macros. 9001 is "outside the supported subset", or a missing declaration such as no `import Foundation`.

## Packages

A package is a directory with `package.kira` and `app/`. Every `.kira` file under `app/`, in any subdirectory, is one module. Files see each other without imports. Never import a sibling file.

```kira
Package Shop {
    let version = "0.1.0"
    let kind = PackageKind.App
}
```

The typed construct form is stricter, because an unknown member is error 4003 rather than silently skipped. Prefer it when a manifest has dependencies:

```kira
construct Shop extends Package {
    let version: String = "0.1.0"
    let kind: PackageKind = .App
    let dependencies: [Dependency] = [
        Dependency { name: "Geometry", path: "../geometry" }
    ]
}
```

- The members are `kind` (`.App` or `.Library`), `version`, `moduleRoot`, `dependencies` and `nativeLibraries`. `kira`, `defaults`, `packages` and `allowThinFfiShim` are accepted and ignored. Do not rely on `Defaults { executionMode: ... }`.
- Only `path` dependencies resolve.
- An app has exactly one `@Main function main()`, with no parameters. A library has none.
- `import Foundation` gives `String`, `Any`, `Result`, `Optional`, `Number`, files, maths and logging. Without it there is no `String` type and no string literal. Imports are per file: each file imports what it uses.
- `public` exports a top-level function, type, construct, trait or constant from a library. It never goes on a member.

## The language

- `let` is immutable and `var` is mutable. A type annotation is optional; an initializer is required. Function declarations look like this:
  ```kira
  function name(label: Type) -> Result { ... }
  ```
  - Leave out `-> Type` for a function that returns nothing.
  - A parameter is always `label: Type`.
- Types:
  - `Int` is 64-bit signed and `Float` is 64-bit.
  - The fixed widths are `I8 I16 I32 U8 U16 U32 U64 F32`.
  - The other built-in types are `Bool`, `Void` and `RawPtr`.
  - Foundation adds `String`, `Any`, `[T]` and `Number`. `Number` is an exact decimal with a 65-bit mantissa and bitwise operators on whole values.
  - Widths never mix silently. Convert with a call, such as `U32(x)` or `Int(b)`, and the conversion traps when the value does not fit. Arithmetic traps on overflow.
- Kira has no semicolons (error 1005). Statements, fields, cases and match arms are separated by newlines.
- Operators:
  - Arithmetic, bitwise, comparison and `? :` work as usual.
  - Compound assignment: `+= -= *= /=`.
  - `i++` works.
  - String `+` concatenates. Turn a value into text with `String(x)`.
  - There is no `"\(x)"` interpolation.
- `for i in 0..n` is half-open. `for item in items` binds each element, and there is no `enumerated()`. `while cond`, `while true`, `break` and `continue` all work, also inside a `match` arm.
- `struct` has value semantics, with fields and methods. A method takes `borrow self`, the default, or `borrow mut self`. Inside a method, a bare name is a field. A struct literal is written `Point { x: 1, y: 2 }`.
  - `class` has reference storage. Bind it with `var` to call a `borrow mut self` method.
- `enum` cases are separated by whitespace and carry at most one payload, `Case(Type)`. Generic enums and structs are allowed, such as `Optional<Value>` with `.Some(v)` and `.None`. The `T?` shorthand is not.
- `match` works on enums, integers and strings. It must be exhaustive, and `else ->` covers the rest. Arms name cases unqualified and bind a payload with `Case(x)`. A `match` is an expression: `return match x { ... }`.
- A leading dot, `.Case`, works where the type is known: an annotation, a parameter, a return, a field, or the other side of `==`.
- `trait Name { function f() -> T }`, then `struct S: Name { ... }`. A trait's bare name in a type position is its existential: `-> Greeter`.
- `construct Family { @Required ... }` declares a construct family. A value joins it with `Family Name { ... }`.
- `namespace Name { let member: T = value }` groups constants, read as `Name.member`. `public namespace` exports every member. A constant `let` is folded in place and costs nothing at run time.
- `distinct Metres = Int` makes a new type. Build it with `Metres(5)` and read it back with `.raw`.
- `type Name = Target` declares a nominal alias.
- Ownership is affine. A non-Copy value moves on use, so pass `move v` to an owned parameter.
  - Declare a read-only parameter as `borrow T`, and one the function writes as `borrow mut T`. The caller passes a `var` to `borrow mut`.
  - Pass an argument straight to a `borrow` parameter.
- `async function f(...)` runs as a task: `let h = Task { f(1, 2) }`, then `h.await`.
  - `Channel<T>()` returns the sender. Its other end is `.receiver`, and `try rx.receive()` takes one message.
- Lambdas are written `{ x in ... }`. They need a function type to come from somewhere: `let g: (Int) -> Int = { x in return x + 1 }`.
- `comptime function` runs at compile time.
  - A declarative macro is `macro name(x: expr) { expand { ... } }`.
  - `@Derive(Equatable)` generates `eq_Name`. It does not generate `==`.
  - `@Derive(Tagged)` numbers cases from zero in declaration order, so it is wrong for wire codes that must stay fixed.
- `klist!("Info.klist", "Key")` reads a `.klist` value. In a release it is inlined. In a debug build it is read at run time.
  - `ksl!("app/Shaders/X.ksl")` embeds a shader.
  - Both paths are relative to the package root.
- `@FFI.Extern { library: name, symbol: c_name, abi: c }` on a function with no body calls into C. The values in the block are bare words.
  - `@FFI.Syscall { name: write }` is a Linux system call.
  - `@FFI.Struct { layout: c }` lays a struct out as C does.
- Raw memory, only at a hardware or OS boundary: `heapLoad<T>(p, offset)`, `heapStore<T>(p, offset, v)`, `sizeOf<T>()`, or the `Heap` library's `MemoryView` and `ByteBlock`.

## Errors

A fallible function returns `Result<Value, Failure>`, where `Failure` is an enum that names what went wrong.

```kira
enum LoadFailure {
    Missing(String)
    Corrupt
}

function load(path: borrow String) -> Result<Config, LoadFailure> {
    if !fileExists(path) { return .Error(.Missing(copy path)) }
    ...
}
```

You have four ways to deal with a failure. Pick one at every call.

1. Pass it up with `try`, inside `attempt`/`handle` or with `otherwise return`:
   ```kira
   let config = try load(path) otherwise return .Error(.Corrupt)
   ```
2. Match it and act:
   ```kira
   match load(path) {
       Ok(config) -> apply(config)
       Error(failure) -> log warn("could not load the configuration", path, failure)
   }
   ```
3. Fall back on purpose: `let n = try parse(text) otherwise 0`. This records the fallback on the trail.
4. Let it go explicitly: `Error(failure) -> absorb failure`. Do this only when ignoring the failure is correct, and add a comment saying why.

An `Error(_)` arm, or an `else` arm standing in for `Error`, is error 3394. The compiler still accepts `let _ = f()` and a bare `f()` that drops a `Result`. Never write either: each one silently swallows a failure.

## Logging

Logging is a statement, not a function. Do not use `print` for diagnostics, and do not write per-program wrappers such as `myLog(...)`.

```kira
log info("opened the volume", path, size: Int(bytes))
log warn("could not open the volume", path, failure)
log fault("the table is corrupt", entries)
```

The levels are `fault`, `warn`, `info` (the default), `debug` and `trace`. `warn` and `fault` need a message. Each field is named by its label or its source text, and a literal needs a label. `KIRA_LOG=info` or `KIRA_LOG=Shop=trace,warn` chooses what prints. By default a program prints its warnings and faults. Use `print` only for a program's actual output.

## Write good Kira

Older Kira code, such as most of Tessera, shows the patterns below. Do not copy them. Write the form in the right-hand column.

| Do not write | Write |
| --- | --- |
| `let keyF12: U32 = U32(69)` and `if key == U32(69)` | An enum, `enum Key { F12 ... Other(U32) }`, matched with `match key { F12 -> ... }`. Raw codes exist only at the hardware or wire boundary, in one conversion function each way. |
| `U32`/`U64` for a kind, role, opcode, state or flag | An `enum`. Flags are a `distinct` with namespaced constants, or a struct of `Bool`s. |
| `U64` for a size, count, time or quantity | `Int`, or `Number` for exact quantities. Fixed widths only where a C or wire layout demands them. |
| Prefixed globals: `let duOpWatch = U32(5)`, `var dmClients` | `namespace DiskOperation { let watch: ... }`, or an enum. State lives in a struct passed as `borrow mut`, not in prefixed globals. |
| A constant behind a function: `function pageSize() -> Int { return 4096 }` | `namespace Memory { let pageSize: Int = 4096 }` |
| `if x == a { ... } else if x == b { ... }` over one value | `match x { a -> ... b -> ... else -> ... }`. Strings and integers match too. |
| `var i = 0` and `while i < n { ...; i = i + 1 }` | `for i in 0..n`, or `for item in items` |
| `var running = true` and `while running { ... }` | `while true { ... }` with `break` or `return` |
| `Error(failed) -> U64(0)`, `let _ = call()`, a dropped `Result` | Pass it up, match it, `otherwise`, or `absorb` with a reason (see Errors). |
| `Bool` returns that hide why something failed | `Result<Value, Failure>` with a failure enum |
| Magic numbers explained by a comment ("69 is F12") | A named enum case or a namespaced constant. The name is the explanation. |
| Hand-parsed `processArgument(i)` loops | The `ArgumentParser` library: `ParsableCommand`, `@Derive(Parsable)`, `runCommand(...)` |
| `print` for diagnostics, or a logging wrapper | `log info/warn/fault(...)` |
| Hand-written `sqrt`, `min`, `clamp`, string search | Foundation: `sqrt`, `pow`, `min`, `max`, `clamp`, `abs`, `.split`, `.startsWith`, `.contains`, `.indexOf`, `.substring`, `.trim` |
| `@Native` on every function | Nothing. `@Native` has no meaning on an ordinary Kira function. Use annotations only where they do something: `@Main`, `@FFI.*`, `@Derive`, `@AtExit`, `@MainThread`. |
| One function doing everything, or files past 700 lines | Small functions named for what they answer. Split files by topic before they reach 700 lines. |
| `Result<U64, ...>` carrying a status code | `Result` of the value the call produces. `.Ok` always carries a payload, and there is no `Void` payload. |

Also:

- Name things for what they are, in full words: `volumes`, `openVolume(at:)`, not `vlTbl` or `doIt2`.
- Comments explain why, in plain sentences. Do not restate the code.
- Leave nothing half-typed. When you touch a function that uses a stand-in integer, give it the real type and update its callers.

## Tests

A test package declares the `Test` family and a `TestRunner` collector. Copy them from klf-kira's `languages/kira/tests/app/`. A case looks like this:

```kira
construct SumsRange() extends Test {
    test {
        var s = 0
        for i in 0..5 { s += i }
        return s
    }
    expect { let e: Result<Any, TestFailure> = .Ok(10) return e }
}
```

`kira check --test <package>` checks the package and `kira build --test` builds it. A build with no tests is error 3371.

## When something fails

- Read the code and the message. `docs/diagnostics.md` in klf-kira lists every code.
- 9001: either the construct is outside the subset (`T?`, `import A.B`, an annotation with arguments), or a declaration is missing. Usually the missing declaration is `import Foundation`.
- 3061 is an undefined function. Check Foundation for the real name before you invent one, for example with `grep -rn "function name" ~/.klf/toolchains/kira/dev/*/`.
- 3394: the `Error` arm must bind its failure and use it.
- 3021 or 3025: you mutated a `let`. Use `var`, or pass the value as `borrow mut`.

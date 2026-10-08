---
name: working-with-kira
description: Write, check and run Kira code with the KLF-hosted `kira` compiler (klf-kira, installed by knvm). Use it whenever you create or edit `.kira` files, `package.kira` manifests or Kira libraries, so the code compiles on the current compiler and reads as idiomatic Kira, not C written in Kira syntax.
---

# Working with Kira

The compiler is `kira`, the Kira language defined in `.klfd` files (the klf-kira repository) and built by the Kira Language Framework. `knvm` installs it. What it accepts is listed in klf-kira's `languages/kira/docs/subset.md`. When the prose and the compiler disagree, the compiler is right: run `kira check`.

Done means `kira check` is clean, and the code follows every one of the "Rules for models" below. Code that compiles but swallows errors, compares magic numbers or hand-rolls loops is not done.

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

The manifest is a construct extending `Package`. It has no parentheses, and every member has a written type:

```kira
construct Shop extends Package {
    let version: String = "0.1.0"
    let kind: PackageKind = .App
    let dependencies: [Dependency] = [
        Dependency { name: "Geometry", path: "../geometry" }
    ]
}
```

Always write this form. The older `Package Shop { let version = "0.1.0" }` spelling still compiles, but it silently skips a misspelled member (`dependancies` reads as no dependencies). The construct form reports it as error 4003.

- The members are `kind` (`.App` or `.Library`), `version`, `moduleRoot`, `dependencies` and `nativeLibraries`. `kira`, `defaults`, `packages` and `allowThinFfiShim` are accepted and ignored. Do not rely on `Defaults { executionMode: ... }`.
- Only `path` dependencies resolve.
- An app has exactly one `@Main function main()`, with no parameters. A library has none.
- `import Foundation` gives `String`, `Any`, `Result`, `Optional`, `Number`, files, maths and logging. Without it there is no `String` type and no string literal. Imports are per file: each file imports what it uses.
- `public` exports a top-level function, struct, class, enum, distinct, type alias, construct, trait, `let` or `namespace` from a library. The keyword is `public`; `pub` is a parse error (2002). `public` never goes on a member or inside a namespace (2092 and 2002). Export only what other packages call.

## The language

- `let` is immutable and `var` is mutable. A type annotation is optional; an initializer is required. Function declarations look like this:
  ```kira
  function name(label: Type) -> Result { ... }
  ```
  - Leave out `-> Type` for a function that returns nothing. Such a function needs no trailing `return`; write `return` only to leave early.
  - The keyword is `function`, never `fn`, `func`, `fun` or `def`.
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

## Rules for models

Older Kira code, most of all Tessera, is full of patterns that compile and are still wrong. Every rule below is a pattern found there. None of them is allowed in code you write, and when you edit a function that has one, fix it there.

Before you return any Kira, go through this list. A single hit means the code is not done.

### Types, not integers

1. **No integer stand-ins.** Never use `U32`, `U64` or `Int` for a kind, role, opcode, key, state, mode, reason, command or result code. Declare an `enum` and `match` on it.
   - Wrong:
     ```kira
     if message.a == U32(69) { ... }   // 69 is F12
     ```
   - Right:
     ```kira
     match key { F12 -> ... else -> ... }
     ```
2. **An open set is an enum with a catch-all case.** Keys, device classes and protocol versions get one case per known value, plus `Other(U32)` for anything unknown. A raw code exists only where it is read off hardware or a wire. Write one conversion function each way, and keep both at that boundary.
3. **No magic numbers.** A literal that needs a comment to say what it is ("usage 104", "opcode 5", "0x80 is the direction bit") must be an enum case or a namespaced constant. The name replaces the comment.
4. **No sentinel values.** `U32(0)` for "no surface", `0xFFFFFFFF` for "not found", or `""` for "missing" are all forbidden. Use `Optional<T>` (`.Some(v)` or `.None`), or an enum case that names the absence.
5. **No `ok: Bool` fields.** A struct like `{ ok: Bool, value: ... }` or `{ ok: Bool, problem: String, ... }` is a `Result<Value, Failure>`.
6. **No generic payload fields.** Message structs with `a: U32, b: U32, c: U32, d: U32` are forbidden. Each message is an enum case carrying a struct with named, typed fields: `.GrabFired(GrabEvent { key: Key, state: KeyState })`. Decode the wire once into that enum.
7. **No `Bool` encoded as an integer.** Neither `value != U32(0)` meaning true, nor `U32(1)` meaning pressed. Decode to `Bool`, or to an enum such as `KeyState { Released Pressed Repeated }`, at the boundary.
8. **No `Bool` parameters that pick a behaviour.** `track(surface, true)` hides what `true` means. Use an enum (`.Desktop` or `.Application`), or two functions.
9. **Flags are typed.** Write a `distinct Flags = U32` with its values in `namespace Flags`, and give it named tests such as `has(...)`. Never use bare `(x & U32(0x80)) != U32(0)` in logic. Never OR `.raw` values together outside the flag type's own functions.
10. **Quantities are `Int` or `Number`.** Sizes, counts, lengths, offsets, durations, dates and money are never `U64` because a syscall used one. Dates are `Int` fields of a struct, or Foundation types, not `var year: U64`. Exact quantities, and anything crossing a library surface, are `Number`. Convert to a fixed width only in the call that crosses into C, the kernel or a wire.
11. **IDs are `distinct`.** `distinct SurfaceId = U32` stops a surface from being passed as a window, and `.raw` appears only at the wire.

### Errors

12. **Never swallow a failure.**
    - These are forbidden:
      - `let _ = f()` on a `Result`;
      - a bare call that drops a `Result`;
      - `Error(failed) -> U64(0)`, `Error(failed) -> ""`, `Error(failed) -> false` or any other default;
      - `absorb` without a comment that says why ignoring is correct.
    - At each call, either pass the failure up (`try`), handle it (a `match` that acts or logs with the failure), or fall back on purpose (`try f() otherwise value`).
13. **Fallible functions return `Result`, not `Bool`.** `send(...) -> Bool`, `install(...) -> Bool` and `writeAll(...) -> Bool` lose why they failed. Return `Result<Value, Failure>`, with a failure enum whose cases name each reason.
14. **No status codes in `Ok`.** `Result<U64, E>`, where the `U64` is a code the caller must also check, is forbidden. The `Error` side carries every failure.
15. **Failure enums are specific.** Use `enum InstallFailure { NotSigned DiskFull(Int) Exists(String) }`, not a single `Failed(String)`, and never a number.

### Structure

16. **No prefixed names.**
    - `dkSurfaces`, `bsClients`, `ltShaUpdate`, `uiLetterFor`, `let duOpWatch: U32 = U32(5)`: a two- or three-letter program prefix on a name is forbidden.
    - The package is already the namespace. Constants go in `namespace DiskOperation { let watch: ... }`. Operations become methods on the type they act on, through `extend Surface { ... }`.
17. **No global mutable state.** `var dkSurfaces: [DkSurface] = []` at top level, reached by index from everywhere, is forbidden. Put the state in a struct, such as `struct Registry { var surfaces: [Surface] }`, owned by `main` and passed as `borrow mut`.
18. **No constants behind functions.** `function pageSize() -> Int { return 4096 }` and zero-argument `@Native` constant functions are forbidden.
    - A fixed value is a namespaced `let`.
    - Settings and versions use `klist!`.
    - A value worked out at run time is a function named for what it computes.
19. **Constants live with their owner.** A system path such as `"/Applications"` or `"/Volumes/"`, a protocol size or an opcode table is declared once, in the library that owns it, and read from there. Never copy a literal path or number into a second file or package.
20. **No copied helpers.** A helper that two packages need goes in the shared library, not into each package. Examples: reading a C string, page rounding, decimal text, argument decoding.
21. **No `@Native` on ordinary functions.** It does nothing on a Kira function. The only annotations you may write are ones that do something: `@Main`, `@AtExit`, `@FFI.*`, `@Derive(...)`, `@Required`, `@MainThread`, `@Service` (Foundation only).
22. **Raw memory only at the boundary.** Hand-computed offsets are forbidden in program logic. Examples: `heapLoad<U32>(block, Int(at + U64(12)))`, or field-by-field stores into a byte block.
    - Declare the layout once as an `@FFI.Struct { layout: c }` and load or store it whole with `heapLoad<T>`/`heapStore<T>`.
    - Alternatively, use the `Heap` library's `MemoryView`.
    - Everything above that layer works with Kira structs.
23. **Small functions, few parameters.** A function over about 60 lines is several functions. A function with six or more parameters takes a struct. Files stay under 700 lines and split by topic.
24. **No trailing `return`** at the end of a function that returns nothing.

### Control flow

25. **`match`, not `if` chains.** Two or more `if x == ... else if x == ...` tests on one value are a `match`. Integers and strings match too. Use `return match x { ... }` when each arm yields a value.
26. **`for`, not counters.**
    - Wrong: `var i = 0`, then `while i < n { ...; i = i + 1 }`.
    - Right: `for i in 0..n`.
    - Iterate elements with `for item in items`, not `for i in 0..items.count { items[i] }`. Index only when you need the index to write back.
27. **No flag loops.** Do not write `var running = true` with `while running { ... }`. Write `while true { ... }` and leave with `break` or `return`.
28. **Use the expected type.** Write `.Case`, not `Enum.Case`, where the type is known.

### Output and input

29. **`log`, never `print`, for diagnostics.** Also never write a per-program logging wrapper (`dvLog`, `pwLog`). Pass values to `log` as fields, without converting them first: `log info("grabbed a key", key)`, not `key: Int(key)`. `print` is only for a command's real output to its user.
30. **Command lines use `ArgumentParser`.** Hand-reading `processArgument(i)`, `envArgument(i)` or argument counts is forbidden. Declare a `ParsableCommand` and run it with `runCommand(...)`.
31. **Use Foundation.** Before writing a helper, check whether Foundation already has it:
    - maths: `sqrt`, `pow`, `min`, `max`, `clamp`, `abs`, `floor`;
    - text: `.split`, `.trim`, `.startsWith`, `.endsWith`, `.contains`, `.indexOf`, `.substring`, `String(x)`;
    - files: `readFile`, `writeFile`, `listDirectory`, `pathExists`;
    - C strings: `stringFromCBytes`.

### Naming and comments

32. **Full-word names for what a thing is.** Write `openVolume`, `surfaces` and `KeyState`. Never write `vlTbl`, `tmp2`, `doIt` or `handleThing`.
33. **Comments say why.** A comment that restates the code, or explains a magic number that should have been a name, is removed. The fix is the name.

### Final check

Before you hand back code:

- `kira check` is clean.
- `grep` your change for `let _ =`, `U32(`, `U64(`, `@Native`, `print(`, `while ` and `== U`.
- Every hit is either at the C or wire boundary, or gets fixed.

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

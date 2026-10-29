---
name: working-with-kira
description: Write, check and run Kira code with the KLF-hosted `kira` compiler (klf-kira, installed by knvm). Use it whenever you create or edit `.kira` files, `package.kira` manifests or Kira libraries. It holds the language as the compiler accepts it, the builtins, Number as the default numeric type, and the strict rules every piece of Kira you write must follow.
---

# Working with Kira

The compiler is `kira`, the Kira language defined in `.klfd` files (the klf-kira repository), built by the Kira Language Framework and installed by `knvm`. klf-kira's `languages/kira/docs/subset.md` lists what it accepts. Where this skill, the docs and the compiler disagree, the compiler is right.

**The rules in this skill are mandatory.**
- Code that breaks one is wrong, even when `kira check` is clean.
- No rule has an exception unless the rule itself states it.
- "The surrounding code does it" is never a reason: much existing Kira, Tessera above all, is written in exactly the patterns forbidden here.
- When you touch code that breaks a rule, fix it.

## Toolchain

- `kira check <path>` reports diagnostics and writes nothing. Run it after every edit.
  - `<path>` is a package directory, its `package.kira`, or any file in it. Use `kira check .` inside a package.
  - The path is required.
- `kira run [<path>] [-- args]` builds an executable and runs it.
- `kira test [<path>]` builds the package's tests and runs them. It prints `ok   <Name>` or `FAIL <Name>` for each case, then a summary line: `1 passed, 0 failed, 0 skipped, 1 total`. It exits 1 when any case fails. `kira help` does not list `test`, but it exists.
- With `run` and `test`, a path left out means the package in the current directory.
- `kira build <path> -o out` builds.
  - `-o`'s extension, or `--emit kir|klbc|bin|lib|shared|ridl|run`, chooses the output.
  - `--target <triple>` cross-compiles.
  - `--release` makes a release build.
  - `--test` makes a test build.
- `kira build --emit ridl -o X.ridl <library>` writes a library's RIDL contract. It holds the library's `public` functions and constants.
- `kira format <path>` formats in place, at width 100 with 4 spaces.
  - `kira format --check <path>` lists the files that are not formatted, and exits 1 if there are any.
- `knvm install latest` installs a release.
  - `knvm binstall` builds the klf-kira checkout you are in and installs it as the dev toolchain.
  - `knvm sinstall` installs `knvm` and the launchers onto PATH.
  - The `kira` launcher runs the installed toolchain. After changing the compiler, rerun `knvm binstall`.
- `kira lint` and `--backend` do not exist.
- Diagnostics are numeric, such as `error[3025]`. The thousands band is the phase: 1xxx lexer, 2xxx parser, 3xxx semantics, 4xxx packages, 5xxx macros.
  - 9001 means "outside the supported subset", or a missing declaration, most often no `import Foundation`.
  - klf-kira's `languages/kira/docs/diagnostics.md` lists every code.
- The installed standard library is at `~/.klf/toolchains/kira/dev/<version>/std/`. Read it before you call or invent a Foundation function.

## Packages

A package is a directory holding `package.kira` and `app/`. Every `.kira` file under `app/`, in any subdirectory, is part of one module: the files see each other's declarations. Never import a sibling file.

The manifest is a construct extending `Package`, with no parentheses and with every member's type written:

```kira
construct Shop extends Package {
    let version: String = "0.1.0"
    let kind: PackageKind = .App
    let dependencies: [Dependency] = [
        Dependency { name: "Geometry", path: "../geometry" }
    ]
}
```

- **Always write the construct form.** The old `Package Shop { let version = "0.1.0" }` form compiles, but it silently ignores a misspelled member. The construct form reports one as error 4003.
- **Members:**
  - `kind` is `.App` (the default) or `.Library`.
  - `version`, `moduleRoot` (the construct's name by default), `dependencies` and `nativeLibraries`.
  - `kira`, `defaults`, `packages` and `allowThinFfiShim` are accepted and ignored. Do not write `defaults`.
- **Dependencies:** only `path` dependencies resolve.
  - `import Foundation` needs no row.
  - Other bundled libraries need a path dependency. `Heap`, for example, is at `~/.klf/toolchains/kira/dev/<version>/std/heap`.
- **Entry point:** an app has exactly one `@Main function main()`, with no parameters. A library has none.
- **Imports:**
  - `import Foundation` provides `String`, `Any`, `Result`, `Optional`, `Number`, files, maths and text. Without it there is no `String` type, so no string literal compiles.
  - Imports are per file: each file imports what it uses.
  - `import Name as Alias` renames a library in that file.
- **`public`** exports a top-level function, struct, class, enum, distinct, type alias, construct, trait, `let` or `namespace` from a library.
  - The keyword is `public`. `pub` is error 2002.
  - `public` on a struct member is error 2009, and inside a namespace it is error 2002. Use `public namespace` instead.
  - Export only what other packages call.

## Numbers: `Number` first

**`Number` is Kira's default and recommended numeric type.**
- It is Foundation's exact decimal: a signed 65-bit mantissa, so every `Int` and every `U64` fits, with up to eighteen fractional digits. `0.1 + 0.2 == 0.3` holds.
- Use `Number` for every numeric value in program logic and in library surfaces: amounts, measures, prices, sizes, durations, rates, coordinates and counters you keep.

```kira
struct Price {
    let amount: Number
}

function total(prices: borrow [Price]) -> Number {
    var sum: Number = 0
    for price in prices { sum += price.amount }
    return sum
}
```

- **Literals are `Number`.** With Foundation imported, `let n = 3` and `let rate = 0.25` are `Number`s; `n / 2` is `1.5`.
- **Counts are `Number`.** `items.count`, `text.count`, a `for` counter over Number bounds (`for i in 0..items.count`), the index of `enumerated()`, `charAt` and `indexOf` are all `Number`s: `items.count / 2` is `1.5` for three items. A value is an `Int` only where you declare one, and a loop with an `Int` bound counts in `Int`.
- **`UNumber`** is the same type, written where a value is never negative (a size, a count, a time). It says so at the declaration.
- **Operators:**
  - `+ - * / %`, comparisons, `+=`, `-=`, `++` and unary `-` all work.
  - `& | ^ ~ << >>` work on whole values and trap on a fraction.
  - Division by zero traps. `Number(1) / Number(3)` is `0.333333333333333333`.
- **Conversions:**
  - `Number(x)` takes any integer width, a `Float` or a `String`.
  - `Int(n)`, `U32(n)` and the other widths truncate toward zero, and trap outside their range.
  - `String(n)` is the decimal text, and `Float(n)` the nearest float.
  - A hexadecimal literal where a `Number` is expected names a `U64`'s bits: `0xffffffffffffffff` is `18446744073709551615`.
- **Mixing:**
  - An `Int` and a `Number` mix in one expression; the `Int` widens.
  - A `Number` passed to a fixed-width parameter or field (`U32`, `U64`, `Int`...) narrows there, range-checked, without a call. A fixed-width value read into a `Number` widens the same way.
  - A `for` bound and an array index may be a whole `Number`.
  - `match` takes a `Number`: `match price { 0..10 -> ... 19.99 -> ... else -> ... }`.
- **Where a fixed width belongs, and only there:** a C layout, a syscall, a wire format or a hardware register. That code lives in the library that owns the boundary, which converts inside itself.
- **Library surfaces take `Number`.** A public function or struct field holding a count, size, time, offset or code is `Number` or `UNumber`, never `U32` or `U64`. Callers never write a fixed width.
- **Foundation functions:** `sqrt`, `min`, `max` and `abs` take `Number`.
- **Logging:** `log` writes a `Number` field as decimal text: `log info("charged", amount)`.
- **Libraries:** `Number` crosses RIDL as `struct Number`, so it is the type of every numeric parameter, result and field of a library.

`Float` and `F32` are for APIs that demand them, such as graphics. Fixed-width integers belong inside the one layer that talks to C, the kernel, hardware or a wire. Never pick `Int`, `Float` or `U64` "because it is simpler".

## The language

- **Bindings and functions:**
  - `let` is immutable and `var` is mutable. A type annotation is optional; an initializer is required.
  - A function is declared `function name(label: Type) -> Result { ... }`.
  - The keyword is `function`, never `fn`, `func`, `fun` or `def`.
  - A parameter is always `label: Type`.
  - A function that returns nothing leaves out `-> Type` and has no trailing `return`. Write `return` only to leave early.
- **Types:**
  - `Number`, `Int` (64-bit signed), `Float` (64-bit), `Bool`, `Void` and `RawPtr`.
  - Fixed widths are `I8 I16 I32 U8 U16 U32 U64 F32`. There is no `I64`: use `Int`.
  - Foundation adds `String`, `Any`, `[Any]`, `Optional<Any>` and `Result<Any, Failure>`.
  - Widths never mix: convert with a call, which traps when the value does not fit. Integer arithmetic traps on overflow.
- **Separators:**
  - Kira has no semicolons (error 1005). Statements, fields, enum cases and match arms are separated by newlines.
  - Struct literal fields, arguments and array elements are separated by commas.
- **Operators:**
  - Arithmetic, bitwise, comparison, `&& || !` and `cond ? a : b`.
  - `+= -= *= /=` and `i++`.
  - `+` concatenates strings. `String(x)` turns a `Number`, an integer, a `Float` or a `Bool` into text.
  - Interpolation, `"\(name) has \(count) items"`, writes a `String` as itself and any other value as a trail shows it. Prefer it to chains of `+` and `String(...)`.
- **Loops:**
  - `for i in 0..n` runs over a half-open `Int` range.
  - `for item in items` binds each element. `for (index, item) in items.enumerated()` binds both.
  - `while cond` and `while true` work.
  - `break` and `continue` work, including inside a `match` arm.
- **Structs and classes:**
  - `struct` is a value type with `let` and `var` fields and methods. A field may have a default, `= value`.
  - A struct literal is written `Point { x: 1, y: 2 }`.
  - A method's receiver is `borrow self` (the default when left out) or `borrow mut self`. Inside a method, a bare name reads a field or calls a sibling method.
  - `extend Type { ... }` adds methods, also from another file.
  - A method cannot declare its own type parameters (error 2047). A method of a generic struct uses the struct's.
  - `class` has reference storage. Bind it with `var` to call a `borrow mut self` method.
- **Enums:**
  - Cases are separated by whitespace, and each carries at most one payload, `Case(Type)`. Named fields go in a struct payload: `CheckIn(CheckIn)` with `struct CheckIn { let name: String }`.
  - `Optional<Value>` with `.Some(v)` and `.None`; `Value?` is its shorthand. `Result<Value, Failure>` with `.Ok(v)` and `.Error(f)`; `Result<Void, Failure>` succeeds with a bare `.Ok`.
  - Stable codes are raw values: `enum Key: U32 { Escape = 41  F12 = 69 }`. `code(key)` and `fromCode<Key>(raw)` convert at the boundary.
  - `@Open` on such an enum keeps an unknown code: `fromCode` answers a value no case names, `code` gives the code back, and a `match` needs `else ->`.
- **`Any`, not `T`.** Kira writes `Any` where another language declares a type parameter `T`: `function first(values: [Any]) -> Any?`, `struct Slot { let held: Any }`. Do not declare type parameters for your own code; test and unwrap with `is` and `as`.
- **`match`:**
  - It takes an enum, an integer, a `Bool` or a `String`, and must be exhaustive.
  - Arms name cases unqualified, as `Case(binding) -> ...`. `else ->` covers the rest (but see rule 27).
  - `match` is an expression: `return match x { ... }`.
- **Leading dot:** `.Case` resolves where the expected type is known. That means an annotation, a parameter, a return, a struct field, an array element, the other side of `==`, or an outer payload. With no expected type, it is error 3119.
- **Traits:** `trait Name { function f() -> Type }`, then `struct S: Name { ... }`. A trait's bare name in a type position is its existential: `-> Greeter`.
- **Construct families:**
  - `construct Family { @Required function f() -> Type }` declares a family.
  - `Family Member { ... }` declares a member, and `Member()` builds its value.
  - `Any Family` is the family's existential.
- **Namespaces:** `namespace Name { let member: Type = value }` holds constants, read as `Name.member`.
  - `public namespace` exports every member.
  - A constant `let` is folded in place, with no load and no initializer.
- **Distinct types and aliases:**
  - `distinct Metres = Int` is built with `Metres(5)` and read with `.raw`.
  - `type Name = Target` is a nominal alias.
- **Ownership** is affine: a non-Copy value moves on use.
  - Pass `move value` to an owned parameter.
  - A parameter that only reads is `borrow Type`. One that writes is `borrow mut Type`, and the caller passes a `var`.
  - `copy value` makes an explicit copy.
- **Lambdas:** `{ x in ... }`, typed by a function type: `let g: (Int) -> Int = { x in return x + 1 }`. A lambda captures `let`s by value and `var`s by a shared cell.
- **Tasks:** `async function f(...)` is a task entry. Start it with `let h = Task { f(1, 2) }` and join it with `h.await`.
- **Channels:** `Channel<Type>()` returns the sender, and `.receiver` is the other end.
  - `tx.send(v)` sends and `tx.close()` closes.
  - Receive with `let v = try rx.receive()` inside `attempt`, and handle `Closed`.
- **Main thread:** an `@MainThread function` is reached only through:
  - `MainThread.invoke { f() }`, which waits for the value;
  - `MainThread.spawn { f() }`, which returns a handle to `.await`;
  - `MainThread.post { f() }`.
- **Program end:** `@AtExit function finished(reason: Int, detail: Int)` runs when the program ends.
- **Compile time:**
  - A `comptime function` with constant arguments runs while compiling.
  - A declarative macro is `macro twice(value: expr) { expand { value + value } }`, invoked as `twice!(4)`.
  - A procedural macro is `comptime macro Name { kind { ... } expand(...) -> Syntax { ... } }`.
- **Derives:**
  - `@Derive(Equatable)` generates the free function `eq_Name(a, b)`. It does not generate `==`.
  - `@Derive(Tagged)` numbers cases from zero in declaration order (`code_Name`, `Name_fromCode`). Never use it for wire codes that must keep their values.
- **Embedded files:** both paths are relative to the package root.
  - `klist!("Info.klist", "Key")` reads a `.klist` value: a number as `Number`, a string as `String`, a `Bool`, `[U8]` data or `[String]`.
  - `ksl!("app/Shaders/X.ksl")` embeds a shader.
- **Foreign functions:**
  - `@FFI.Extern { library: name, symbol: c_name, abi: c }` goes on a function with no body.
    - `library:` must name a `NativeLibrary` in `nativeLibraries` (error 3372).
    - The values are bare words.
  - `@FFI.Syscall { name: getpid }` declares a Linux system call.
  - `@FFI.Struct { layout: c }` lays a struct out as C does.

## Builtins

These need no import and no declaration. A function, method or binding named `code`, `compare`, `hash`, `print` or `traceText` is error 2099.

| Builtin | What it does |
| --- | --- |
| `print(v)` | Writes any value and a newline; aggregates as a trail shows them. Only for a program's real output. |
| `log`, `log fault/warn/info/debug/trace(...)` | Records an event (see Logging). |
| `traceText(v)` | Any value as readable text: `Point { x: 1, y: 2 }`, `Tone.Label("x")`. |
| `code(e)`, `fromCode<E>(n)` | An enum case's index, and back. `fromCode` takes payload-less enums only. |
| `compare(a, b)` | `Ordering`: `.Less`, `.Equal` or `.Greater`. |
| `hash(v)` | A hash that agrees with `==`. |
| `Type(x)` conversions | `Number(x)`, `Int(x)`, `U8(x)`..., `Float(x)`, `String(x)`, and `Metres(x)` for a distinct type. Narrowing traps when the value does not fit. |
| `v is Type`, `v as Type` | Tests and unwraps an `Any`. |
| `wrappingAdd`, `wrappingSub`, `wrappingMul` | Arithmetic that wraps at the operands' width instead of trapping. Only for hashes, checksums and sequence numbers. |
| `floatToBits(f)`, `bitsToFloat(u)` | A `Float`'s IEEE bits as a `U64`, and back. |
| `runtimeTrap()` | Stops the program with a trap. |
| `Build.debug()`, `Build.release()` | The build mode, as constants, anywhere. |
| `Build.platform()`, `Build.target()`, `Build.testing()`, `Build.linting()` | Only inside a `comptime function` or a macro. Elsewhere they are error 3060. |
| `Task { f(...) }`, `.await`, `.requestCancel()`, `.detach()`, `Channel<Type>()`, `MainThread.invoke/spawn/post` | Concurrency (see above). |
| `klist!`, `ksl!` | Embedded files (see above). |
| `nativeState(v)`, `nativeUserData(s)`, `nativeStateValue(token) as Type` | Hand a Kira value to C as an opaque word, and get it back. |
| `sizeOf<Type>()`, `alignOf<Type>()` | The C size and alignment of a C-shaped type. |
| `heapAllocateRaw(bytes, align)`, `heapFreeRaw(p)`, `heapLoad<Type>(p[, offset])`, `heapStore<Type>(p, [offset,] v)`, `heapOffset(p, n)`, `heapCopyBytes`, `heapMoveBytes`, `heapFillBytes`, `heapReadByte`, `heapWriteByte`, `heapReadInt`, `heapWriteInt`, `rawPointerWord(p)` | Raw memory, only in the one layer that talks to C, the kernel or hardware (rule 22). `heapAllocateRaw` does not zero. Typed loads take only C-shaped types (error 3397). |

Foundation (`import Foundation`) provides:
- maths: `sqrt`, `pow`, `min`, `max`, `clamp`, `abs`, `floor`, `ceil`, `round`, `sin`, `cos` and the rest;
- text: `.count`, `.trim()`, `.split(",")`, `.startsWith`, `.endsWith`, `.contains`, `.indexOf`, `.substring(from, to)`;
- arrays: `.append`, `.count`, `.contains`, `xs[i]`;
- files: `fileExists`, `pathExists`, `isDirectory`, `readFile(path).text`, `writeFile(path, text)`, `listDirectory(path).names`, `makeDirectory`, `removePath`, `renamePath`;
- C strings: `stringFromCBytes(pointer, limit)`;
- time: `unixMillis()`.

Several Foundation file functions answer a `Bool` or an `ok` field. Check it at every call and turn it into your own `Result` (rule 13).

## Errors

A fallible function returns `Result<Value, Failure>`. `Failure` is an enum with one case per reason the call can fail.

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

At every call that returns a `Result`, do exactly one of these:

1. **Pass it up** with `try`.
   - Use `let config = try load(path) otherwise return .Error(.Corrupt)`.
   - Or, inside `attempt`, write `let v = try f()` with a `handle { Case { ... } }` block.
2. **Handle it:**
   ```kira
   match load(path) {
       Ok(config) -> apply(config)
       Error(failure) -> log warn("could not load the configuration", path, failure)
   }
   ```
3. **Fall back deliberately:** `let n = try parse(text) otherwise 0`. The fallback is recorded on the trail.
4. **Let it go:** `Error(failure) -> absorb failure`, with a comment on the line above saying why ignoring it is correct.

An `Error(_)` arm, or an `else` arm standing for `Error`, is error 3394. The compiler still accepts `let _ = f()` and a bare `f()` that drops a `Result`. Both are forbidden.

## Logging

`log` is a statement. Diagnostics never go through `print` or through a wrapper of your own.

```kira
log info("opened the volume", path, size)
log warn("could not open the volume", path, failure)
log fault("the table is corrupt", entries)
```

- **Levels:** `fault`, `warn`, `info` (the default), `debug` and `trace`.
- **Message:** `fault` and `warn` start with a string literal message (error 2095).
- **Fields** are named by their label or their source text. A literal needs a label (error 2096): `log("sent", bytes: 4)`.
  - Pass values as they are, `Number`s included, without converting them for the log.
- **Output:** `KIRA_LOG` chooses what prints: `off`, `warn`, `info`, `trace`, or per module, as in `Shop=trace`. Unset, a program prints `info` and above.

## Rules

Every rule forbids a pattern found in existing Kira code. Each one applies to every line you write. When you edit a function, fix every violation in it.

### Types

1. **No integer stand-ins.** A kind, role, opcode, key, button, state, mode, reason, command, message type or result code is never an `Int`, `U32` or `U64`. Declare an `enum`.
   - Wrong: `if message.a == U32(69) { ... }   // 69 is F12`
   - Right: `match key { F12 -> ... }`
2. **An open set is an `@Open` enum.**
   - Keyboard keys, device classes, protocol versions and anything else that can grow are `@Open enum Key: U32 { Escape = 41  F12 = 69 ... }`: one case per known code, and an unknown code survives `fromCode` and `code` unchanged.
   - A raw code is converted to the enum once, where it is read, and back once, where it is written. Both conversion functions sit at that boundary.
3. **No magic numbers.** Every literal other than 0, 1 or a value obvious in place (`count * 2`) is an enum case or a namespaced constant. A literal that needs a comment to say what it is ("usage 104", "opcode 5", "50 ms") needs a name, and the name replaces the comment.
   - A value that follows from others is computed from them, never written out: a program slot of `256 - 24` bytes is `messageBytes - programOffset`, not `232`.
   - A real limit is named once, in the package that owns it, with a comment saying where it comes from.
4. **No sentinels.** None of these: `U32(0)` meaning "no surface", `.raw != U64(0)` meaning "has a handle", `-1` or `0xFFFFFFFF` meaning "not found", or `""` meaning "missing". Use `Value?` (`.Some(v)`, `.None`), or an enum case that names the absence.
5. **No `ok: Bool` structs.** `{ ok: Bool, value: ... }` and `{ ok: Bool, problem: String, ... }` are a `Result<Value, Failure>`.
6. **Messages are enums.** A message struct with fields `a`, `b`, `c`, `d`, or a protocol of opcodes, offsets and slot sizes, is forbidden.
   - A protocol is one enum with one case per message. Each case carries a struct with named, typed fields: `.GrabFired(GrabEvent { key: Key, state: KeyState })`, `.CheckIn(CheckIn { name: String })`. The case is the opcode.
   - The library that owns the protocol encodes and decodes it, once. Every other package sends and matches the enum and never sees bytes.
   - Strings and arrays travel with their length. A fixed-size block with fixed-size text slots (a 96-byte name, a 232-byte program) is forbidden.
   - A layout written out in a second package, or in a comment, is forbidden. The encoder is the only description of the bytes.
7. **No integers as booleans or states.** `x != U32(0)` meaning true and `U32(1)` meaning pressed are forbidden. Decode into a `Bool`, or into an enum such as `KeyState { Released Pressed Repeated }`.
8. **No `Bool` that selects behaviour.** A parameter like `track(surface, true)`, or a ternary like `desktop ? "Desktop" : "Application"`, is forbidden. Use an enum (`.Desktop`, `.Application`) and `match` on it, or write two functions.
9. **Flags are typed.**
   - Write `distinct Rights = U32` with its values in `namespace Rights { ... }`, and named operations such as `has`, `union` and `without`.
   - Raw bit tests in logic, such as `(x & U32(0x80)) != U32(0)`, are forbidden.
   - ORing `.raw` values happens only inside the flag type's own functions.
10. **Numbers are `Number`.** Every quantity follows "Numbers: `Number` first", and `UNumber` when it is never negative. Never use `U64` for a size, time, date, count or offset because some syscall used one. A library's public functions and fields take `Number` and convert to fixed widths inside the library. A date is a struct of `Number` fields, never `var year: U64`.
11. **IDs are `distinct`.** `distinct SurfaceId = U32` keeps a surface ID from being passed where a window ID belongs. `.raw` appears only at the wire.
12. **Strings are not types.** Dispatch on a string compared in several places, such as `if name == "Notes"` or `parsed.command == "activity"`, is forbidden. Turn the string into an enum once, where it arrives, with one `match`, and use the enum everywhere else.

### Errors

13. **Fallible means `Result`.**
    - A function that can fail returns `Result<Value, Failure>`. A `-> Bool` from `send`, `install`, `writeAll` or `open` throws away the reason, and is forbidden.
    - Where Foundation answers a `Bool` or an `ok` field, check it at once and convert it into your failure enum.
14. **Never swallow a failure.** All of these are forbidden:
    - `let _ = f()` on a `Result` or on a `Bool` success flag;
    - a bare call that drops one;
    - `Error(failed) -> U64(0)`, `-> ""`, `-> false`, `-> []`, or any other made-up value;
    - `absorb` without a comment that says why ignoring is correct.
15. **No status codes in `Ok`.** `Result<U64, E>`, where the `U64` is a code the caller checks again, is forbidden. Every failure travels in `Error`. `.Ok` always carries a value, so return the value the call produced.
16. **Failure enums are specific.** Write `enum InstallFailure { NotSigned DiskFull(Number) Exists(String) }`. A lone `Failed(String)`, or a number, is forbidden.

### Structure

17. **No prefixed names.** A two- or three-letter program prefix is forbidden: `dkSurfaces`, `bsClients`, `ltShaUpdate`, `uiLetterFor`, `let duOpWatch: U32 = U32(5)`.
    - The package is already the namespace.
    - Constants go in `namespace DiskOperation { let watch: ... }`, or become enum cases.
    - Operations become methods on their type through `extend Surface { ... }`.
18. **No global mutable state.** A top-level `var` is forbidden: arrays (`var dkSurfaces: [DkSurface] = []`), counters (`var bsNextKey: U64`) and flags (`var shellSystemLive: Bool`). State lives in a struct, such as `struct Registry { var surfaces: [Surface] }`, created in `main` and passed as `borrow mut`.
19. **No constants behind functions.** `function pageSize() -> Int { return 4096 }` is a namespaced `let`. Versions and settings come from `klist!`. A function computes something, and is named for what it computes.
20. **One home per constant.** A system path (`"/Applications"`, `"/Volumes/"`), a protocol size, an opcode table or a limit is declared once, in the library that owns it, and read from there. Never write the same literal in a second file or package.
21. **No copied helpers.** Code two packages need lives once, in a shared library: C strings, page rounding, decimal text, argument decoding, protocol tables.
22. **Raw memory stays at the boundary.**
    - These are forbidden outside the single layer that talks to C, the kernel or hardware: `heapLoad`, `heapStore`, `heapAllocateRaw`, hand-computed offsets such as `heapLoad<U32>(block, Int(at + U64(12)))`, and `RawPtr`.
    - In that layer, declare each layout once as an `@FFI.Struct { layout: c }`, and load or store it whole.
    - Everything above that layer works with Kira structs and enums.
23. **No `@Native` on Kira functions.** It does nothing. The annotations you write are `@Main`, `@AtExit`, `@MainThread`, `@Required`, `@Derive(...)` and `@FFI.*`. `@Service` is Foundation's own.
24. **Small units.**
    - A function stays under about 40 lines. Past that, it is several functions.
    - More than four parameters means the function takes a struct.
    - A file stays under 700 lines and splits by topic.
    - A `match` arm longer than a few lines calls a function.
25. **No trailing `return`** in a function that returns nothing.
26. **Name the result, not the steps.** Name a function for what it answers or does to its subject: `volume.mount()`, `keyFromUsage(...)`. `handle`, `process`, `doWork` and `helper2` are forbidden.

### Control flow

27. **Exhaustive matches on your own enums.**
    - A `match` over an enum you declare lists every case.
    - `else ->` is only for integers, strings and enums from another package.
    - An empty arm (`else -> {}`, `System -> {}`) needs a comment above it saying why nothing happens.
28. **`match`, not `if` chains.** Two or more `if x == ... else if x == ...` over one value are forbidden. Integers, strings and `Bool`s match too, and `return match x { ... }` yields a value.
29. **`for`, not counters.**
    - `var i = 0` with `while i < n { ...; i += 1 }` is forbidden. Use `for i in 0..n`.
    - Walk elements with `for item in items`. `for i in 0..items.count { items[i] }` is forbidden unless the index is written back or compared.
30. **No search flags.** A `var seen = false` or `var found = -1` filled by a loop is forbidden. Use `items.contains(x)`, or a function that answers an optional and returns from inside the loop.
31. **No flag loops.** `var running = true` with `while running { ... }` is forbidden. Use `while true { ... }` with `break` or `return`.
32. **No sleep polling.** A loop that sleeps and checks again is forbidden when the platform offers a wait on an event, port, channel or signal: wait on that. When polling is unavoidable, name the interval as a constant, and log why.
33. **Leading dot where the type is known.** Write `.Red`, not `Tone.Red`.

### Input and output

34. **Diagnostics use `log`.** `print` is only for a command's own output to its user. Per-program logging wrappers (`dvLog`, `pwLog`) are forbidden.
35. **Command lines use `ArgumentParser`.** Reading `processArgument(i)`, `envArgument(i)` or argument counts by hand is forbidden.
    1. Add the library as a path dependency.
    2. Declare a `ParsableCommand` with a `@Derive(Parsable)` arguments struct.
    3. Run it with `runCommand(Command(), commandLineArguments())`.
36. **Foundation before hand-written code.** If Foundation or a builtin does the job, writing your own is forbidden. That covers maths, text search, splitting, trimming, files, C strings and hashing.

### Naming and comments

37. **Full words.** Write `openVolume`, `surfaces`, `KeyState` and `pressedAt`. Never `vlTbl`, `tmp2`, `buf`, `cnt` or `p2`.
38. **Comments say why.** A comment that restates the code, narrates history, or explains a magic number that should be a name is forbidden. Delete it, or fix the name.
39. **No dead code.** No commented-out code, no unused functions, and no function that returns `true` without doing the work.

### Before you hand back code

Every item must hold:

1. `kira check .` is clean, and `kira test .` ends with `0 failed` for a package with tests.
2. `kira format --check .` lists nothing.
3. Search your change for each of these. Every hit is fixed, or sits in the single C, wire or hardware boundary layer:
   - `let _ =`
   - `U32(`, `U64(`
   - `@Native`
   - `print(`
   - `while `
   - `== U`, `!= U`
   - `heapLoad`, `heapStore`
   - `else -> {}`
   - `: Int`, `: Float`, `: U32` or `: U64` on a quantity (it should be `Number` or `UNumber`)
   - a type parameter `<T>` (it should be `Any`)
   - a byte offset or slot size outside the encoder that owns it
   - a top-level `var`
   - a two- or three-letter name prefix
4. Every new constant, enum and helper lives in the package that owns its concept.

## Tests

Foundation holds the `Test` family and the `TestRunner` collector, so a test package only writes `import Foundation`. Never copy a `Test.kira` or `TestRunner.kira` into a package. A case:

```kira
construct SumsRange() extends Test {
    test {
        var sum = 0
        for value in 0..5 { sum += value }
        return sum
    }
    expect { let e: Result<Any, TestFailure> = .Ok(10) return e }
}
```

- The measured value is returned as `Any`. The expectation's type is exactly `Result<Any, TestFailure>`.
- Run the tests with `kira test <package>`. It must end with `0 failed`, and it exits 1 otherwise.
- `kira check --test <package>` checks the tests without running them.
- A `--test` build of a package with no `Test` cases is error 3371.

## When something fails

Read the message, then the code. klf-kira's `docs/diagnostics.md` lists every code.

| Code | Meaning | Fix |
| --- | --- | --- |
| 9001 | The construct is outside the subset (`import A.B`, an annotation with arguments), or a declaration is missing. | Most often, add `import Foundation`. |
| 3061, 3060, 3050, 3091 | Undefined function, name, type or field. | Look in the installed `std/` for the real name. Never guess. |
| 3021, 3025 | You mutated a `let`. | Use `var`, or pass `borrow mut`. |
| 3071, 3183 | Operand or argument types differ. | Fix the declared type; convert only at a C, kernel or wire boundary. |
| 3394 | The `Error` arm drops its failure. | Bind the failure and use it. |
| 2099 | A function, method or binding takes a builtin's name. | Rename it. |
| 4003 | Unknown manifest member. | Fix the member's name. |
| 4033 | No library for an import. | Add a path dependency. |
| 3372 | An `@FFI.Extern` names a library `nativeLibraries` does not declare. | Declare it in `nativeLibraries`. |

# Canonical control identifiers

One definition of what a control identifier means: `canonical.ts`, held to `fixtures.json` by `__tests__/canonical.test.ts`, which `make ci-test` runs. Its consumer is the Zero Trust overlay generator (`../../zt-overlay/`), which uses it to read CISA's unpadded identifiers (`AC-2(1)`) as the seed's (`AC-02(01)`) and to build seed ids.

| File                          | Role                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `canonical.ts`                | The rule: `canonicalize()`, `seedControlId()`, `controlIdentity()`, `assertNoCollisions()` |
| `fixtures.json`               | The contract: every case the test runs                                                     |
| `overrides.json`              | Identifiers declared malformed at source, and declared collisions                          |
| `__tests__/canonical.test.ts` | Runs every fixture and the override behaviour                                              |

## One implementation, held to a fixture file

`fixtures.json` is the contract: the test suite runs every case in it, so a change to the rule has to change a fixture, and the diff shows what an identifier now means. The rule is an algorithm (zero-pad the base, zero-pad the enhancement, upper-case the family), not a lookup table, which is why it is code and not data.

A Python twin of the rule, held to the same fixtures, once served a Python overlay generator. That generator is now TypeScript, so the twin was removed.

The override registry is data, `overrides.json`.

The NIST generator deliberately does not use this. It reads OSCAL labels verbatim from a catalog that is already well-formed, and its joins, to the SP 800-53A export and to the previous release's catalog, are by OSCAL identifier, so it needs no normalisation. Its boundary test forbids importing anything outside its own directory, which keeps that true by construction.

## The canonical form

The zero-padded display label: family upper-cased, base padded to two digits, enhancement padded to two digits in parentheses.

```
AC-2      -> AC-02
ac-2(3)   -> AC-02(03)
AU-5a     -> AU-05      (letter returned separately; it names a part, not a control)
```

Anything else is rejected by name rather than guessed at. A guessed identifier lands in generated SQL and either dangles or, worse, resolves to the wrong control.

## The override registry

`overrides.json` declares identifiers that are known to be malformed at source. An entry does **not** rewrite the value — it records that the exception is known and lets the run continue, so the generated seed is unchanged. Rewriting would be the silent-correction pattern that the earlier Zero Trust pipeline had to retire.

An identifier that is malformed and _not_ in the registry fails the run. Two different raw inputs canonicalising to the same identifier also fail the run unless that collision is declared.

A collision entry is keyed on `identity` — the canonical control number **plus its statement letter**, so `AC-01a` rather than `AC-01`. That distinction is the whole reason the gate works: a control and its own lettered items share a control number and are not the same thing, and keying on the number alone reports every control that has lettered items as a false collision. The reported value is printed in the same spelling, so a genuine collision pastes straight into the file.

Entries are removed when the source catalog is corrected, which is the point of recording them rather than tolerating them.

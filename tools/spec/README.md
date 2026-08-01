# Spec Partner

Generates and hardens specifications for features before implementation.

## Modules

- **spec-partner.ts** — Analyzes source code and generates a formal specification with requirements, risks, and assumptions.
- **hard-spec.ts** — Freezes a spec to JSON, preventing scope creep.

## Usage

```bash
tsx tools/cli/index.ts loop spec-pass
```

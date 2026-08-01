# TDD Craftsman

Red-Green-Refactor cycle enforcement with automated judge.

## Modules

- **tdd-craftsman.ts** — Runs TDD cycle, verifies test-first discipline.
- **judge.ts** — Weighted scoring system for evaluating TDD compliance.
- **cycle-log.ts** — Persists each red/green/refactor step as JSONL.

## Usage

```bash
tsx tools/cli/index.ts loop tdd-pass
```

# tools/agent.md — Engineering Agent Instructions

> Entry point for any AI agent working with this tools/ folder.
> Designed to be copied to any project without modifications.

---

## Role: Engineering Orchestrator

You are an engineering agent that uses the `tools/` system to assist with software development. Your job is to **orchestrate**, not to implement directly.

### Core Rules

1. **Read this file first** — then discover the project structure
2. **Use tools/config.ts** — this is the single source of truth for project paths, commands, and conventions
3. **One feature at a time** — never mix changes from different tasks
4. **Anti-teléfono** — subagents write results to `tools/progress/artifacts/` and return only references
5. **Never hardcode** — paths, commands, role names all come from `tools/config.ts`
6. **Append-only history** — never delete entries from `tools/progress/history.md`
7. **Context Guard must pass** — before any code generation, verify scope

---

## Project Discovery Protocol

When starting on a NEW project, do this:

### Step 1: Read config
```bash
cat tools/config.ts
```
This tells you:
- `projectName` — what to call the project
- `paths.*` — where source code, pages, APIs, components, migrations live
- `commands.*` — how to build and test
- `security.*` — role names, admin routes, tenant isolation
- `codeGen.*` — whether code generation is enabled

### Step 2: Scan project structure
Walk the directory tree to understand:
- Framework (React, Vue, Svelte, etc.)
- Database (Supabase, Prisma, Drizzle, SQLite, etc.)
- Auth system
- Route structure (file-based, config-based)
- Component patterns

### Step 3: Read feature_list.json
```bash
cat feature_list.json
```
- Find feature with `status: "in_progress"` or `status: "pending"`
- Pick the one with lowest `id`
- Do not modify features marked `done`

### Step 4: Choose goal
```bash
npx tsx tools/loop/run.ts --list        # See available goals
npx tsx tools/loop/run.ts --goal build-pass  # Quick build check
npx tsx tools/loop/run.ts               # Full engineering loop
```

---

## Subagent Protocol

### When to delegate

| Task | Subagent | File |
|---|---|---|
| Code implementation | implementer | `.claude/agents/implementer.md` |
| Code review | reviewer | `tools/governance/reviewer-bus.ts` |
| Security audit | security | `tools/governance/security-validator.ts` |
| Build verification | build | `tools/governance/build-validator.ts` |

### Communication pattern (anti-teléfono)

```
Leader → Implementer → writes to progress/artifacts/impl_X.md
                     → returns "done → progress/artifacts/impl_X.md"
Leader → Reviewer    → writes to progress/artifacts/review.json
                     → returns "passed" or "blocking: [list]"
```

---

## Progressive Disclosure

| File | When to read |
|---|---|
| `tools/config.ts` | First — always |
| `tools/README.md` | When you need tool reference |
| `tools/agent.md` | This file — always |
| `feature_list.json` | Always at start |
| `tools/governance/reviewer-bus.ts` | When fixing reviewer |
| `tools/loop/loop-engine.ts` | When understanding orchestration |
| `tools/progress/history.md` | For historical context |
| `tools/progress/current.md` | For current session state |
| `tools/code-generator/templates/*` | When modifying code generation |
| `tools/code-generator/plans/*` | When defining page plans |

---

## Documentation Enrichment Protocol

When working on a project, enrich your understanding by reading:

1. **Project README** — `head -50 README.md`
2. **Package config** — `cat package.json` or `cat Cargo.toml` etc.
3. **Type definitions** — scan `src/types/` or equivalent
4. **Route structure** — `ls src/pages/` or equivalent
5. **Database schema** — `ls supabase/migrations/` or equivalent
6. **Existing components** — scan `src/components/` for patterns
7. **Test patterns** — scan `src/**/*.test.ts` or equivalent
8. **Build output** — check for previous errors in `tools/progress/`

Store learnings in `tools/progress/history.md` (append only).

---

## Deploy Readiness Checks

Before marking any feature as `done`:

1. **Build passes** — `npm run build`
2. **No debug artifacts** — no `console.log`, `debugger`, TODO without context
3. **Migrations applied** — `npx supabase migration list`
4. **Security gate passes** — `npx tsx tools/governance/run.ts --security`
5. **Truth system passes** — `npx tsx tools/truth/run.ts --skip-server`
6. **Reviewer passes** — `npx tsx -e "import {runReview,printReviewResult} from './tools/governance/reviewer-bus'; const r=await runReview(); printReviewResult(r);"`

---

## Important Constraints

- ✅ **Tools are self-contained in `tools/`** — they don't modify files outside `tools/` except:
  - `feature_list.json` (task tracking)
  - `progress/` (symlinked or copied from `tools/progress/`)
  - Root-level configs (optional: `setup.sh`, `init.ps1`)
- ✅ **Cross-platform** — all paths use `path.join()`, all commands use `npx`/`npm`/`git`
- ✅ **Stack-agnostic** — `tools/config.ts` separates project-specific settings from engine logic
- ❌ **Never modify templates** unless you understand the code generator
- ❌ **Never modify `tools/config.ts` defaults** — override by creating `tools/config.local.ts`
- ❌ **Never commit secrets** — API keys, passwords, tokens

---

## Example Session

```bash
# 1. Discover project
cat tools/config.ts
ls src/
cat feature_list.json

# 2. Run engineering loop
npx tsx tools/loop/run.ts --goal build-pass

# 3. The loop runs:
#    Learning → Context Guard → Governance → Security → Build → Reviewer → Truth → Deploy → Close

# 4. If reviewer blocks, fix issues and re-run
# 5. If all phases pass, feature is done

# 6. Mark feature as done in feature_list.json
```

---

> This agent.md is part of the `tools/` folder and designed to be project-agnostic.
> Edit `tools/config.ts` to adapt to any project's structure and commands.

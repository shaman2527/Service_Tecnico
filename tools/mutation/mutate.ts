import * as fs from "fs";
import * as path from "path";

export interface MutationOp {
  name: string;
  detect: RegExp;
  apply: (match: string) => string;
}

export const MUTATION_OPS: MutationOp[] = [
  { name: "GE-to-GT",     detect: />=\s*(?!=)/g,     apply: (m) => `>${m.slice(2)}` },
  { name: "LE-to-LT",     detect: /<=\s*(?!=)/g,     apply: (m) => `<${m.slice(2)}` },
  { name: "EQ-to-NEQ",    detect: /==\s*(?!=)/g,     apply: (m) => `!${m}` },
  { name: "NEQ-to-EQ",    detect: /!=\s*(?!=)/g,     apply: (m) => `=${m.slice(1)}` },
  { name: "GT-to-GE",     detect: /(?<!<|>|!)=?>\s*(?!>|=)/g, apply: (m) => `>=${m.slice(1)}` },
  { name: "LT-to-LE",     detect: /(?<!<|>|!)=?<\s*(?!<|=)/g, apply: (m) => `<=${m.slice(1)}` },
  { name: "AND-to-OR",    detect: /&&/g,              apply: () => "||" },
  { name: "OR-to-AND",    detect: /\|\|/g,            apply: () => "&&" },
  { name: "TRUE-to-FALSE", detect: /\btrue\b/g,       apply: () => "false" },
  { name: "FALSE-to-TRUE", detect: /\bfalse\b/g,       apply: () => "true" },
];

export interface Mutant {
  op: string;
  file: string;
  line: number;
  original: string;
  mutated: string;
}

export function findMutations(
  filePath: string,
  ops: MutationOp[] = MUTATION_OPS,
): Mutant[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const mutants: Mutant[] = [];

  for (const op of ops) {
    op.detect.lastIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      op.detect.lastIndex = 0;
      const matches = lines[i].match(op.detect);
      if (matches) {
        for (const match of matches) {
          mutants.push({
            op: op.name,
            file: filePath,
            line: i + 1,
            original: match,
            mutated: op.apply(match),
          });
        }
      }
    }
  }

  return mutants;
}

export function applyMutation(
  filePath: string,
  mutant: Mutant,
): void {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const idx = mutant.line - 1;
  if (idx >= 0 && idx < lines.length) {
    lines[idx] = lines[idx].replace(mutant.original, mutant.mutated);
    fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
  }
}

export function restoreFile(
  filePath: string,
  originalContent: string,
): void {
  fs.writeFileSync(filePath, originalContent, "utf-8");
}

export function collectSourceFiles(
  includePatterns: string[],
  excludePatterns: string[],
): string[] {
  const files: string[] = [];

  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
          walk(fullPath);
        }
      } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        const relPath = path.relative(process.cwd(), fullPath).replace(/\\/g, "/");
        const included = includePatterns.some(p => relPath.startsWith(p.replace("*", "").replace(/\\/g, "/")));
        const excluded = excludePatterns.some(p => relPath.includes(p.replace("*", "").replace(/\\/g, "/")));
        if (included && !excluded) {
          files.push(fullPath);
        }
      }
    }
  }

  for (const pattern of includePatterns) {
    const dir = path.join(process.cwd(), pattern.split("*")[0]);
    walk(dir);
  }

  return files;
}

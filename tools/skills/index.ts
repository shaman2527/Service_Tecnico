import * as fs from "fs";
import * as path from "path";
import { detectProject } from "../detector";

export interface SkillDef {
  name: string;
  path: string;
  keywords: string[];
  description: string;
}

const SKILL_DIRS = [
  ".agent/skills",
  ".jcode/skills",
  ".claude/skills",
];

function scanDir(dir: string): SkillDef[] {
  if (!fs.existsSync(dir)) return [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const skills: SkillDef[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = path.join(dir, entry.name, "SKILL.md");
        if (fs.existsSync(skillPath)) {
          const content = fs.readFileSync(skillPath, "utf-8");
          const firstLine = content.split("\n")[0]?.replace(/^#\s*/, "") || entry.name;
          const keywords = content.match(/\*\*([^*]+)\*\*/g)?.map(k => k.replace(/\*/g, "").toLowerCase()) ?? [];
          const description = content.split("\n").slice(1, 4).join(" ").slice(0, 200);
          skills.push({ name: firstLine, path: skillPath, keywords, description });
        }
      }
    }
    return skills;
  } catch {
    return [];
  }
}

export function findSkills(projectRoot: string = process.cwd()): SkillDef[] {
  const all: SkillDef[] = [];
  for (const rel of SKILL_DIRS) {
    const abs = path.join(projectRoot, rel);
    all.push(...scanDir(abs));
  }
  return all;
}

export interface SkillMatch {
  skill: SkillDef;
  score: number;
  reason: string;
}

export function matchSkillsToProject(skills: SkillDef[], projectRoot: string = process.cwd()): SkillMatch[] {
  const project = detectProject();
  const contextTerms: string[] = [
    project.language,
    project.framework ?? "",
    project.frontend ?? "",
    project.backend ?? "",
    project.database ?? "",
    project.bundler ?? "",
    project.testFramework ?? "",
    "typescript", "node", "react",
    ...(project.hasDocker ? ["docker"] : []),
    ...(project.hasMigrations ? ["migrations"] : []),
    ...(project.isMonorepo ? ["monorepo"] : []),
  ].filter(Boolean).map(t => t.toLowerCase());

  const results: SkillMatch[] = [];
  for (const skill of skills) {
    let score = 0;
    const reasons: string[] = [];

    for (const kw of skill.keywords) {
      if (contextTerms.some(t => t.includes(kw) || kw.includes(t))) {
        score += 0.3;
        reasons.push(`keyword:${kw}`);
      }
    }

    for (const term of contextTerms) {
      if (skill.description.toLowerCase().includes(term)) {
        score += 0.2;
        reasons.push(`context:${term}`);
      }
      if (skill.name.toLowerCase().includes(term)) {
        score += 0.4;
        reasons.push(`name:${term}`);
      }
    }

    if (score > 0) {
      results.push({ skill, score: Math.min(score, 1), reason: reasons.join(", ") });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

export function injectSkillPrompt(matches: SkillMatch[], limit = 3): string {
  if (matches.length === 0) return "";
  const top = matches.slice(0, limit);
  const sections = top.map(m =>
    `- **${m.skill.name}** (${(m.score * 100).toFixed(0)}% match): ${m.skill.description.slice(0, 150)}`
  );
  return `\n## Skills activas\n${sections.join("\n")}\n`;
}

export function printSkillMatches(matches: SkillMatch[]): void {
  if (matches.length === 0) {
    console.log("   No skills matched this project");
    return;
  }
  console.log(`   Skills found: ${matches.length}`);
  for (const m of matches.slice(0, 5)) {
    console.log(`   [${(m.score * 100).toFixed(0)}%] ${m.skill.name}`);
  }
}

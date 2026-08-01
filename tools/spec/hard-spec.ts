import * as fs from "fs";
import * as path from "path";

export interface HardSpec {
  title: string;
  description: string;
  requirements: { id: string; description: string; priority: string }[];
  risks: string[];
  assumptions: string[];
  frozenAt: string;
}

const SPEC_DIR = path.resolve(process.cwd(), "tools", "progress", "specs");

export function saveHardSpec(spec: HardSpec): string {
  if (!fs.existsSync(SPEC_DIR)) fs.mkdirSync(SPEC_DIR, { recursive: true });

  const frozen: HardSpec = {
    ...spec,
    frozenAt: new Date().toISOString(),
  };

  const filePath = path.join(SPEC_DIR, `${spec.title.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}.json`);
  fs.writeFileSync(filePath, JSON.stringify(frozen, null, 2), "utf-8");
  return filePath;
}

export function generateAcceptanceFromSpec(spec: HardSpec): string[] {
  return spec.requirements.map(r => {
    const prefix = r.priority === "must" ? "MUST" : r.priority === "should" ? "SHOULD" : "NICE";
    return `${prefix}: ${r.description}`;
  });
}

import * as fs from "fs";

export interface SpecRequirement {
  id: string;
  description: string;
  priority: "must" | "should" | "nice";
}

export interface SpecResult {
  status: "accepted" | "rejected";
  spec: {
    title: string;
    description: string;
    requirements: SpecRequirement[];
    risks: string[];
    assumptions: string[];
  };
  summary: string;
}

export function runSpecPartner(): SpecResult {
  const projectFiles: string[] = [];

  const srcDir = "src";
  try {
    const entries = fs.readdirSync(srcDir, { recursive: true });
    for (const e of entries) {
      if (typeof e === "string" && (e.endsWith(".ts") || e.endsWith(".tsx"))) {
        projectFiles.push(e);
      }
    }
  } catch {}

  const requirements: SpecRequirement[] = [
    { id: "REQ-001", description: "System must compile without errors", priority: "must" },
    { id: "REQ-002", description: "All API endpoints must return valid responses", priority: "must" },
    { id: "REQ-003", description: "Authentication must protect restricted routes", priority: "must" },
    { id: "REQ-004", description: "Database operations must handle errors gracefully", priority: "should" },
  ];

  const risks: string[] = [];
  if (projectFiles.length > 50) risks.push("Large project size may increase review time");
  if (!projectFiles.some(f => f.includes("auth") || f.includes("login"))) {
    risks.push("No authentication module detected");
  }

  return {
    status: projectFiles.length > 0 ? "accepted" : "rejected",
    spec: {
      title: "Project Specification",
      description: `Auto-generated spec from ${projectFiles.length} source files`,
      requirements,
      risks,
      assumptions: ["Source code is the source of truth", "Tests reflect expected behavior"],
    },
    summary: `Spec accepted: ${projectFiles.length} source files found`,
  };
}

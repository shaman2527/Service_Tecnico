import * as fs from "fs";
import * as path from "path";

export interface DetectedProject {
  name: string;
  language: "typescript" | "rust" | "python" | "go" | "java" | "unknown";
  framework: string | null;
  hasFrontend: boolean;
  hasBackend: boolean;
  frontendFramework: string | null;
  backendFramework: string | null;
  database: "sqlite" | "postgres" | "supabase" | "none" | null;
  bundler: "vite" | "webpack" | "esbuild" | "tauri" | "cargo" | null;
  testFramework: string | null;
  dockerized: boolean;
  hasMigrations: boolean;
  isMonorepo: boolean;
  detectedAt: string;
}

export function detectProject(rootDir: string = process.cwd()): DetectedProject {
  const info: DetectedProject = {
    name: "unknown",
    language: "unknown",
    framework: null,
    hasFrontend: false,
    hasBackend: false,
    frontendFramework: null,
    backendFramework: null,
    database: null,
    bundler: null,
    testFramework: null,
    dockerized: false,
    hasMigrations: false,
    isMonorepo: false,
    detectedAt: new Date().toISOString(),
  };

  const pkgJsonPath = path.join(rootDir, "package.json");
  const cargoPath = path.join(rootDir, "Cargo.toml");

  if (fs.existsSync(pkgJsonPath)) {
    info.language = "typescript";
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
      info.name = pkg.name || path.basename(rootDir);
      const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);

      // Frontend frameworks
      if (deps.next) { info.framework = "next"; info.frontendFramework = "next"; info.hasFrontend = true; }
      else if (deps.react || deps["react-dom"]) { info.frontendFramework = "react"; info.hasFrontend = true; }
      else if (deps.vue || deps["vue-router"]) { info.frontendFramework = "vue"; info.hasFrontend = true; }
      else if (deps.svelte || deps["@sveltejs/kit"]) { info.frontendFramework = "svelte"; info.hasFrontend = true; }
      else if (deps.astro) { info.framework = "astro"; info.frontendFramework = "astro"; info.hasFrontend = true; }
      else if (deps["@tauri-apps/api"]) { info.bundler = "tauri"; info.hasFrontend = true; }
      else if (fs.existsSync(path.join(rootDir, "index.html")) || fs.existsSync(path.join(rootDir, "public"))) {
        info.hasFrontend = true;
      }

      // Backend frameworks
      if (deps.express) { info.backendFramework = "express"; info.hasBackend = true; }
      else if (deps.fastify) { info.backendFramework = "fastify"; info.hasBackend = true; }
      else if (deps.next) { info.backendFramework = "next"; info.hasBackend = true; }
      else if (deps.astro) { info.backendFramework = "astro"; info.hasBackend = true; }

      // Databases
      if (deps.pg || deps["@neondatabase/serverless"]) info.database = "postgres";
      else if (deps["@supabase/supabase-js"]) info.database = "supabase";
      else if (deps["better-sqlite3"] || deps.sqlite) info.database = "sqlite";

    // Bundlers
    if (deps.vite) info.bundler = "vite";
    else if (deps.webpack) info.bundler = "webpack";
    else if (deps.esbuild) info.bundler = "esbuild";
      if (deps.vitest) info.testFramework = "vitest";
      else if (deps.jest) info.testFramework = "jest";
      else if (deps.playwright) info.testFramework = "playwright";
      else if (deps.cypress) info.testFramework = "cypress";

      // Monorepo detection
      if (pkg.workspaces) info.isMonorepo = true;

      // Framework fallback
      if (!info.framework) {
        if (deps["@tauri-apps/api"]) info.framework = "tauri";
        else if (deps.react) info.framework = "react";
        else info.framework = "node";
      }
    } catch {}
  } else if (fs.existsSync(cargoPath)) {
    info.language = "rust";
    try {
      const content = fs.readFileSync(cargoPath, "utf-8");
      const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
      info.name = nameMatch ? nameMatch[1] : path.basename(rootDir);
      if (content.includes("tauri")) { info.framework = "tauri"; info.bundler = "tauri"; info.hasFrontend = true; }
      if (content.includes("actix") || content.includes("axum") || content.includes("rocket")) {
        info.backendFramework = "rust-web"; info.hasBackend = true;
      }
      if (content.includes("sqlx") || content.includes("diesel")) info.database = "postgres";
      if (content.includes("rusqlite") || content.includes("sqlite")) info.database = "sqlite";
      info.bundler = "cargo";
    } catch {}
  }

  // Docker
  if (fs.existsSync(path.join(rootDir, "Dockerfile")) || fs.existsSync(path.join(rootDir, "docker-compose.yml"))) {
    info.dockerized = true;
  }

  // Migrations
  const migrationPaths = ["database/migrations", "migrations", "supabase/migrations", "prisma/migrations"];
  for (const mp of migrationPaths) {
    if (fs.existsSync(path.join(rootDir, mp))) {
      info.hasMigrations = true;
      break;
    }
  }

  return info;
}

export function printDetectedProject(info: DetectedProject): void {
  console.log("\n📋 Project Detection Result");
  console.log("-".repeat(40));
  console.log(`  Name:        ${info.name}`);
  console.log(`  Language:    ${info.language}`);
  console.log(`  Framework:   ${info.framework ?? "none"}`);
  console.log(`  Frontend:    ${info.hasFrontend ? (info.frontendFramework ?? "yes") : "no"}`);
  console.log(`  Backend:     ${info.hasBackend ? (info.backendFramework ?? "yes") : "no"}`);
  console.log(`  Database:    ${info.database ?? "none"}`);
  console.log(`  Bundler:     ${info.bundler ?? "none"}`);
  console.log(`  Tests:       ${info.testFramework ?? "none"}`);
  console.log(`  Docker:      ${info.dockerized ? "yes" : "no"}`);
  console.log(`  Migrations:  ${info.hasMigrations ? "yes" : "no"}`);
  console.log(`  Monorepo:    ${info.isMonorepo ? "yes" : "no"}`);
  console.log("-".repeat(40));
}

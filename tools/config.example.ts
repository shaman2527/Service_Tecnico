/**
 * Harness ENGINEERING — Project Configuration Example
 *
 * Each project creates its own `config.ts` based on this template.
 * The tools read this config to adapt to your project.
 *
 * Created by Shaman / Roberth Silva — https://github.com/shaman2527
 */

export const CONFIG = {
  /** Your project name (used in governance reports, agent prompts, etc.) */
  projectName: "My Project",

  /** Frameworks used in this project — auto-detected by harnes init */
  frameworks: [] as string[],

  /** Available user roles (RBAC) */
  roles: ["admin", "user"],

  /** Project paths — tools read these to find source code, migrations, etc. */
  paths: {
    /** Where your source code lives */
    sourceDir: "src",

    /** Where API routes/endpoints live */
    apiDir: "src-tauri/src",

    /** Where database migrations are stored */
    migrationsDir: "database/migrations",

    /** Where tools/ stores progress data */
    progressDir: "tools/progress",

    /** Where tools/ stores generated artifacts */
    artifactsDir: "tools/progress/artifacts",

    /** Root directory for generated page components */
    pagesDir: "src/pages",

    /** Where shared library code lives */
    libDir: "src/lib",
  },

  /** Shell commands for the project */
  commands: {
    build: "npm run build",
    dev: "npm run dev",
    test: null as string | null,
    preview: "npm run preview",
    devServerUrl: "http://localhost:5173",
  },

  /** Database configuration */
  database: {
    type: "none" as "sqlite" | "postgres" | "supabase" | "none",
    envVars: [] as string[],
  },

  /** Security checks configuration */
  security: {
    enabled: true,
    /** Which checks to run — pick from: secrets, debug-mode, sql-injection, auth,
     *  hardcoded-ids, error-handling, rls-policies, service-key-leak */
    checks: ["secrets", "debug-mode", "sql-injection", "auth"],
  },

  /** Auto-fix engine rules */
  autoFix: {
    enabled: true,
    allowedExtensions: [".ts", ".tsx", ".py", ".go", ".rs", ".js", ".jsx", ".css", ".json"],
    maxFileSize: 1024 * 100,
  },

  /** Project structure */
  structure: "monolith" as "monolith" | "frontend-backend" | "client-server",

  /** Code generation settings */
  codeGen: {
    enabled: false,
    plansFile: "mvp-pages.ts",
  },

  /** TDD settings */
  tdd: {
    maxCycles: 10,
  },

  /** Mutation testing settings */
  mutation: {
    maxPerRun: 20,
    threshold: 0.9,
  },
};

export type ProjectConfig = typeof CONFIG;

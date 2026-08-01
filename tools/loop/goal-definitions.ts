import type { GoalConfig } from "./types";

export const GOALS: GoalConfig[] = [
  {
    id: "mvp-complete",
    description: "Todas las páginas implementadas, build verde, truth pass, tests pass",
    conditions: [
      { type: "build", description: "Build debe pasar" },
      { type: "truth", description: "Truth system debe pasar" },
      { type: "tests_pass", description: "Unit tests deben pasar" },
      { type: "placeholders", description: "Sin placeholders pendientes" },
      { type: "endpoints_all_ok", description: "Todos los endpoints OK" },
    ],
    maxIterations: 10,
    intervalMs: 60000,
  },
  {
    id: "build-pass",
    description: "Solo verificar que el build pasa (rápido)",
    conditions: [
      { type: "build", description: "Build debe pasar" },
    ],
    maxIterations: 5,
    intervalMs: 30000,
  },
  {
    id: "truth-pass",
    description: "Build + Truth + Tests pasando",
    conditions: [
      { type: "build", description: "Build debe pasar" },
      { type: "truth", description: "Truth system debe pasar" },
      { type: "tests_pass", description: "Unit tests deben pasar" },
      { type: "endpoints_all_ok", description: "Todos los endpoints OK" },
    ],
    maxIterations: 5,
    intervalMs: 30000,
  },
  {
    id: "test-quality",
    description: "Validar calidad del código de tests: AAA pattern, assertions, no console.log, naming",
    conditions: [
      { type: "build", description: "Build debe pasar" },
      { type: "tests_pass", description: "Unit tests deben pasar" },
      { type: "custom", description: "Test quality score >= 80%", customCheck: (state) => (state as any).testQualityScore >= 0.8 },
    ],
    maxIterations: 5,
    intervalMs: 30000,
  },
  {
    id: "uncle-bob-flow",
    description: "Flujo SDD de Robert C. Martin: Spec→TDD→Judge→Mutation→Build→Review→Truth",
    conditions: [
      { type: "spec_pass", description: "Hard spec creada y approval humana" },
      { type: "tdd_pass", description: "TDD cycles completados (red→green→refactor)" },
      { type: "mutation_pass", description: "Mutation score >= 90%" },
      { type: "build", description: "Build debe pasar" },
      { type: "truth", description: "Truth system debe pasar" },
      { type: "tests_pass", description: "Unit tests deben pasar" },
      { type: "endpoints_all_ok", description: "Todos los endpoints OK" },
    ],
    maxIterations: 8,
    intervalMs: 30000,
  },
  {
    id: "full-cycle",
    description: "Ciclo completo de 9 fases: Learning → Context → Security → Build → Review → Truth → Deploy → Close",
    conditions: [
      { type: "build", description: "Build debe pasar" },
      { type: "truth", description: "Truth system debe pasar" },
      { type: "tests_pass", description: "Unit tests deben pasar" },
      { type: "endpoints_all_ok", description: "Todos los endpoints OK" },
      { type: "placeholders", description: "Sin placeholders pendientes" },
      { type: "deploy_ready", description: "Deploy readiness checks pasan" },
    ],
    maxIterations: 10,
    intervalMs: 60000,
  },
];

export function getGoal(id: string): GoalConfig | undefined {
  return GOALS.find(g => g.id === id);
}

export function listGoals(): string {
  return GOALS.map(g => `  - ${g.id}: ${g.description}`).join("\n");
}

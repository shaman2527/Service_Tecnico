import type { Stack, PagePlan, PEngineConfig, GenerateOptions, BuildResult, EngineState, TestResult } from "./core/types";

export type { Stack, PagePlan, PEngineConfig, GenerateOptions, BuildResult, EngineState, TestResult };

export class PEngine {
  private stack: Stack;
  private plans: PagePlan[];
  private progressDir: string;

  constructor(config: PEngineConfig) {
    this.stack = config.stack;
    this.plans = config.plans;
    this.progressDir = config.progressDir || "tools/progress";
  }

  generate(options?: GenerateOptions): EngineState {
    console.log(`\n⚙️  [PEngine] Generating pages via ${this.stack.name}...`);
    return this.stack.generate(this.plans, options);
  }

  build(timeoutMs?: number): BuildResult {
    console.log(`\n🔨 [PEngine] Building via ${this.stack.name}...`);
    return this.stack.build(timeoutMs);
  }

  async test(timeoutMs?: number): Promise<TestResult> {
    if (this.stack.test) {
      console.log(`\n🧪 [PEngine] Running tests via ${this.stack.name}...`);
      return this.stack.test(timeoutMs);
    }
    console.log(`\n⏭️  [PEngine] Tests not implemented for ${this.stack.name}`);
    return { success: true, durationMs: 0, errors: [] };
  }

  async runFullCycle(options?: {
    skipServer?: boolean;
    verbose?: boolean;
    runTests?: boolean;
    authCookie?: string;
  }): Promise<{
    buildResult: BuildResult;
    testResult?: TestResult;
    truthPassed: boolean;
  }> {
    console.log("╔═══════════════════════════════════════════════╗");
    console.log("║   P-Engine — Full Production Cycle           ║");
    console.log("╚═══════════════════════════════════════════════╝");

    // Phase 1: Generate
    const genResult = this.generate();
    if (genResult.errors.length > 0) {
      console.error(`   ❌ Generation errors: ${genResult.errors.map(e => e.error).join(", ")}`);
    }

    // Phase 2: Build
    const buildResult = this.build(180000);
    if (!buildResult.success) {
      console.error(`   ❌ Build failed: ${buildResult.errors.length} errors`);
      return { buildResult, truthPassed: false };
    }

    // Phase 3: Tests
    let testResult: TestResult | undefined;
    if (options?.runTests) {
      testResult = await this.test(60000);
    }

    // Phase 4: Truth via shell
    console.log(`\n🧪 [PEngine] Running truth verification...`);
    try {
      const { execSync } = await import("child_process");
      const flags = options?.skipServer ? "--skip-server" : "";
      const testFlags = options?.runTests ? " --tests" : "";
      const authFlag = options?.authCookie ? ` --cookie "${options.authCookie}"` : "";
      execSync(`npx tsx tools/truth/run.ts ${flags}${testFlags}${authFlag}`, {
        cwd: process.cwd(),
        encoding: "utf-8",
        timeout: 120000,
      });
      return { buildResult, testResult, truthPassed: true };
    } catch {
      return { buildResult, testResult, truthPassed: false };
    }
  }

  getStack(): Stack {
    return this.stack;
  }

  getPlans(): PagePlan[] {
    return this.plans;
  }
}

export { getTableSchema } from "./core/types";

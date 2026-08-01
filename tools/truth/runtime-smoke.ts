import { spawn, execSync, type ChildProcess } from "child_process";
import * as path from "path";
import { fileURLToPath } from "url";
import type { PageConfig } from "../code-generator/types";
import type { EndpointResult, SmokeTestOptions } from "./types";
import { config } from "../config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_BASE_URL = config.commands.devServerUrl;
const SERVER_READY_TIMEOUT = 30000;
const REQUEST_TIMEOUT = 10000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(baseUrl: string, timeout: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(`${baseUrl}/login`, { signal: AbortSignal.timeout(3000) });
      if (res.status >= 200 && res.status < 500) return true;
    } catch {
      // Server not ready yet
    }
    await sleep(500);
  }
  return false;
}

function startPreviewServer(): ChildProcess {
  const proc = spawn("npm", ["run", "preview"], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
    env: { ...process.env, PORT: "4321", HOST: "0.0.0.0" },
  });

  let output = "";
  proc.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  proc.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });

  proc.on("error", (err) => {
    console.error(`   ⚠️ Server spawn error: ${err.message}`);
  });

  return proc;
}

function killServer(proc: ChildProcess): void {
  if (!proc || proc.killed) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(proc.pid), "/f", "/t"]);
    } else {
      proc.kill("SIGTERM");
    }
  } catch {
    // Best effort
  }
}

function expectedStatusForEndpoint(page: PageConfig, method: "GET" | "POST" | "PUT" | "DELETE"): number {
  if (page.pageType === "readonly" && method === "GET") return 200;
  if (page.pageType === "dashboard" && method === "GET") return 200;
  if (method === "GET") return 200;
  return 401;
}

function methodsForPage(page: PageConfig): ("GET" | "POST" | "PUT" | "DELETE")[] {
  if (page.pageType === "readonly" || page.pageType === "dashboard") return ["GET"];
  if (page.pageType === "operations") return ["GET"];
  return ["GET", "POST", "PUT", "DELETE"];
}

function samplePayload(page: PageConfig): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of page.formFields) {
    if (field === "publicado_por") continue;
    payload[field] = "test";
  }
  return payload;
}

function normalizeEndpointPath(endpoint: string): string {
  let e = endpoint;
  if (e.startsWith("api/")) e = e.slice(4);
  if (e.endsWith("/")) e = e.slice(0, -1);
  return e;
}

/**
 * Stricter pass criteria:
 * - If expectedStatus is known, actual must match exactly
 * - If no expectedStatus is known, any 2xx is pass, 4xx with auth cookie is fail
 * - 404 is always fail (missing route)
 */
function isPassing(actualStatus: number, expectedStatus: number, method: string, hasAuth: boolean): { pass: boolean; reason?: string } {
  if (actualStatus === 404) return { pass: false, reason: "route not found" };

  if (expectedStatus > 0) {
    if (actualStatus === expectedStatus) return { pass: true };
    return { pass: false, reason: `expected ${expectedStatus}, got ${actualStatus}` };
  }

  if (actualStatus >= 200 && actualStatus < 300) return { pass: true };
  if (actualStatus === 401 && hasAuth) return { pass: false, reason: "unauthorized despite auth cookie" };
  if (actualStatus >= 400 && actualStatus < 500) return { pass: false, reason: `unexpected ${actualStatus}` };
  if (actualStatus >= 500) return { pass: false, reason: `server error ${actualStatus}` };

  return { pass: true };
}

function isValidJsonResponse(contentType: string | null): boolean {
  if (!contentType) return false;
  return contentType.includes("application/json");
}

export async function runSmokeTests(
  pages: PageConfig[],
  baseUrl?: string,
  options: SmokeTestOptions = {}
): Promise<EndpointResult[]> {
  const url = baseUrl || DEFAULT_BASE_URL;
  const timeout = options.timeout || REQUEST_TIMEOUT;
  const authCookie = options.authCookie;
  const strict = options.strict ?? false;

  const uniqueEndpoints = new Map<string, PageConfig>();
  for (const page of pages) {
    if (!page.apiEndpoint) continue;
    const key = `api/${page.apiEndpoint}`;
    if (!uniqueEndpoints.has(key)) {
      uniqueEndpoints.set(key, page);
    }
  }

  const results: EndpointResult[] = [];
  const entries = Array.from(uniqueEndpoints.entries());

  for (const [fullEndpoint, page] of entries) {
    const methods = methodsForPage(page);
    for (const method of methods) {
      const endpointPath = normalizeEndpointPath(fullEndpoint);
      const requestUrl = `${url}/api/${endpointPath}`;
      const expectedStatus = expectedStatusForEndpoint(page, method);
      const startTime = Date.now();

      try {
        const headers: Record<string, string> = {};
        if (authCookie) headers["Cookie"] = authCookie;
        if (method === "POST" || method === "PUT") headers["Content-Type"] = "application/json";

        const fetchOpts: RequestInit = {
          method,
          signal: AbortSignal.timeout(timeout),
          headers,
        };
        if (method === "POST" || method === "PUT") {
          fetchOpts.body = JSON.stringify(samplePayload(page));
        }
        const response = await fetch(requestUrl, fetchOpts);
        const durationMs = Date.now() - startTime;
        const actualStatus = response.status;

        const check = isPassing(actualStatus, strict ? expectedStatus : 0, method, !!authCookie);
        const contentType = response.headers.get("content-type");
        const hasValidBody = isValidJsonResponse(contentType);

        results.push({
          endpoint: `api/${endpointPath}`,
          method,
          expectedStatus: strict ? expectedStatus : 0,
          actualStatus,
          status: check.pass ? "pass" : "fail",
          durationMs,
          error: check.reason,
          hasValidBody,
        });
      } catch (err: unknown) {
        const durationMs = Date.now() - startTime;
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.push({
          endpoint: `api/${endpointPath}`,
          method,
          expectedStatus,
          actualStatus: 0,
          status: "fail",
          durationMs,
          error: errorMsg.includes("abort") || errorMsg.includes("timeout") ? "timeout" : errorMsg,
        });
      }
    }
  }

  return results;
}

export async function runWithServer(
  pages: PageConfig[],
  options: SmokeTestOptions = {}
): Promise<{
  results: EndpointResult[];
  serverLog: string;
}> {
  let serverLog = "";

  console.log(`\n🔍 Starting preview server...`);
  const server = startPreviewServer();

  server.stdout?.on("data", (chunk: Buffer) => { serverLog += chunk.toString(); });
  server.stderr?.on("data", (chunk: Buffer) => { serverLog += chunk.toString(); });

  const ready = await waitForServer(DEFAULT_BASE_URL, options.timeout || SERVER_READY_TIMEOUT);
  if (!ready) {
    killServer(server);
    return {
      results: [{
        endpoint: "SERVER",
        method: "GET",
        expectedStatus: 200,
        actualStatus: 0,
        status: "fail",
        durationMs: 0,
        error: "Server failed to start within timeout",
      }],
      serverLog,
    };
  }

  console.log(`   ✅ Server ready at ${DEFAULT_BASE_URL}`);

  const results = await runSmokeTests(pages, DEFAULT_BASE_URL, options);

  killServer(server);
  await sleep(500);

  return { results, serverLog };
}

/**
 * Run unit tests (npm test) and return structured results
 */
export async function runUnitTests(): Promise<{
  passed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  durationMs: number;
  errors: string[];
}> {
  const startTime = Date.now();
  const errors: string[] = [];

  try {
    const output = execSync(`${config.commands.test} 2>&1`, {
      cwd: path.resolve(__dirname, "../.."),
      encoding: "utf-8",
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const durationMs = Date.now() - startTime;

    const totalMatch = output.match(/Tests\s+(\d+)/);
    const passMatch = output.match(/(\d+)\s+passed/);
    const failMatch = output.match(/(\d+)\s+failed/);

    const totalTests = totalMatch ? parseInt(totalMatch[1], 10) : 0;
    const passedTests = passMatch ? parseInt(passMatch[1], 10) : 0;
    const failedTests = failMatch ? parseInt(failMatch[1], 10) : 0;

    if (failedTests > 0) {
      const failedLines = output.split("\n").filter(l => l.includes("FAIL") || l.includes("AssertionError"));
      errors.push(...failedLines.slice(0, 10));
    }

    return { passed: failedTests === 0, totalTests, passedTests, failedTests, durationMs, errors };
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Test execution error: ${msg}`);
    return { passed: false, totalTests: 0, passedTests: 0, failedTests: 1, durationMs, errors };
  }
}

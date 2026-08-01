export interface TruthState {
  lastUpdated: string;
  buildStatus: "pass" | "fail" | "unknown";
  buildDurationMs: number;
  totalEndpoints: number;
  testedEndpoints: number;
  passedEndpoints: number;
  failedEndpoints: number;
  skippedEndpoints: number;
  endpointResults: EndpointResult[];
  alignmentScore: number;
  mvpLinesRatio: number;
  warnings: string[];
  errors: string[];
  /** Unit test results */
  unitTests?: TestRunResult;
}

export interface EndpointResult {
  endpoint: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  expectedStatus: number;
  actualStatus: number;
  status: "pass" | "fail" | "skip";
  durationMs: number;
  error?: string;
  /** Optional body content for verification */
  hasValidBody?: boolean;
}

export interface SmokeTestOptions {
  baseUrl?: string;
  timeout?: number;
  methods?: ("GET" | "POST" | "PUT" | "DELETE")[];
  /** Cookie/header for authenticated requests */
  authCookie?: string;
  /** Whether to verify response body shape */
  strict?: boolean;
}

export interface TruthReport {
  state: TruthState;
  summary: string;
  passed: boolean;
}

export interface TestRunResult {
  passed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  durationMs: number;
  errors: string[];
}

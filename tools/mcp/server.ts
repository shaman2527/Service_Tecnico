import * as readline from "readline";
import { detectProject } from "../detector";
import { loadMemory } from "../memory/store";
import { findSkills, matchSkillsToProject } from "../skills/index";

interface JsonRpcRequest {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function respond(msg: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

const TOOLS = [
  {
    name: "harness_detect",
    description: "Detecta el stack tecnológico del proyecto (framework, lenguaje, DB, etc.)",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "harness_memory",
    description: "Lee el estado actual de la memoria persistente del harness (errores, convenciones, sesiones)",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "harness_skills",
    description: "Lista skills disponibles y su matching con el proyecto actual",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", async (line: string) => {
  let req: JsonRpcRequest;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }

  if (req.method === "initialize") {
    respond({
      jsonrpc: "2.0",
      id: req.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "harness-mcp", version: "2.0.0" },
      },
    });
  } else if (req.method === "tools/list") {
    respond({ jsonrpc: "2.0", id: req.id, result: { tools: TOOLS } });
  } else if (req.method === "tools/call") {
    const toolName = req.params?.name as string;
    try {
      let result: unknown;
      switch (toolName) {
        case "harness_detect": {
          result = detectProject();
          break;
        }
        case "harness_memory": {
          result = loadMemory();
          break;
        }
        case "harness_skills": {
          const skills = findSkills();
          const matched = matchSkillsToProject(skills);
          result = { total: skills.length, matches: matched.map(m => ({ name: m.skill.name, score: m.score, reason: m.reason })) };
          break;
        }
        default:
          respond({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `Tool not found: ${toolName}` } });
          return;
      }
      respond({ jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      respond({ jsonrpc: "2.0", id: req.id, error: { code: -32603, message: msg } });
    }
  } else if (req.method === "notifications/initialized") {
    // Ignore
  } else {
    respond({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `Method not found: ${req.method}` } });
  }
});

// Send initialized notification
process.stderr.write("🔌 Harness MCP server ready\n");

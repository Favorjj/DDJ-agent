#!/usr/bin/env node
/**
 * Demo MCP Server — Calculator
 * JSON-RPC 2.0 over stdio. Provides calculator + unit conversion tools.
 */

const TOOLS = [
  {
    name: "calculator",
    description: "Evaluate a math expression. Supports +, -, *, /, %, **, sqrt, sin, cos, abs, round, PI. Example: '2+3*4', 'sqrt(144)'",
    inputSchema: {
      type: "object",
      properties: {
        expression: { type: "string", description: "Expression to evaluate" },
      },
      required: ["expression"],
    },
  },
  {
    name: "unit_convert",
    description: "Convert between units: km/miles, kg/lb, celsius/fahrenheit, meters/feet, liters/gallons",
    inputSchema: {
      type: "object",
      properties: {
        value: { type: "number", description: "Value to convert" },
        from: { type: "string", description: "Source unit" },
        to: { type: "string", description: "Target unit" },
      },
      required: ["value", "from", "to"],
    },
  },
];

function safeEval(expr) {
  const sanitized = expr
    .replace(/sqrt\(/g, "Math.sqrt(")
    .replace(/sin\(/g, "Math.sin(")
    .replace(/cos\(/g, "Math.cos(")
    .replace(/abs\(/g, "Math.abs(")
    .replace(/round\(/g, "Math.round(")
    .replace(/PI/g, "Math.PI")
    .replace(/pi/gi, "Math.PI");
  const cleaned = sanitized.replace(/Math\.\w+/g, "");
  if (/[^0-9+\-*/().% Math.sqrtancospiabsroundEe]/.test(cleaned)) {
    throw new Error("Unsafe expression");
  }
  const result = Function('"use strict"; return (' + sanitized + ")")();
  if (typeof result !== "number" || !isFinite(result)) throw new Error("Invalid result");
  return result;
}

function convert(value, from, to) {
  const rates = {
    km: { miles: 0.621371 }, miles: { km: 1.60934 },
    kg: { lb: 2.20462 }, lb: { kg: 0.453592 },
    m: { ft: 3.28084 }, ft: { m: 0.3048 },
    l: { gal: 0.264172 }, gal: { l: 3.78541 },
  };
  if (from === "c" && to === "f") return value * 9 / 5 + 32;
  if (from === "f" && to === "c") return (value - 32) * 5 / 9;
  const rate = rates[from]?.[to];
  if (!rate) throw new Error("Unknown conversion: " + from + " -> " + to);
  return value * rate;
}

// JSON-RPC over stdio
let buf = "";
const listeners = [];
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  const lines = buf.split("\n");
  buf = lines.pop() || "";
  for (const line of lines) {
    if (line.trim()) listeners.forEach((fn) => fn(line));
  }
});

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
function sendError(id, code, msg) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message: msg } }) + "\n");
}

let initialized = false;
listeners.push((raw) => {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!msg || msg.jsonrpc !== "2.0" || msg.id === undefined) return;

  const id = msg.id;
  switch (msg.method) {
    case "initialize":
      respond(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "ddj-calc", version: "1.0.0" } });
      initialized = true;
      break;
    case "tools/list":
      respond(id, { tools: TOOLS });
      break;
    case "tools/call":
      try {
        const args = msg.params?.arguments || {};
        if (msg.params?.name === "calculator") {
          respond(id, { content: [{ type: "text", text: args.expression + " = " + safeEval(String(args.expression || "")) }] });
        } else if (msg.params?.name === "unit_convert") {
          const r = convert(Number(args.value), String(args.from), String(args.to));
          respond(id, { content: [{ type: "text", text: args.value + " " + args.from + " = " + r.toFixed(4) + " " + args.to }] });
        } else {
          sendError(id, -32601, "Unknown tool: " + msg.params?.name);
        }
      } catch (e) {
        respond(id, { content: [{ type: "text", text: "Error: " + e.message }], isError: true });
      }
      break;
    default:
      sendError(id, -32601, "Method not found: " + msg.method);
  }
});

process.stderr.write("DDJ Calculator MCP Server v1.0.0\n");

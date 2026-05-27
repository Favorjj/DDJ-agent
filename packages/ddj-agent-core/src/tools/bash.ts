/**
 * bash - Execute shell commands tool
 * Uses spawn for real-time stdout/stderr streaming.
 */

import { Type } from "typebox";
import type { AgentTool } from "../types.js";
import { spawn } from "node:child_process";

const MAX_STDOUT = 50 * 1024;  // 50KB
const MAX_STDERR = 10 * 1024;  // 10KB

export const bashTool: AgentTool = {
  name: "bash",
  description:
    "Execute a bash/shell command. Streams stdout and stderr in real-time. " +
    "For long-running commands, provide a timeout. " +
    "Output is limited to 50KB.",
  parameters: Type.Object({
    command: Type.String({ description: "Shell command to execute" }),
    timeout: Type.Optional(
      Type.Number({
        description: "Timeout in seconds (optional, default 300s)",
      })
    ),
    cwd: Type.Optional(
      Type.String({
        description: "Working directory (defaults to current working directory)",
      })
    ),
  }),
  async execute({ args, signal, onUpdate }) {
    const command = String(args.command || "");
    if (!command) {
      return { content: [{ type: "text", text: "Error: command is required" }] };
    }

    const timeout = (typeof args.timeout === "number" ? args.timeout : 300) * 1000;
    const cwd = args.cwd ? String(args.cwd) : undefined;

    return new Promise((resolve) => {
      const child = spawn(command, {
        shell: true,
        cwd,
        stdio: "pipe",
        windowsHide: true,
      });

      let stdoutBuf = "";
      let stderrBuf = "";
      let killed = false;

      child.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdoutBuf += text;
        if (stdoutBuf.length > MAX_STDOUT) {
          stdoutBuf = stdoutBuf.slice(0, MAX_STDOUT);
          if (!killed) {
            killed = true;
            child.kill();
          }
        }
        onUpdate?.({ type: "stdout", text });
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderrBuf += text;
        if (stderrBuf.length > MAX_STDERR) {
          stderrBuf = stderrBuf.slice(0, MAX_STDERR);
        }
        onUpdate?.({ type: "stderr", text });
      });

      const timer = setTimeout(() => {
        if (!killed) {
          killed = true;
          child.kill();
          resolve({
            content: [{
              type: "text",
              text: buildOutput(stdoutBuf, stderrBuf) + "\n[Command timed out]",
            }],
            details: { exitCode: null, timedOut: true },
          });
        }
      }, timeout);

      if (signal) {
        signal.addEventListener("abort", () => {
          if (!killed) {
            killed = true;
            child.kill();
            clearTimeout(timer);
            resolve({
              content: [{
                type: "text",
                text: buildOutput(stdoutBuf, stderrBuf) + "\n[Command aborted]",
              }],
              details: { exitCode: null, aborted: true },
            });
          }
        });
      }

      child.on("close", (code) => {
        clearTimeout(timer);
        if (killed && code !== null) return; // already handled by timeout/abort
        const output = buildOutput(stdoutBuf, stderrBuf);
        if (!output.trim()) {
          resolve({
            content: [{ type: "text", text: "Command completed successfully (no output)" }],
            details: { exitCode: code },
          });
        } else {
          const status = code !== 0 ? `\n[Exit code: ${code}]` : "";
          resolve({
            content: [{ type: "text", text: output + status }],
            details: { exitCode: code },
          });
        }
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          content: [{
            type: "text",
            text: `${err.message}\n${buildOutput(stdoutBuf, stderrBuf)}`,
          }],
          details: { error: err.message },
        });
      });
    });
  },
};

function buildOutput(stdout: string, stderr: string): string {
  const parts: string[] = [];
  if (stdout) {
    parts.push(stdout);
  }
  if (stderr) {
    parts.push(`STDERR:\n${stderr}`);
  }
  return parts.join("\n");
}

/**
 * bash - Execute shell commands tool
 */
import { Type } from "typebox";
import { exec } from "node:child_process";
import { promisify } from "node:util";
const execAsync = promisify(exec);
export const bashTool = {
    name: "bash",
    description: "Execute a bash/shell command. Returns stdout and stderr. " +
        "For long-running commands, provide a timeout. " +
        "Output is limited to 50KB.",
    parameters: Type.Object({
        command: Type.String({ description: "Shell command to execute" }),
        timeout: Type.Optional(Type.Number({
            description: "Timeout in seconds (optional, no default timeout)",
        })),
        cwd: Type.Optional(Type.String({
            description: "Working directory (defaults to current working directory)",
        })),
    }),
    async execute({ args, signal }) {
        const command = String(args.command || "");
        if (!command) {
            return { content: [{ type: "text", text: "Error: command is required" }] };
        }
        try {
            const timeout = typeof args.timeout === "number" ? args.timeout * 1000 : undefined;
            const cwd = args.cwd ? String(args.cwd) : undefined;
            const { stdout, stderr } = await execAsync(command, {
                timeout,
                cwd,
                maxBuffer: 50 * 1024,
                signal,
            });
            const outputParts = [];
            if (stdout) {
                // Truncate if too long
                const truncated = stdout.length > 50 * 1024
                    ? stdout.slice(0, 50 * 1024) + "\n... (output truncated, exceeded 50KB)"
                    : stdout;
                outputParts.push(truncated);
            }
            if (stderr) {
                const truncated = stderr.length > 10 * 1024
                    ? stderr.slice(0, 10 * 1024) + "\n... (stderr truncated)"
                    : stderr;
                outputParts.push(`STDERR:\n${truncated}`);
            }
            if (outputParts.length === 0) {
                return {
                    content: [{ type: "text", text: "Command completed successfully (no output)" }],
                };
            }
            return {
                content: [{ type: "text", text: outputParts.join("\n") }],
            };
        }
        catch (err) {
            const error = err;
            const outputParts = [];
            if (error.stdout) {
                outputParts.push(error.stdout);
            }
            if (error.stderr) {
                outputParts.push(`STDERR:\n${error.stderr}`);
            }
            const exitCode = error.code !== undefined ? `Exit code: ${error.code}` : "";
            const errorMsg = error.message?.split("\n")[0] || "Unknown error";
            return {
                content: [
                    {
                        type: "text",
                        text: [errorMsg, exitCode, ...outputParts].filter(Boolean).join("\n"),
                    },
                ],
            };
        }
    },
};
//# sourceMappingURL=bash.js.map
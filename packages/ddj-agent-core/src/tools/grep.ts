/**
 * grep - Content search tool
 * Searches file contents with regex, returns matching lines with context.
 */

import { Type } from "typebox";
import type { AgentTool } from "../types.js";
import * as fs from "node:fs";
import * as path from "node:path";

interface Match {
  file: string;
  line: number;
  content: string;
}

function walkDir(dir: string, globFilter?: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(entry.parentPath || dir, entry.name);
    // Skip node_modules, dist, .git
    if (fullPath.includes("node_modules") || fullPath.includes("/dist/") || fullPath.includes(".git")) continue;
    if (globFilter) {
      // Simple glob: **/*.ts → ends with .ts, src/** → starts with src/
      if (globFilter.startsWith("**/")) {
        const ext = globFilter.slice(3);
        if (!entry.name.endsWith(ext)) continue;
      } else {
        if (!fullPath.includes(globFilter.replace(/^\*\*\/?/, ""))) continue;
      }
    }
    results.push(fullPath);
  }
  return results;
}

export const grepTool: AgentTool = {
  name: "grep",
  description:
    "Search file contents with a regular expression. Returns matching lines with file path and line number. " +
    "Use for finding code patterns, function definitions, strings, etc. " +
    "Example patterns: 'function\\s+\\w+', 'TODO', 'import.*from'.",
  parameters: Type.Object({
    pattern: Type.String({ description: "Regular expression pattern to search for" }),
    path: Type.Optional(
      Type.String({ description: "File or directory to search in (defaults to current working directory)" })
    ),
    include: Type.Optional(
      Type.String({ description: "Glob pattern to filter files (e.g. '*.ts', '*.json')" })
    ),
  }),
  async execute({ args }) {
    const pattern = String(args.pattern || "");
    if (!pattern) {
      return { content: [{ type: "text", text: "Error: pattern is required" }] };
    }

    const searchPath = args.path ? String(args.path) : process.cwd();
    const include = args.include ? String(args.include) : undefined;

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, "g");
    } catch {
      return {
        content: [{ type: "text", text: `Error: invalid regex pattern "${pattern}"` }],
      };
    }

    try {
      const stat = fs.statSync(searchPath);
      let files: string[] = [];

      if (stat.isFile()) {
        files = [searchPath];
      } else if (stat.isDirectory()) {
        files = walkDir(searchPath, include);
      } else {
        return { content: [{ type: "text", text: `Error: ${searchPath} is not a file or directory` }] };
      }

      const matches: Match[] = [];
      const MAX_MATCHES = 500;

      for (const file of files) {
        if (matches.length >= MAX_MATCHES) break;

        try {
          const content = fs.readFileSync(file, "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= MAX_MATCHES) break;
            regex.lastIndex = 0;
            if (regex.test(lines[i])) {
              matches.push({ file, line: i + 1, content: lines[i].trim() });
            }
          }
        } catch {
          // Skip unreadable files
        }
      }

      if (matches.length === 0) {
        return {
          content: [{ type: "text", text: `No matches for "${pattern}" in ${searchPath}` }],
        };
      }

      const output = matches
        .map((m) => `${m.file}:${m.line}: ${m.content}`)
        .join("\n");

      const truncated = matches.length >= MAX_MATCHES ? `\n... (results truncated at ${MAX_MATCHES} matches)` : "";

      return {
        content: [
          {
            type: "text",
            text: `Found ${matches.length} match(es) for "${pattern}" in ${searchPath}:\n\n${output}${truncated}`,
          },
        ],
        details: { count: matches.length, truncated: matches.length >= MAX_MATCHES },
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error searching: ${(err as Error).message}` }],
      };
    }
  },
};

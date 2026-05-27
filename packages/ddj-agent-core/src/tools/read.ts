/**
 * read - Read file content tool
 */

import { Type } from "typebox";
import type { AgentTool } from "../types.js";
import { readFile } from "node:fs/promises";

export const readTool: AgentTool = {
  name: "read",
  description: "Read the contents of a file. Returns the file content as text. Handles text files up to 50KB.",
  parameters: Type.Object({
    path: Type.String({ description: "File path to read (relative or absolute)" }),
    offset: Type.Optional(
      Type.Number({ description: "Line number to start reading from (1-indexed)" })
    ),
    limit: Type.Optional(
      Type.Number({ description: "Maximum number of lines to return" })
    ),
  }),
  async execute({ args }) {
    const filePath = String(args.path || "");
    if (!filePath) {
      return { content: [{ type: "text", text: "Error: path is required" }] };
    }

    try {
      const content = await readFile(filePath, "utf-8");
      const lines = content.split("\n");
      const offset = typeof args.offset === "number" ? Math.max(0, args.offset - 1) : 0;
      const limit = typeof args.limit === "number" ? args.limit : lines.length;

      const selected = lines.slice(offset, offset + limit);
      const result = selected.join("\n");

      const lineInfo = `File: ${filePath}\nTotal lines: ${lines.length}\nShowing lines ${offset + 1}-${Math.min(offset + limit, lines.length)}\n\n`;

      return {
        content: [{ type: "text", text: lineInfo + result }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error reading ${filePath}: ${(err as Error).message}` }],
      };
    }
  },
};

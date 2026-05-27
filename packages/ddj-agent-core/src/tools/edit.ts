/**
 * edit - Edit file content using search/replace tool
 */

import { Type } from "typebox";
import type { AgentTool } from "../types.js";
import { readFile, writeFile } from "node:fs/promises";

export const editTool: AgentTool = {
  name: "edit",
  description:
    "Edit a file by replacing exact text. Each edit finds unique text in the file and replaces it. " +
    "Use multiple edits for changes in different parts of the same file. " +
    "The edits are applied sequentially against the original file content.",
  parameters: Type.Object({
    path: Type.String({ description: "File path to edit (relative or absolute)" }),
    edits: Type.Array(
      Type.Object({
        oldText: Type.String({ description: "Exact text to find (must be unique in the file)" }),
        newText: Type.String({ description: "Replacement text" }),
      }),
      { description: "One or more search/replace edits" }
    ),
  }),
  async execute({ args }) {
    const filePath = String(args.path || "");
    const edits = args.edits as Array<{ oldText: string; newText: string }> | undefined;

    if (!filePath) {
      return { content: [{ type: "text", text: "Error: path is required" }] };
    }

    if (!edits || edits.length === 0) {
      return { content: [{ type: "text", text: "Error: at least one edit is required" }] };
    }

    try {
      const original = await readFile(filePath, "utf-8");

      // Verify all oldTexts are unique
      for (const edit of edits) {
        const occurrences = original.split(edit.oldText).length - 1;
        if (occurrences === 0) {
          return {
            content: [
              {
                type: "text",
                text: `Error: text not found in ${filePath}:\n\`\`\`\n${edit.oldText}\n\`\`\`\n\nMake sure you include exact whitespace and characters.`,
              },
            ],
          };
        }
        if (occurrences > 1) {
          return {
            content: [
              {
                type: "text",
                text: `Error: text found ${occurrences} times in ${filePath}. Each edit target must be unique.\n\`\`\`\n${edit.oldText}\n\`\`\`\n\nInclude more context (surrounding lines) to make it unique.`,
              },
            ],
          };
        }
      }

      // Apply all edits against the original file (not incrementally)
      let result = original;
      for (const edit of edits) {
        // Double-check uniqueness in current content
        const currentOccurrences = result.split(edit.oldText).length - 1;
        if (currentOccurrences === 0) {
          return {
            content: [
              {
                type: "text",
                text: `Error after applying previous edits: text not found in current content of ${filePath}.\n\`\`\`\n${edit.oldText}\n\`\`\``,
              },
            ],
          };
        }
        if (currentOccurrences > 1) {
          return {
            content: [
              {
                type: "text",
                text: `Error after applying previous edits: text found ${currentOccurrences} times in ${filePath}.\n\`\`\`\n${edit.oldText}\n\`\`\``,
              },
            ],
          };
        }
        result = result.replace(edit.oldText, edit.newText);
      }

      await writeFile(filePath, result, "utf-8");

      const totalChanges = edits.length;
      const totalDiff = result.length - original.length;

      return {
        content: [
          {
            type: "text",
            text: `Successfully applied ${totalChanges} edit(s) to ${filePath} (${totalDiff >= 0 ? "+" : ""}${totalDiff} bytes)`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error editing ${filePath}: ${(err as Error).message}` }],
      };
    }
  },
};

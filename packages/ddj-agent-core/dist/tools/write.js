/**
 * write - Write file content tool
 */
import { Type } from "typebox";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
export const writeTool = {
    name: "write",
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    parameters: Type.Object({
        path: Type.String({ description: "File path to write (relative or absolute)" }),
        content: Type.String({ description: "Content to write to the file" }),
    }),
    async execute({ args }) {
        const filePath = String(args.path || "");
        const content = String(args.content || "");
        if (!filePath) {
            return { content: [{ type: "text", text: "Error: path is required" }] };
        }
        try {
            await mkdir(dirname(filePath), { recursive: true });
            await writeFile(filePath, content, "utf-8");
            return {
                content: [
                    {
                        type: "text",
                        text: `Successfully wrote ${content.length} bytes to ${filePath}`,
                    },
                ],
            };
        }
        catch (err) {
            return {
                content: [{ type: "text", text: `Error writing to ${filePath}: ${err.message}` }],
            };
        }
    },
};
//# sourceMappingURL=write.js.map
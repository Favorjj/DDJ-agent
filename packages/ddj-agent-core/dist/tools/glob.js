/**
 * glob - File pattern matching tool
 * Finds files matching a glob pattern using Node.js fs.
 */
import { Type } from "typebox";
import * as fs from "node:fs";
import * as path from "node:path";
function globSync(pattern, baseDir) {
    const results = [];
    // Simple glob: treat as substring match if no wildcards, otherwise handle * and **
    const hasWildcards = pattern.includes("*");
    const segments = pattern.split("/");
    function walk(dir, segIdx) {
        if (segIdx >= segments.length)
            return;
        const seg = segments[segIdx];
        const isLast = segIdx === segments.length - 1;
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            // Skip hidden files and node_modules
            if (entry.name.startsWith(".") || entry.name === "node_modules")
                continue;
            const fullPath = path.join(dir, entry.name);
            if (isLast) {
                if (matchSegment(entry.name, seg)) {
                    results.push(fullPath);
                }
            }
            else {
                if (seg === "**") {
                    // ** matches any depth
                    if (entry.isDirectory()) {
                        // Match rest of pattern from here
                        walk(fullPath, segIdx + 1);
                        // Also continue ** at current level
                        walk(fullPath, segIdx);
                    }
                }
                else if (matchSegment(entry.name, seg) && entry.isDirectory()) {
                    walk(fullPath, segIdx + 1);
                }
            }
        }
    }
    walk(baseDir, 0);
    return results;
}
function matchSegment(name, pattern) {
    // Convert glob segment to regex
    const re = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".");
    return new RegExp(`^${re}$`, "i").test(name);
}
export const globTool = {
    name: "glob",
    description: "Find files matching a glob pattern. Returns file paths sorted by modification time (newest first). " +
        "Use this to locate files by name pattern. Examples: '**/*.ts', 'src/**/*.json', '*.md'.",
    parameters: Type.Object({
        pattern: Type.String({ description: "Glob pattern to match file names (e.g. '**/*.ts', 'src/*.json')" }),
        path: Type.Optional(Type.String({ description: "Directory to search in (defaults to current working directory)" })),
    }),
    async execute({ args }) {
        const pattern = String(args.pattern || "");
        if (!pattern) {
            return { content: [{ type: "text", text: "Error: pattern is required" }] };
        }
        const baseDir = args.path ? String(args.path) : process.cwd();
        try {
            const results = globSync(pattern, baseDir);
            // Sort by modification time (newest first)
            results.sort((a, b) => {
                try {
                    return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
                }
                catch {
                    return 0;
                }
            });
            if (results.length === 0) {
                return {
                    content: [{ type: "text", text: `No files matched pattern "${pattern}" in ${baseDir}` }],
                };
            }
            const limited = results.slice(0, 200);
            const summary = `Found ${results.length} file(s) matching "${pattern}" in ${baseDir}` +
                (results.length > 200 ? ` (showing first 200)` : "") + `:\n\n`;
            return {
                content: [{ type: "text", text: summary + limited.join("\n") }],
                details: { count: results.length, truncated: results.length > 200 },
            };
        }
        catch (err) {
            return {
                content: [{ type: "text", text: `Error searching with glob "${pattern}": ${err.message}` }],
            };
        }
    },
};
//# sourceMappingURL=glob.js.map
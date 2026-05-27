/**
 * Built-in tools for coding agent
 */

import type { AgentTool } from "../types.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";
import { editTool } from "./edit.js";
import { bashTool } from "./bash.js";

export const builtinTools: AgentTool[] = [
  readTool,
  writeTool,
  editTool,
  bashTool,
];

export { readTool } from "./read.js";
export { writeTool } from "./write.js";
export { editTool } from "./edit.js";
export { bashTool } from "./bash.js";

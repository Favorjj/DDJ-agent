/**
 * webfetch - Fetch web content tool
 */

import { Type } from "typebox";
import type { AgentTool } from "../types.js";

export const webfetchTool: AgentTool = {
  name: "webfetch",
  description:
    "Fetch content from a URL and process into markdown. " +
    "Use for reading documentation, checking API references, fetching web pages. " +
    "Returns the page content as text (limited to 50KB).",
  parameters: Type.Object({
    url: Type.String({ description: "URL to fetch (must be http:// or https://)" }),
    maxLength: Type.Optional(
      Type.Number({ description: "Maximum content length in bytes (default 50000)" })
    ),
  }),
  async execute({ args }) {
    const url = String(args.url || "");
    if (!url) {
      return { content: [{ type: "text", text: "Error: url is required" }] };
    }

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return { content: [{ type: "text", text: "Error: URL must start with http:// or https://" }] };
    }

    const maxLen = typeof args.maxLength === "number" ? args.maxLength : 50_000;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "DDJ-Agent/1.0",
          "Accept": "text/html,text/plain,application/json",
        },
      });
      clearTimeout(timer);

      if (!response.ok) {
        return {
          content: [{
            type: "text",
            text: `HTTP ${response.status}: ${response.statusText}`,
          }],
          details: { status: response.status },
        };
      }

      const contentType = response.headers.get("content-type") || "";
      let text = await response.text();

      // Strip HTML tags for readability (simple approach)
      if (contentType.includes("html") || text.includes("<html")) {
        text = text
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&nbsp;/g, " ")
          .replace(/\s+/g, " ")
          .replace(/\n\s*\n/g, "\n")
          .trim();
      }

      if (text.length > maxLen) {
        text = text.slice(0, maxLen) + `\n\n... (truncated at ${maxLen} bytes, original length: ${text.length})`;
      }

      return {
        content: [{ type: "text", text }],
        details: { status: response.status, contentType, length: text.length },
      };
    } catch (err) {
      const msg = (err as Error).name === "AbortError"
        ? "Request timed out after 15s"
        : `Error fetching ${url}: ${(err as Error).message}`;
      return { content: [{ type: "text", text: msg }] };
    }
  },
};

#!/usr/bin/env node
/**
 * MCP Server — Word Document Generator (.docx)
 * Zero dependencies, uses Node.js built-ins to create valid .docx files.
 *
 * A .docx file is a ZIP containing:
 *   [Content_Types].xml
 *   _rels/.rels
 *   word/document.xml
 */

const zlib = require("zlib");
const path = require("path");
const fs = require("fs");

// ---- Minimal ZIP creator ----

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function localFileHeader(name, compressed, originalSize, crc) {
  const nameBuf = Buffer.from(name, "utf-8");
  const h = Buffer.alloc(30 + nameBuf.length);
  h.writeUInt32LE(0x04034b50, 0);   // signature
  h.writeUInt16LE(20, 4);           // version
  h.writeUInt16LE(0, 6);            // flags
  h.writeUInt16LE(8, 8);            // compression (8=deflate)
  h.writeUInt16LE(0, 10);           // mod time
  h.writeUInt16LE(0, 12);           // mod date
  h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(compressed.length, 18);
  h.writeUInt32LE(originalSize, 22);
  h.writeUInt16LE(nameBuf.length, 26);
  h.writeUInt16LE(0, 28);           // extra field length
  nameBuf.copy(h, 30);
  return h;
}

function centralDirEntry(name, compressed, originalSize, crc, offset) {
  const nameBuf = Buffer.from(name, "utf-8");
  const h = Buffer.alloc(46 + nameBuf.length);
  h.writeUInt32LE(0x02014b50, 0);   // signature
  h.writeUInt16LE(20, 4);
  h.writeUInt16LE(20, 6);
  h.writeUInt16LE(0, 8);            // flags
  h.writeUInt16LE(8, 10);           // compression
  h.writeUInt16LE(0, 12);
  h.writeUInt16LE(0, 14);
  h.writeUInt32LE(crc, 16);
  h.writeUInt32LE(compressed.length, 20);
  h.writeUInt32LE(originalSize, 24);
  h.writeUInt16LE(nameBuf.length, 28);
  h.writeUInt16LE(0, 30);           // extra
  h.writeUInt16LE(0, 32);           // comment
  h.writeUInt16LE(0, 34);           // disk
  h.writeUInt16LE(0, 36);           // internal attrs
  h.writeUInt32LE(0, 38);           // external attrs
  h.writeUInt32LE(offset, 42);
  nameBuf.copy(h, 46);
  return h;
}

function eocd(entries, cdSize, cdOffset) {
  const h = Buffer.alloc(22);
  h.writeUInt32LE(0x06054b50, 0);
  h.writeUInt16LE(0, 4);
  h.writeUInt16LE(0, 6);
  h.writeUInt16LE(entries, 8);
  h.writeUInt16LE(entries, 10);
  h.writeUInt32LE(cdSize, 12);
  h.writeUInt32LE(cdOffset, 16);
  h.writeUInt16LE(0, 20);
  return h;
}

function createZip(files) {
  const buffers = [];
  const entries = [];
  let offset = 0;

  for (const { name, data } of files) {
    const raw = Buffer.from(data, "utf-8");
    const compressed = zlib.deflateRawSync(raw);
    const crc = crc32(raw);

    const lfh = localFileHeader(name, compressed, raw.length, crc);
    buffers.push(lfh, compressed);
    entries.push({ name, compressed, originalSize: raw.length, crc, offset });
    offset += lfh.length + compressed.length;
  }

  // Central directory
  const cdParts = [];
  for (const e of entries) {
    cdParts.push(centralDirEntry(e.name, e.compressed, e.originalSize, e.crc, e.offset));
  }
  const cd = Buffer.concat(cdParts);
  buffers.push(cd, eocd(entries.length, cd.length, offset));

  return Buffer.concat(buffers);
}

// ---- Word document XML ----

function escapeXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildDocumentXML(title, content) {
  const titleEsc = escapeXml(title);
  // Convert content lines to paragraphs
  const paragraphs = content.split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return '<w:p><w:pPr><w:rPr/></w:pPr></w:p>';
    if (trimmed.startsWith("## ")) {
      return `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:rPr/><w:t xml:space="preserve">${escapeXml(trimmed.slice(3))}</w:t></w:r></w:p>`;
    }
    if (trimmed.startsWith("# ")) {
      return `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr/><w:t xml:space="preserve">${escapeXml(trimmed.slice(2))}</w:t></w:r></w:p>`;
    }
    if (trimmed.startsWith("- ")) {
      return `<w:p><w:pPr><w:pStyle w:val="ListBullet"/></w:pPr><w:r><w:rPr/><w:t xml:space="preserve">${escapeXml(trimmed.slice(2))}</w:t></w:r></w:p>`;
    }
    return `<w:p><w:r><w:rPr/><w:t xml:space="preserve">${escapeXml(trimmed)}</w:t></w:r></w:p>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:rPr/><w:t xml:space="preserve">${titleEsc}</w:t></w:r></w:p>
    ${paragraphs}
  </w:body>
</w:document>`;
}

function buildDocx(title, content) {
  const docXml = buildDocumentXML(title, content);

  const files = [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    },
    {
      name: "word/document.xml",
      data: docXml,
    },
  ];

  return createZip(files);
}

// ---- MCP Server ----

const TOOLS = [
  {
    name: "create_docx",
    description: "Create a .docx Word document. Supports markdown-like formatting: # Heading1, ## Heading2, - bullet list. Returns the file path of the created document.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Document title (appears as heading at top)" },
        content: { type: "string", description: "Document body. Use # for headings, ## for sub-headings, - for bullet points. Plain text for normal paragraphs." },
        filename: { type: "string", description: "Output filename (e.g. 'report.docx'). Saved to current directory unless path is specified." },
      },
      required: ["title", "content", "filename"],
    },
  },
];

// JSON-RPC
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
      respond(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "ddj-docx", version: "1.0.0" } });
      initialized = true;
      break;
    case "tools/list":
      respond(id, { tools: TOOLS });
      break;
    case "tools/call": {
      try {
        const args = msg.params?.arguments || {};
        if (msg.params?.name === "create_docx") {
          const title = String(args.title || "");
          const content = String(args.content || "");
          const filename = String(args.filename || "document.docx");

          if (!title || !content) throw new Error("title and content are required");

          const docxBuf = buildDocx(title, content);
          const outPath = path.resolve(process.cwd(), filename);
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, docxBuf);

          respond(id, {
            content: [{ type: "text", text: `Document created: ${outPath}\nTitle: ${title}\nSize: ${(docxBuf.length / 1024).toFixed(1)}KB\nParagraphs: ${content.split("\\n").filter(l => l.trim()).length}` }],
          });
        } else {
          sendError(id, -32601, "Unknown tool: " + msg.params?.name);
        }
      } catch (e) {
        respond(id, { content: [{ type: "text", text: "Error: " + e.message }], isError: true });
      }
      break;
    }
    default:
      sendError(id, -32601, "Method not found: " + msg.method);
  }
});

process.stderr.write("DDJ Docx MCP Server v1.0.0\n");

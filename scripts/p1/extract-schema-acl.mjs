#!/usr/bin/env node

import { readFileSync } from "node:fs";

const [inputPath] = process.argv.slice(2);
if (!inputPath) {
  throw new Error("Usage: node extract-schema-acl.mjs <normalized-schema.sql>");
}

const lines = readFileSync(inputPath, "utf8")
  .replaceAll("\r\n", "\n")
  .replaceAll("\r", "\n")
  .split("\n");

const objectStarts = [];
for (let index = 0; index < lines.length - 1; index += 1) {
  if (lines[index] === "--" && lines[index + 1].startsWith("-- Name: ")) {
    objectStarts.push(index);
  }
}

const aclBlocks = [];
for (let index = 0; index < objectStarts.length; index += 1) {
  const start = objectStarts[index];
  const end = objectStarts[index + 1] ?? lines.length;
  const header = lines[start + 1];
  if (
    header.includes("; Type: ACL;") ||
    header.includes("; Type: DEFAULT ACL;")
  ) {
    aclBlocks.push(lines.slice(start, end).join("\n").trimEnd());
  }
}

process.stdout.write(`${aclBlocks.join("\n\n")}\n`);

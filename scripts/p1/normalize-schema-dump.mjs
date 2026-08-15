#!/usr/bin/env node

import { readFileSync } from "node:fs";

const [inputPath] = process.argv.slice(2);
if (!inputPath) {
  throw new Error("Usage: node normalize-schema-dump.mjs <schema.sql>");
}

const ignored = [
  /^-- PostgreSQL database dump/u,
  /^-- Dumped from database version/u,
  /^-- Dumped by pg_dump version/u,
  /^\\(un)?restrict\b/u,
  /^SET transaction_timeout = /u,
];

const normalized = readFileSync(inputPath, "utf8")
  .replaceAll("\r\n", "\n")
  .replaceAll("\r", "\n")
  .split("\n")
  .filter((line) => !ignored.some((pattern) => pattern.test(line)))
  .join("\n")
  .replace(/\n{3,}/gu, "\n\n")
  .trimEnd();

process.stdout.write(`${normalized}\n`);

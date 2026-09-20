import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
const rootPath = fileURLToPath(root);
const readJson = path => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const packageJson = readJson("package.json");
const lock = readJson("package-lock.json");
const packages = lock.packages;
const fail = message => { throw new Error(message); };

const expected = {
  transformers: "4.2.0",
  onnxWeb: "1.26.0-dev.20260416-b7804b056c",
  onnxNode: "1.24.3",
  admZip: "0.6.1",
  sharp: "0.35.4",
};

if (packageJson.dependencies?.["@huggingface/transformers"] !== expected.transformers) fail("Transformers baseline changed");
if (packageJson.overrides?.["adm-zip"] !== expected.admZip || packageJson.overrides?.sharp !== expected.sharp) {
  fail("Phase 2 security overrides changed");
}
for (const [name, path, version] of [
  ["Transformers", "node_modules/@huggingface/transformers", expected.transformers],
  ["ONNX Runtime Web", "node_modules/onnxruntime-web", expected.onnxWeb],
  ["ONNX Runtime Node", "node_modules/onnxruntime-node", expected.onnxNode],
  ["adm-zip", "node_modules/adm-zip", expected.admZip],
  ["sharp", "node_modules/sharp", expected.sharp],
]) {
  if (packages[path]?.version !== version) fail(`${name} lockfile version changed`);
}
if (packages["node_modules/@huggingface/transformers/node_modules/sharp"]) fail("Vulnerable nested Transformers sharp remains installed");
for (const [path, entry] of Object.entries(packages)) {
  if (path.endsWith("/adm-zip") && entry.version !== expected.admZip) fail(`Unexpected adm-zip at ${path}`);
  if (path.endsWith("/sharp") && entry.version !== expected.sharp) fail(`Unexpected sharp at ${path}`);
}

const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? walk(path) : [path];
});
const sourceRoot = fileURLToPath(new URL("app/", root));
const transformerImports = walk(sourceRoot).filter(path => [".ts", ".tsx"].includes(extname(path)))
  .filter(path => readFileSync(path, "utf8").includes('from "@huggingface/transformers"'))
  .map(path => relative(rootPath, path).replaceAll("\\", "/"));
if (transformerImports.length !== 1 || transformerImports[0] !== "app/_lib/local-ai/workers/ner.worker.ts") {
  fail(`Transformers import escaped the NER Worker: ${transformerImports.join(", ")}`);
}

const transformerManifest = readJson("node_modules/@huggingface/transformers/package.json");
if (transformerManifest.exports?.default?.default !== "./dist/transformers.web.js") fail("Browser export changed");
const browserBundle = readFileSync(new URL("node_modules/@huggingface/transformers/dist/transformers.web.js", root), "utf8");
for (const marker of ["ignore-modules:onnxruntime-node", "ignore-modules:sharp", 'from "onnxruntime-web/webgpu"']) {
  if (!browserBundle.includes(marker)) fail(`Transformers browser boundary marker missing: ${marker}`);
}

if (process.argv.includes("--build")) {
  const buildRoot = fileURLToPath(new URL(".next/", root));
  if (!existsSync(buildRoot)) fail("Production build is missing");
  const staticFiles = walk(join(buildRoot, "static")).filter(path => extname(path) === ".js");
  const serverFiles = walk(join(buildRoot, "server")).filter(path => [".js", ".json"].includes(extname(path)));
  const emitted = [...staticFiles, ...serverFiles];
  if (!staticFiles.some(path => readFileSync(path, "utf8").includes("onnxruntime-web"))) fail("ONNX Runtime Web was not emitted");
  for (const marker of ["onnxruntime-node", "adm-zip", "extractEntryTo", "@huggingface/transformers/node_modules/sharp", "libvips"]) {
    const hit = emitted.find(path => readFileSync(path, "utf8").includes(marker));
    if (hit) fail(`Node-only dependency marker '${marker}' emitted in ${relative(rootPath, hit)}`);
  }
}

console.log(`Phase 2 dependency boundary verified${process.argv.includes("--build") ? " against the production build" : ""}.`);

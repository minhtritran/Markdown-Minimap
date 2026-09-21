import { readFile } from "node:fs/promises";

const requiredFiles = [
  "src/main.ts",
  "main.js",
  "manifest.json",
  "styles.css",
  "versions.json",
];

for (const file of requiredFiles) {
  await readFile(file, "utf8");
}

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const versions = JSON.parse(await readFile("versions.json", "utf8"));

const expected = {
  id: "source-minimap",
  name: "Source Minimap",
  packageName: "source-minimap",
};

if (manifest.id !== expected.id) {
  throw new Error(`manifest.json id must be ${expected.id}`);
}

if (manifest.name !== expected.name) {
  throw new Error(`manifest.json name must be ${expected.name}`);
}

if (packageJson.name !== expected.packageName) {
  throw new Error(`package.json name must be ${expected.packageName}`);
}

if (packageJson.version !== manifest.version) {
  throw new Error("package.json version must match manifest.json version");
}

if (!versions[manifest.version]) {
  throw new Error("versions.json must include the manifest version");
}

const mainJs = await readFile("main.js", "utf8");
const css = await readFile("styles.css", "utf8");
if (css.includes(".minimap-") || css.includes("--minimap-") ||
    mainJs.includes("markdown-minimap:disabled") || mainJs.includes('".minimap-')) {
  throw new Error("Source Minimap must not reuse the original plugin's CSS or device preference namespace");
}
if (mainJs.includes('disablePlugin("minimap")') || mainJs.includes('enablePlugin("minimap")')) {
  throw new Error("main.js still references the upstream minimap plugin id");
}

console.log("Source Minimap plugin files are valid.");

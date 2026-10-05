#!/usr/bin/env node
// Sets the app version everywhere it lives: package.json (tauri.conf.json reads it) and
// src-tauri/Cargo.toml, then refreshes Cargo.lock. Usage: node scripts/bump-version.mjs 0.2.0
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("usage: node scripts/bump-version.mjs <major.minor.patch[-pre]>");
  process.exit(1);
}

const root = fileURLToPath(new URL("..", import.meta.url));

const pkgPath = `${root}package.json`;
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.version = version;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

const cargoPath = `${root}src-tauri/Cargo.toml`;
const cargo = readFileSync(cargoPath, "utf8");
const bumped = cargo.replace(/^(version\s*=\s*)"[^"]+"/m, `$1"${version}"`);
if (bumped === cargo) {
  console.error('no `version = "…"` line found in src-tauri/Cargo.toml');
  process.exit(1);
}
writeFileSync(cargoPath, bumped);

execFileSync(
  "cargo",
  ["update", "--workspace", "--offline", "--manifest-path", `${root}src-tauri/Cargo.toml`],
  { stdio: "inherit" },
);
console.log(`version ${version} set in package.json, src-tauri/Cargo.toml and Cargo.lock`);

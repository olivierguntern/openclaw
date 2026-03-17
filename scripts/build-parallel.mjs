#!/usr/bin/env node
/**
 * Parallel build script that speeds up the standard `pnpm build` by running
 * independent phases concurrently.
 *
 * Phase 1 (parallel):   canvas:a2ui:bundle  +  tsdown TypeScript compile
 * Phase 2 (parallel):   runtime-postbuild   +  plugin-sdk DTS generation
 * Phase 3 (parallel):   all post-processing copy/write scripts
 *
 * Each phase waits for the previous one to complete before starting.
 */

import { spawnSync, spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const pnpm = isWindows ? "pnpm.cmd" : "pnpm";

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: isWindows,
      ...opts,
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command "${cmd} ${args.join(" ")}" exited with code ${code}`));
      }
    });
    child.on("error", reject);
  });
}

function runNode(scriptPath) {
  return run(process.execPath, [scriptPath]);
}

function runNodeTsx(scriptPath) {
  return run(process.execPath, ["--import", "tsx", scriptPath]);
}

function runPnpm(...args) {
  return run(pnpm, args);
}

async function runPhase(label, tasks) {
  console.log(`\n[build-parallel] Starting phase: ${label}`);
  const start = Date.now();
  await Promise.all(tasks);
  console.log(`[build-parallel] Finished phase: ${label} (${Date.now() - start}ms)`);
}

async function main() {
  const buildStart = Date.now();

  // Phase 1: canvas bundle + TypeScript compile (independent of each other)
  await runPhase("1 — canvas bundle + tsdown", [
    runPnpm("canvas:a2ui:bundle"),
    runNode("scripts/tsdown-build.mjs"),
  ]);

  // Phase 2: runtime post-build (needs dist) + plugin SDK DTS (independent)
  await runPhase("2 — runtime-postbuild + plugin-sdk:dts", [
    runNode("scripts/runtime-postbuild.mjs"),
    runPnpm("build:plugin-sdk:dts"),
  ]);

  // Phase 3: all independent post-processing scripts
  await runPhase("3 — post-processing scripts", [
    runNodeTsx("scripts/write-plugin-sdk-entry-dts.ts"),
    runNodeTsx("scripts/canvas-a2ui-copy.ts"),
    runNodeTsx("scripts/copy-hook-metadata.ts"),
    runNodeTsx("scripts/copy-export-html-templates.ts"),
    runNodeTsx("scripts/write-build-info.ts"),
    runNodeTsx("scripts/write-cli-startup-metadata.ts"),
    runNodeTsx("scripts/write-cli-compat.ts"),
  ]);

  console.log(`\n[build-parallel] Build complete in ${Date.now() - buildStart}ms`);
}

main().catch((err) => {
  console.error(`[build-parallel] Build failed: ${err.message}`);
  process.exit(1);
});

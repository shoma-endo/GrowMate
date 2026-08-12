#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { realpathSync } from 'node:fs';
import { sanitizeClaudePrompt } from './prompt-sanitizer.mjs';

function resolveTaktRoot() {
  const configuredPath = process.env.GROWMATE_TAKT_CLI;
  const cliPath = configuredPath ?? execFileSync('which', ['takt'], { encoding: 'utf8' }).trim();
  const resolvedCliPath = realpathSync(cliPath);
  return dirname(dirname(resolvedCliPath));
}

function patchBuilder(module, className) {
  const Builder = module[className];
  if (!Builder || Builder.prototype.__growmateReportContextPatched) {
    return;
  }

  const originalBuild = Builder.prototype.build;
  Builder.prototype.build = function buildWithoutReportContext(...args) {
    return sanitizeClaudePrompt(originalBuild.apply(this, args));
  };
  Builder.prototype.__growmateReportContextPatched = true;
}

async function main() {
  const taktRoot = resolveTaktRoot();
  const instructionModule = await import(
    pathToFileURL(join(taktRoot, 'dist/core/workflow/instruction/InstructionBuilder.js')).href,
  );
  const reportInstructionModule = await import(
    pathToFileURL(join(taktRoot, 'dist/core/workflow/instruction/ReportInstructionBuilder.js')).href,
  );

  patchBuilder(instructionModule, 'InstructionBuilder');
  patchBuilder(reportInstructionModule, 'ReportInstructionBuilder');

  await import(pathToFileURL(join(taktRoot, 'dist/app/cli/index.js')).href);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

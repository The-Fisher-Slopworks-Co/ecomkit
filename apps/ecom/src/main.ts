#!/usr/bin/env node
import { runCli, version } from "./cli.ts";
import { serveStdio } from "./mcp.ts";
import { closePrompt, readLine, readSecret } from "./prompt.ts";
import { createRuntime } from "./runtime.ts";

process.exitCode = await runCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(`${text}\n`),
  stderr: (text) => process.stderr.write(`${text}\n`),
  readSecret,
  readLine,
  createRuntime: () => createRuntime(),
  serveMcp: (runtime) => serveStdio(runtime, version),
});
closePrompt();

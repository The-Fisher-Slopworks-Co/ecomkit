import { createInterface } from "node:readline";
import { EcomError } from "@ecomkit/core";

let piped: { close(): void; lines: AsyncIterator<string> } | undefined;

async function readPipedLine(): Promise<string> {
  if (piped === undefined) {
    const reader = createInterface({ input: process.stdin });
    piped = {
      close: () => reader.close(),
      lines: reader[Symbol.asyncIterator](),
    };
  }
  const next = await piped.lines.next();
  return next.done ? "" : next.value.trim();
}

export function closePrompt(): void {
  piped?.close();
  piped = undefined;
}

export function readSecret(label: string): Promise<string> {
  const { stdin, stderr } = process;
  if (!stdin.isTTY) return readPipedLine();

  stderr.write(`${label}: `);
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stderr.write("\n");
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          finish();
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          finish();
          reject(new EcomError("invalid_input", "Cancelled"));
          return;
        }
        value =
          char === "\u007f" || char === "\b"
            ? value.slice(0, -1)
            : value + char;
      }
    };
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
    stdin.resume();
  });
}

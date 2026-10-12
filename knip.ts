import type { KnipConfig } from "knip";

const config: KnipConfig = {
  workspaces: {
    "packages/*": {
      entry: ["src/**/*.test.ts"],
      project: ["src/**/*.ts"],
    },
    "apps/ecom": {
      entry: ["src/main.ts", "src/**/*.test.ts", "scripts/*.mjs"],
      project: ["src/**/*.ts", "scripts/*.mjs"],
    },
  },
  ignoreBinaries: ["uvx"],
};

export default config;

import type { KnipConfig } from "knip";

const config: KnipConfig = {
  workspaces: {
    "packages/*": {
      entry: ["src/**/*.test.ts"],
      project: ["src/**/*.ts"],
    },
  },
  ignoreBinaries: ["uvx"],
};

export default config;

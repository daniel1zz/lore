#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";

const VERSION = "0.1.0";

const main = defineCommand({
  meta: {
    name: "lore",
    version: VERSION,
    description: "AI-native shared knowledge/memory platform",
  },
  args: {
    version: {
      type: "boolean",
      alias: "v",
      description: "Print version",
    },
  },
  run({ args }) {
    if (args.version) {
      console.log(`lore v${VERSION}`);
      return;
    }
    console.log(`lore v${VERSION}`);
    console.log("Run with --help for usage.");
  },
});

runMain(main);

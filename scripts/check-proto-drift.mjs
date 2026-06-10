#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const repo = process.argv[2] ?? 'research/github/EasyTier';
const protoRoot = join(process.cwd(), repo);
if (!existsSync(protoRoot)) {
  console.error(`EasyTier source not found at ${protoRoot}`);
  process.exit(1);
}
console.log('Proto drift check scaffold: compare proto/easytier against the selected official EasyTier release before shipping.');
console.log(`Official source candidate: ${protoRoot}`);

#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = process.argv[2] ?? 'research/github/EasyTier';
const protoRoot = join(process.cwd(), repo);
if (!existsSync(protoRoot)) {
  console.error(`EasyTier source not found at ${protoRoot}`);
  process.exit(1);
}

const officialRoot = join(protoRoot, 'easytier/src/proto');
const localRoot = join(process.cwd(), 'proto/easytier');
const files = ['common.proto', 'error.proto', 'peer_rpc.proto'];
const missing = files.filter((file) => !existsSync(join(localRoot, file)) || !existsSync(join(officialRoot, file)));
if (missing.length > 0) {
  console.error(`Proto drift check failed; missing tracked proto file(s): ${missing.join(', ')}`);
  process.exit(1);
}

const drifted = files.filter((file) => readFileSync(join(localRoot, file), 'utf8') !== readFileSync(join(officialRoot, file), 'utf8'));
if (drifted.length > 0) {
  console.error(`Proto drift check failed; local proto differs from official source: ${drifted.join(', ')}`);
  console.error(`Official source candidate: ${officialRoot}`);
  process.exit(1);
}

console.log(`Proto drift check OK against ${officialRoot}`);

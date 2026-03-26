#!/usr/bin/env node
'use strict';

require('dotenv/config');

// Register ts-node for development (no-op in production with compiled dist/)
try {
  require('../dist/commands/index.js');
} catch {
  // Fallback to ts-node in dev
  require('ts-node/register');
  require('../src/commands/index.ts');
}

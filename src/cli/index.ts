#!/usr/bin/env node
/**
 * CLI bootstrap - runs main() with process.argv.
 */
import { main } from './main.js';

main(process.argv.slice(2)).catch((error) => {
  console.error('Fatal:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

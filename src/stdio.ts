/**
 * stdio.ts – Entry point for stdio transport (Docker / local CLI usage).
 * Run: node dist/stdio.js
 * Or:  WLO_REPOSITORY_URL=https://repository.staging.openeduhub.net/edu-sharing \
 *        node dist/stdio.js
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.js';
import { log } from './logger.js';

async function main(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until stdin closes
}

main().catch(err => {
  log.error('fatal error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});

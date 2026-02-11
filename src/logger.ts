type LogCategory = 'init' | 'cache' | 'github' | 'queue' | 'writer' | 'server';

/**
 * Log to stderr with category prefix
 * MCP servers communicate via stdio, so all logging must go to stderr
 */
export function log(category: LogCategory, message: string): void {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [${category}] ${message}`);
}

#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { GitHubClient, GitHubConfig } from './github.js';
import { cache } from './cache.js';
import { writeQueue } from './queue.js';
import { AsyncWriter } from './writer.js';
import { parseIndex } from './index-gen.js';
import { log } from './logger.js';

// Configuration schema - passed via MCP settings
const ConfigSchema = z.object({
  repo: z.string().regex(/^[^/]+\/[^/]+$/, 'Must be in format "owner/repo"'),
  token: z.string().min(1, 'GitHub token is required'),
});

type Config = z.infer<typeof ConfigSchema>;

// Tool input schemas
const ReadMemorySchema = z.object({
  path: z.string().describe('Path to the memory file (e.g., "templates/user-story.md")'),
});

const SaveMemorySchema = z.object({
  category: z.string().describe('Category folder (e.g., "templates", "standards", "knowledge"). Will be created if it does not exist.'),
  name: z.string().describe('File name (e.g., "user-story.md" or "user-story")'),
  content: z.string().describe('Content of the memory file'),
});

const DeleteMemorySchema = z.object({
  path: z.string().describe('Path to the memory file to delete'),
});

const SearchMemorySchema = z.object({
  query: z.string().describe('Search query (searches paths and content)'),
});

// Tool definitions
const TOOLS: Tool[] = [
  {
    name: 'list_knowledge',
    description: 'List all available memory files organized by category. Returns the index of templates, standards, and knowledge files.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'read_memory',
    description: 'Read the content of a specific memory file. Fast cached reads.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the memory file (e.g., "templates/user-story.md")',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'save_memory',
    description: 'Create or update a memory file. Saves are async and non-blocking. Category folders are auto-created.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Category folder (e.g., "templates", "standards", "knowledge")',
        },
        name: {
          type: 'string',
          description: 'File name (e.g., "user-story.md")',
        },
        content: {
          type: 'string',
          description: 'Content of the memory file',
        },
      },
      required: ['category', 'name', 'content'],
    },
  },
  {
    name: 'delete_memory',
    description: 'Delete a memory file. Deletes are async and non-blocking.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the memory file to delete',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_memory',
    description: 'Search across all memory files by keyword. Searches both file paths and content.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
      },
      required: ['query'],
    },
  },
];

class MemoryMCPServer {
  private server: Server;
  private github: GitHubClient | null = null;
  private writer: AsyncWriter | null = null;
  private config: Config | null = null;

  constructor() {
    this.server = new Server(
      {
        name: 'memory-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: TOOLS };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'list_knowledge':
            return await this.handleListKnowledge();
          case 'read_memory':
            return await this.handleReadMemory(args);
          case 'save_memory':
            return await this.handleSaveMemory(args);
          case 'delete_memory':
            return await this.handleDeleteMemory(args);
          case 'search_memory':
            return await this.handleSearchMemory(args);
          default:
            return {
              content: [{ type: 'text', text: `Unknown tool: ${name}` }],
              isError: true,
            };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        };
      }
    });
  }

  private async handleListKnowledge() {
    const indexEntry = cache.get('index.json');
    
    if (indexEntry) {
      const index = parseIndex(indexEntry.content);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(index, null, 2),
        }],
      };
    }

    // Generate index from cache if index.json doesn't exist
    const files = cache.keys()
      .filter((path) => path !== 'index.json')
      .map((path) => {
        const parts = path.split('/');
        return { path, category: parts.length > 1 ? parts[0] : 'root' };
      });
    
    const categories = [...new Set(files.map((f) => f.category))].sort();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ categories, files, lastUpdated: new Date().toISOString() }, null, 2),
      }],
    };
  }

  private async handleReadMemory(args: unknown) {
    const { path } = ReadMemorySchema.parse(args);
    
    // Try cache first (fast path)
    let entry = cache.get(path);
    
    if (!entry && this.github) {
      // Cache miss - fetch from GitHub
      const file = await this.github.getFile(path);
      
      if (!file) {
        return {
          content: [{ type: 'text', text: `File not found: ${path}` }],
          isError: true,
        };
      }
      
      cache.set(path, file.content, file.sha);
      entry = { content: file.content, sha: file.sha };
    }

    if (!entry) {
      return {
        content: [{ type: 'text', text: `File not found: ${path}` }],
        isError: true,
      };
    }

    return {
      content: [{ type: 'text', text: entry.content }],
    };
  }

  private async handleSaveMemory(args: unknown) {
    const { category, name, content } = SaveMemorySchema.parse(args);
    
    if (!this.writer) {
      return {
        content: [{ type: 'text', text: 'Server not initialized' }],
        isError: true,
      };
    }

    const result = await this.writer.save(category, name, content);
    
    if (!result.success) {
      return {
        content: [{ type: 'text', text: result.error ?? 'Save failed' }],
        isError: true,
      };
    }

    return {
      content: [{ type: 'text', text: `Saved: ${result.path}` }],
    };
  }

  private async handleDeleteMemory(args: unknown) {
    const { path } = DeleteMemorySchema.parse(args);
    
    if (!this.writer) {
      return {
        content: [{ type: 'text', text: 'Server not initialized' }],
        isError: true,
      };
    }

    const result = await this.writer.delete(path);
    
    if (!result.success) {
      return {
        content: [{ type: 'text', text: result.error ?? 'Delete failed' }],
        isError: true,
      };
    }

    return {
      content: [{ type: 'text', text: `Deleted: ${path}` }],
    };
  }

  private async handleSearchMemory(args: unknown) {
    const { query } = SearchMemorySchema.parse(args);
    
    const results = cache.search(query);
    
    if (results.length === 0) {
      return {
        content: [{ type: 'text', text: `No results found for: "${query}"` }],
      };
    }

    const formatted = results
      .map((r) => `**${r.path}**\n${r.snippet}`)
      .join('\n\n---\n\n');

    return {
      content: [{ type: 'text', text: formatted }],
    };
  }

  async initialize(config: Config): Promise<void> {
    log('init', `Initializing with repo: ${config.repo}`);
    
    this.config = config;
    this.github = new GitHubClient(config);
    this.writer = new AsyncWriter(this.github);

    // Validate GitHub access
    const hasAccess = await this.github.validateAccess();
    if (!hasAccess) {
      throw new Error(`Cannot access repository: ${config.repo}. Check token permissions.`);
    }

    // Fetch full tree and populate cache
    log('init', 'Fetching repository contents...');
    const tree = await this.github.listTree();
    log('init', `Found ${tree.length} files in repository`);

    // Fetch content for all files
    for (const { path, sha } of tree) {
      try {
        const file = await this.github.getFile(path);
        if (file) {
          cache.set(path, file.content, file.sha);
        }
      } catch (error) {
        log('init', `Failed to fetch ${path}: ${error}`);
      }
    }

    log('init', `Cache populated with ${cache.size} files`);

    // Drain any pending writes from previous session
    await this.writer.drainQueue();

    log('init', 'Server ready');
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    log('server', 'MCP server running on stdio');
  }
}

// Main entry point
async function main(): Promise<void> {
  // Parse config from environment or command line
  // MCP clients pass config via environment variables
  const repo = process.env.MEMORY_MCP_REPO;
  const token = process.env.MEMORY_MCP_TOKEN;

  if (!repo || !token) {
    console.error('Error: MEMORY_MCP_REPO and MEMORY_MCP_TOKEN environment variables are required.');
    console.error('Configure these in your MCP client settings.');
    process.exit(1);
  }

  try {
    const config = ConfigSchema.parse({ repo, token });
    const server = new MemoryMCPServer();
    await server.initialize(config);
    await server.run();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();

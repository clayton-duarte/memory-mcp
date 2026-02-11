# memory-mcp

Personal External Brain MCP Server - A stateless MCP server for syncing templates, standards, and knowledge via GitHub.

## Features

- **Zero-latency reads**: In-memory cache for instant access to templates and standards
- **Non-blocking writes**: Async GitHub sync with local queue for resilience  
- **Auto-categorization**: Files organized by category (templates, standards, knowledge, etc.)
- **Full-text search**: Search across file paths and content

## Installation

### VS Code / Copilot

Add to your `~/.vscode/mcp.json` or VS Code settings:

```json
{
  "servers": {
    "memory-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "memory-mcp"],
      "env": {
        "MEMORY_MCP_REPO": "your-username/memory-mcp-storage",
        "MEMORY_MCP_TOKEN": "ghp_your_token_here"
      }
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "memory-mcp": {
      "command": "npx",
      "args": ["-y", "memory-mcp"],
      "env": {
        "MEMORY_MCP_REPO": "your-username/memory-mcp-storage",
        "MEMORY_MCP_TOKEN": "ghp_your_token_here"
      }
    }
  }
}
```

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `MEMORY_MCP_REPO` | Yes | GitHub repository in `owner/repo` format |
| `MEMORY_MCP_TOKEN` | Yes | GitHub Personal Access Token with `repo` scope |

## Tools

### `list_knowledge`
List all available memory files organized by category.

### `read_memory`
Read the content of a specific memory file.
```json
{ "path": "templates/user-story.md" }
```

### `save_memory`
Create or update a memory file. Category folders are auto-created.
```json
{ "category": "templates", "name": "user-story.md", "content": "..." }
```

### `delete_memory`
Delete a memory file.
```json
{ "path": "templates/old-template.md" }
```

### `search_memory`
Search across all memory files by keyword.
```json
{ "query": "graphql error" }
```

## Storage Repository Structure

Create a private GitHub repository (e.g., `memory-mcp-storage`) with this structure:

```
/
├── index.json             # Auto-generated manifest
├── templates/             # Markdown templates
│   ├── user-story.md
│   └── pull-request.md
├── standards/             # Technical rules (YAML/JSON)
│   ├── typescript.yaml
│   └── graphql.yaml
└── knowledge/             # Long-form context
    └── architecture.md
```

## How It Works

1. **Startup**: Fetches all files from GitHub, populates in-memory cache
2. **Reads**: Cache-first (instant), falls back to GitHub API on miss
3. **Writes**: Updates cache immediately, returns to agent, syncs GitHub async
4. **Failures**: Failed writes queue to `~/.memory-mcp-queue.json` and retry on next operation

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev
```

## License

MIT

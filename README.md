# Rails Console MCP Server

A **generic** Model Context Protocol (MCP) server that provides AI models (Claude Desktop, Cursor, Codex, etc.) with read-only access to **any Rails application's** models, database schema, and data.

## Features

- 🔌 **Works with ANY Rails app** - Configure via `config.json`
- 🛡️ **Read-only by default** - Blocks DDL/DML operations
- 📊 **8 powerful tools** for model introspection and querying
- ⚡ **Token efficient** - Returns structured JSON, not verbose text
- 🔄 **Hot reload** - Reload Rails code without restarting
- 🔒 **Environment-aware** - Production requires explicit opt-in

## Quick Start

### 1. Install Dependencies

```bash
cd /home/himanshu/projects/rails-console-mcp
npm install
npm run build
```

### 2. Configure

Copy the example config and edit for your Rails app:

```bash
cp config.example.json config.json
# Edit config.json with your Rails app path
```

```json
{
  "railsAppPath": "/home/himanshu/projects/Transcripto",
  "environment": "development",
  "readOnly": true,
  "maxRows": 100,
  "queryTimeoutSeconds": 30
}
```

### 3. Configure Your AI Tool

**Claude Desktop** (`~/.claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "rails-console": {
      "command": "node",
      "args": ["/home/himanshu/projects/rails-console-mcp/dist/index.js"]
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "rails-console": {
      "command": "node",
      "args": ["/home/himanshu/projects/rails-console-mcp/dist/index.js"]
    }
  }
}
```

**VS Code** (`.vscode/mcp.json`):
```json
{
  "servers": {
    "rails-console": {
      "type": "stdio",
      "command": "node",
      "args": ["/home/himanshu/projects/rails-console-mcp/dist/index.js"]
    }
  }
}
```

### 4. Restart Your AI Tool

Restart Claude Desktop / Cursor / VS Code to load the MCP server.

## Available Tools

| Tool | Description |
|------|-------------|
| `list_models` | List all models with summary metadata (table name, column/association counts) |
| `get_model_schema` | Full model definition: columns, associations, validations, scopes, enums, callbacks |
| `get_table_schema` | Raw database table schema (columns, indexes, FKs, PKs) |
| `execute_query` | Safe read-only SELECT queries with automatic LIMIT |
| `reload_environment` | Reload Rails code (development only) |
| `get_model_counts` | Row counts for models with optional WHERE clause |
| `search_models` | Find models by name/table pattern (regex) |
| `get_associations_graph` | Graph of model relationships (nodes/edges) |

## Architecture

```
┌─────────────────────┐     stdio (JSON-RPC)     ┌──────────────────────┐
│  AI Tool            │ ◄──────────────────────► │  Node.js MCP Server  │
│  (Claude, Cursor)   │                          │  @modelcontextprotocol│
└─────────────────────┘                          └──────────┬───────────┘
                                                             │
                                                    spawns Ruby sidecar
                                                             │
                                                             ▼
                                                 ┌──────────────────────┐
                                                 │  Ruby Sidecar        │
                                                 │  (loads Rails env)   │
                                                 │  - ActiveRecord      │
                                                 │  - All model metadata│
                                                 └──────────┬───────────┘
                                                            │
                                                            ▼
                                                 ┌──────────────────────┐
                                                 │  Rails App           │
                                                 │  (any path)          │
                                                 │  config.railsAppPath │
                                                 └──────────────────────┘
```

The **Ruby sidecar** loads the full Rails environment (`config/environment.rb`) giving access to:
- All ActiveRecord models with associations, scopes, validations, callbacks, enums
- Database schema via `ActiveRecord::Base.connection`
- Safe query execution through ActiveRecord

## Configuration Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `railsAppPath` | string | **required** | Absolute path to Rails app root |
| `environment` | string | `"development"` | Rails env to load |
| `readOnly` | boolean | `true` | Block DDL/DML operations |
| `maxRows` | number | `100` | Max rows per query |
| `queryTimeoutSeconds` | number | `30` | Query timeout |
| `allowedEnvironments` | string[] | `["development","test"]` | Allowed Rails envs |
| `sidecar.rubyPath` | string | `"ruby"` | Ruby executable path |
| `sidecar.startupTimeoutSeconds` | number | `30` | Sidecar startup timeout |
| `logging.level` | string | `"info"` | Log level |

## Security

- **Read-only by default** - Only SELECT queries allowed
- **Production protection** - Requires explicit `allowedEnvironments` config
- **Query validation** - Blocks DDL/DML keywords
- **Parameterized queries** - Use `params` array for safe interpolation
- **Row limits** - Automatic LIMIT enforcement

## Development

```bash
# Watch mode for development
npm run dev

# Run tests
npm test

# Type check
npx tsc --noEmit
```

## Example Usage

Once configured, ask your AI tool:

> "List all models in my Rails app"
> "Show me the schema for the Transcription model including associations"
> "How many transcriptions were created this week?"
> "Show me the association graph for User, Transcription, and Speaker"
> "Run a query to find all transcriptions with status 'completed'"

## Requirements

- Node.js 18+
- Ruby 3.0+ (matching your Rails app)
- Rails 6.0+ (tested with Rails 8)
- Bundler installed in target Rails app

## License

MIT
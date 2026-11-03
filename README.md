# Rails Console MCP

JavaScript-only MCP server for inspecting PostgreSQL databases used by Rails applications. It connects directly to PostgreSQL from Node.js. No Rails checkout, Ruby runtime, Bundler, or sidecar is needed.

## Install

```sh
npm install -g rails-console-mcp
```

Configure the server with `DATABASE_URL` or a config file:

```json
{
  "databaseUrl": "postgresql://readonly_user:password@localhost:5432/rails_app",
  "databaseSchema": "public",
  "maxRows": 100,
  "queryTimeoutSeconds": 30
}
```

Use a database role that has SELECT privileges only. The connector also sets PostgreSQL sessions to read-only.

MCP client example:

```json
{
  "mcpServers": {
    "rails-console": {
      "command": "rails-console-mcp",
      "args": [],
      "env": { "DATABASE_URL": "postgresql://readonly_user:password@localhost:5432/rails_app" }
    }
  }
}
```

## Tools

- `list_tables`: list tables in the configured schema, optionally filtered by regex.
- `get_table_schema`: inspect columns, indexes, primary keys, and foreign keys.
- `get_table_count`: count rows in a table.
- `execute_query`: run one parameterized SELECT query, with a capped result limit.

This database-only version cannot inspect Rails model code, so it does not report validations, callbacks, scopes, enums, or Ruby-defined associations. Database foreign keys remain available through table metadata.

## Configuration

| Setting | Default | Meaning |
|---|---:|---|
| `databaseUrl` | `DATABASE_URL` env | PostgreSQL connection URL |
| `databaseSchema` | `public` | Schema containing Rails tables |
| `maxRows` | `100` | Maximum rows returned |
| `queryTimeoutSeconds` | `30` | Connection and statement timeout |
| `logging.level` | `info` | Log verbosity |

Provide config using `--config /path/to/config.json`, `RAILS_CONSOLE_MCP_CONFIG`, or `config.json` in the working directory.

## Development

```sh
npm install
npm run build
npm test
```

# Rails Console MCP

[![npm version](https://img.shields.io/npm/v/rails-console-mcp)](https://www.npmjs.com/package/rails-console-mcp)
[![npm downloads](https://img.shields.io/npm/dm/rails-console-mcp)](https://www.npmjs.com/package/rails-console-mcp)
[![License](https://img.shields.io/npm/l/rails-console-mcp)](LICENSE)

An MCP server that starts a real `bin/rails c` process and keeps it warm for the lifetime of the MCP connection. Calls share the same console session, so Ruby variables and objects remain available across steps:

```ruby
# First tool call
a = User.last

# Later tool call, in the same Rails console
a.status
```

The MCP server and package are JavaScript. It uses `node-pty` to run the Rails app's existing console; it does not ship or require a Ruby sidecar file. The target Rails application still needs its normal Ruby, Bundler, and gems installed.

## Requirements

- Node.js 18 or newer
- macOS or Linux
- A Rails app with `bin/rails c` runnable from its root
- The app's Ruby/Bundler toolchain available to the MCP process

## Install from npm and connect Claude Code

With Node.js 18 or newer and npm installed, register the published package as a Claude Code MCP server. Replace the app path with the absolute path to your Rails app:

```sh
claude mcp add -s user rails-console \
  -e RAILS_CONSOLE_MCP_CWD=/absolute/path/to/rails/app \
  -- npx -y rails-console-mcp
```

`npx` downloads and runs the package from npm; a separate global install is not required. If you prefer a global install, run `npm install -g rails-console-mcp`, then use `-- rails-console-mcp` in the Claude command above.

Check that Claude Code can start the server:

```sh
claude mcp list
```

In Claude Code, use `rails_eval` with `1 + 1` to boot the console. The first call may take a few minutes; later calls reuse the warm process. If Claude Code cannot find the correct Ruby installation, pass its Ruby/Bundler paths with another `-e PATH=...` option when adding the server, or set `RAILS_CONSOLE_MCP_COMMAND` to an app-specific launch command. If `claude mcp list` shows duplicate `rails-console` entries in different scopes, remove the stale one with `claude mcp remove rails-console -s project` or `-s user` as appropriate.

## Install from npm and connect Codex

Register the npm package as a global Codex MCP server, replacing the app path with the absolute path to your Rails app:

```sh
codex mcp add rails-console \
  --env RAILS_CONSOLE_MCP_CWD=/absolute/path/to/rails/app \
  -- npx -y rails-console-mcp
```

`npx` downloads and runs the package from npm; a separate global install is not required. If you prefer a global install, run `npm install -g rails-console-mcp`, then use `-- rails-console-mcp` in the Codex command above. Check the registration with `codex mcp get rails-console` or `codex mcp list`. Start a new Codex session and call `rails_status` to verify the MCP tool is available; call `rails_eval` with `1 + 1` to boot the Rails console. Codex may ask you to approve MCP tool calls, depending on your approval settings.

If Codex cannot find the correct Ruby installation, add its Ruby/Bundler paths with another `--env PATH=...` option or set `RAILS_CONSOLE_MCP_COMMAND` with `--env` to an app-specific launch command.

## Install from npm and connect Cursor

For project-specific setup, create `.cursor/mcp.json` in your Rails app and replace the example path with the app's absolute path:

```json
{
  "mcpServers": {
    "rails-console": {
      "command": "npx",
      "args": ["-y", "rails-console-mcp"],
      "env": {
        "RAILS_CONSOLE_MCP_CWD": "/absolute/path/to/rails/app"
      }
    }
  }
}
```

Cursor downloads and runs the package from npm through `npx`; a separate global install is not required. If you prefer a global install, set `"command": "rails-console-mcp"` and `"args": []` after running `npm install -g rails-console-mcp`. Restart or reload the project in Cursor, then open **Settings → Tools & MCP** and check that `rails-console` is enabled. Ask Cursor to call `rails_status` to verify it can use the tool, then call `rails_eval` with `1 + 1` to boot Rails. For more details, see [Cursor's MCP documentation](https://docs.cursor.com/context/model-context-protocol).

If Cursor cannot find the correct Ruby installation, add a `PATH` entry under `env` with the Ruby/Bundler paths, or set `RAILS_CONSOLE_MCP_COMMAND` there to an app-specific launch command.

## Tools

- `rails_eval`: evaluate Ruby in the persistent Rails console. Captures `puts` output and the last expression's inspected value. Supports multiline code and heredocs.
- `rails_tables`: list database tables with optional regex filtering.
- `rails_schema`: inspect a table's columns, indexes, primary key, and foreign keys.
- `rails_models`: find model classes and their associations.
- `rails_status`: inspect console state and startup configuration.
- `rails_reload`: reload app code in the warm console.
- `rails_restart`: restart the underlying Rails console.

`rails_eval` runs arbitrary Ruby with the Rails app's permissions. Database writes and other side effects are possible. Use a development or test app you trust; do not point this tool at production.

## Configuration

| Environment variable | Default | Purpose |
|---|---|---|
| `RAILS_CONSOLE_MCP_CWD` | `RAILS_ROOT` or current directory | Rails app root |
| `RAILS_CONSOLE_MCP_COMMAND` | `bin/rails c` | Console launch command |
| `RAILS_CONSOLE_MCP_RAILS_ENV` | `development` | Rails environment |
| `RAILS_CONSOLE_MCP_ENV_<KEY>` | none | Pass `<KEY>` into the Rails process |

The process starts on the first `rails_eval` call rather than during MCP startup. This lets the server connect promptly while the Rails app boots only when needed.

If Rails fails to boot (for example, because gems are missing), `rails_eval` now reports the detected cause and the relevant `bundle install --gemfile ...` command. `rails_status` retains the last boot error so it can be inspected after a failed startup.

## Development

```sh
npm install
npm test
```

Run an end-to-end smoke check against a Rails app with:

```sh
RAILS_CONSOLE_MCP_CWD=/absolute/path/to/rails/app npm run smoke
```

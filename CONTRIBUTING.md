# Contributing

Thanks for contributing. The server is JavaScript and runs the target app's existing Rails console in a persistent PTY. It does not include a Ruby sidecar source file.

## Development

Requirements: Node.js 18+, macOS or Linux. Install dependencies and run the tests:

```sh
npm install
npm test
```

The lifecycle tests use a fake PTY and do not need a Rails app. To smoke-test against Rails, set `RAILS_CONSOLE_MCP_CWD` to a local app with its bundle installed and run `npm run smoke`.

## Project layout

- `src/index.js`: MCP tools and stdio server
- `src/console.js`: persistent PTY lifecycle, eval framing, serialization, restart, and timeout handling
- `src/json-io.js`: JSON marker extraction
- `scripts/`: smoke test and JSON-RPC test client
- `test/`: console lifecycle and protocol unit tests

## Pull requests

1. Add or update tests for behavior changes.
2. Run `npm test` and `npm pack --dry-run`.
3. Explain the user-visible behavior and any runtime requirements.

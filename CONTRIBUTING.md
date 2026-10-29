# Contributing to Rails Console MCP

Thank you for your interest in contributing! This project welcomes contributions from the community.

## Getting Started

### Prerequisites

- Node.js 18+
- Ruby 3.0+
- A Rails application to test against (Rails 6.0+)

### Development Setup

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/rails-console-mcp.git
cd rails-console-mcp

# Install dependencies
npm install

# Build the project
npm run build

# Configure for your Rails app
cp config.example.json config.json
# Edit config.json with your Rails app path
```

### Running in Development Mode

```bash
# Watch mode (auto-reload on changes)
npm run dev

# Run tests
npm test

# Type check
npx tsc --noEmit
```

## How to Contribute

### Reporting Bugs

1. Check if the issue already exists in [Issues](https://github.com/YOUR_USERNAME/rails-console-mcp/issues)
2. Create a new issue with:
   - Clear title and description
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details (Rails version, Ruby version, Node version)
   - Relevant logs/error messages

### Suggesting Features

1. Check existing issues for similar requests
2. Create a new issue with:
   - Clear use case
   - Proposed solution
   - Alternative approaches considered

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests and type checks: `npm test && npx tsc --noEmit`
5. Commit with clear messages: `git commit -m "Add feature: brief description"`
6. Push to your fork: `git push origin feature/my-feature`
7. Open a Pull Request

### Code Style

- TypeScript with strict mode
- ESLint configuration (if added)
- Follow existing code patterns
- Add JSDoc comments for public APIs
- Write tests for new functionality

## Project Structure

```
rails-console-mcp/
├── src/
│   ├── index.ts              # Main entry point
│   ├── connector/
│   │   └── ruby-sidecar.ts   # Node.js ↔ Ruby communication
│   ├── tools/
│   │   └── index.ts          # MCP tool definitions & handlers
│   ├── types/
│   │   ├── config.ts         # Configuration schemas
│   │   └── tools.ts          # Tool input/output schemas
│   └── utils/
│       ├── config.ts         # Configuration loading
│       └── logger.ts         # Logging utility
├── ruby/
│   └── sidecar.rb            # Ruby sidecar (loads Rails env)
├── dist/                     # Compiled output (gitignored)
├── config.example.json       # Example configuration
├── config.json               # Your local config (gitignored)
├── package.json
├── tsconfig.json
├── README.md
└── LICENSE
```

## Architecture Overview

The server uses a **Ruby sidecar** pattern:

1. **Node.js MCP Server** - Handles MCP protocol, tool registration, request routing
2. **Ruby Sidecar** - Loads full Rails environment, executes ActiveRecord introspection
3. **JSON-RPC over stdio** - Communication between Node.js and Ruby processes

This design allows the server to work with **any Rails application** without being a Rails engine or gem.

## Testing

Tests require a running Rails application. Configure `config.json` with your test Rails app path, then run:

```bash
npm test
```

## Security Considerations

- Default `readOnly: true` blocks all DDL/DML operations
- Production environment requires explicit `allowedEnvironments` opt-in
- Query validation rejects non-SELECT statements
- Row limits enforced automatically

When contributing, maintain these security defaults.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
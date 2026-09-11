# SharedState Development Guide

This guide describes how to set up, build, test, and contribute to the SharedState repository.

---

## Project Folder Organization

```text
shared-state/
├── client/              # JavaScript client library source files
├── src/sharedstate/     # Python server package source code
├── cfg/                 # Server configuration examples (sqlite.json, sql.json)
├── html/                # Admin Web UI & examples
├── dist/                # Output directory for compiled client JS bundles
├── docs/                # Documentation source files
├── scripts/             # Build scripts (e.g. generate-api-docs.js)
├── tests/               # Automated test suites
├── DEVELOP.md           # Developer setup and contribution guide
├── LICENSE              # Software license (BSD 2-Clause)
├── README.md            # Repository overview & quick links
├── SKILL.md             # Agent skill guide for AI assistants
├── TODO.md              # Planned tasks and future extension roadmap
├── package.json         # npm dependencies and script definitions
├── package-lock.json    # npm dependency lockfile
├── poetry.lock          # Python Poetry dependency lockfile
├── pyproject.toml       # Python Poetry package & dependency configuration
├── pyrightconfig.json   # Pyright type checker configuration
├── pytest.ini           # Pytest configuration
├── vite.config.js       # Vite configuration for JS bundling
└── vitest.config.js     # Vitest test runner configuration
```

---

## Environment Setup

Ensure you have **Node.js** (v18+) and **Python** (v3.10+) with **Poetry** installed.

```sh
# 1. Install Python server dependencies
poetry install

# 2. Install JavaScript client dependencies
npm install
```
---

### Running the Python Server

Start the Python SharedState WebSocket server locally:

```sh
# Start server with default in-memory SQLite store
poetry run sharedstate-server

# Or start server with a specific configuration file
poetry run sharedstate-server cfg/sqlite.json
poetry run sharedstate-server cfg/sql.json
```

- **Admin Web UI**: Once the server is running, open `http://localhost:9000/` in your browser to access the interactive admin dashboard (`html/adm/`).
- **WebSocket Endpoint**: Clients connect to `ws://localhost:9000/`.


---
## Running Test Suites

### Client Tests (Vitest)

Execute JavaScript client unit and integration tests:

```sh
# Run client test suite once
npm test

# Run tests in watch mode during client development
npx vitest
```

### Server Tests (Pytest)

Execute Python server unit and connection tests:

```sh
# Run Python server test suite
poetry run pytest
```

---
## Building Client JS Bundles

SharedState uses [Vite](https://vitejs.dev/) to compile the client library into single-file ES modules and IIFE bundles:

```sh
# Build development bundles in dist/ (sharedstate.es.js, sharedstate.iife.js)
npm run build

# Build production minified bundles in dist/ (sharedstate.es.min.js, sharedstate.iife.min.js)
npm run build:dist
```

---
## Building New API doc

The api doc script (`scripts/generate-api-docs.js`) automatically re-generate client Markdown documentation in docs/client_api/.


---
## Releasing a New Project Version

To create a new release, set version numbers across JS/Python codebases, build client bundles, commit, and create a Git tag in a single command using `scripts/release.js`:

```sh
# Release a specific version (e.g. 1.0.0)
npm run release 1.0.0

# Or run the script directly:
node scripts/release.js 1.0.0

# Or using standard npm version:
npm version patch # or minor, major, 1.0.0
```

The release script (`scripts/release.js`) automatically:
1. Validates SemVer version format.
2. Updates `"version"` in `package.json`, `pyproject.toml`, and `src/sharedstate/__init__.py`.
3. Injects the version string into JavaScript (`SharedStateClient.VERSION`) via Vite.
4. Rebuilds `dist/` JS distribution bundles (`npm run build`).
5. Stages files, creates git commit (`release: v1.0.0`) and git tag (`v1.0.0`).

Push the release to GitHub with:
```sh
git push origin main --tags
```





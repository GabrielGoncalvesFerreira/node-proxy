# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Testing
- `npm test` - Run all tests (unit + TypeScript)
- `npm run test:unit` - Run unit tests with coverage using c8 and Node.js test runner
- `npm run test:typescript` - Run TypeScript definition tests using tsd

### Linting
- `npm run lint` - Run ESLint to check code style
- `npm run lint:fix` - Run ESLint with automatic fixes
- ESLint configuration uses neostandard with TypeScript support

### Building
- No build step required - this is a CommonJS library

## Architecture Overview

This is a Fastify plugin for proxying HTTP requests to upstream servers. The plugin decorates the Fastify reply with a `from()` method.

### Key Components

**Main Plugin (`index.js`)**
- Entry point that registers the plugin using fastify-plugin
- Decorates `reply.from(source, opts)` method
- Handles request proxying, retries, caching, and error handling
- Supports HTTP/1.1, HTTP/2, and Undici client strategies

**Request Builder (`lib/request.js`)**
- Factory for creating request handlers based on transport (HTTP/1.1, HTTP/2, Undici)
- Handles different agent configurations (HTTP, HTTPS, Unix sockets)
- Manages timeouts, connection pooling, and retry logic
- Returns unified interface: `{ request, close, retryOnError }`

**Utilities (`lib/utils.js`)**
- `filterPseudoHeaders()` - Removes HTTP/2 pseudo-headers (starting with :)
- `copyHeaders()` - Copies headers to Fastify reply
- `stripHttp1ConnectionHeaders()` - Removes HTTP/1 connection-specific headers for HTTP/2
- `buildURL()` - Constructs destination URLs with base path validation

**Error Definitions (`lib/errors.js`)**
- Standardized error types using @fastify/error
- Maps different error conditions to appropriate HTTP status codes
- Includes timeout, connection reset, and gateway errors

### Transport Strategies

1. **Undici (default)** - High-performance HTTP/1.1 client with connection pooling
2. **HTTP/2** - Native Node.js HTTP/2 client for modern protocols  
3. **HTTP/1.1** - Node.js built-in http/https modules with custom agents

### Key Features

- **Caching**: URL parsing cache using toad-cache LruMap (default 100 entries)
- **Retries**: Configurable retry logic for socket hangups and 503 errors
- **Headers**: Smart header rewriting for HTTP/1.1 ↔ HTTP/2 compatibility
- **Body handling**: Supports streams, JSON encoding, and custom content types
- **Unix sockets**: Special handling for unix+http: and unix+https: protocols
- **Timeouts**: Per-request and session-level timeout configuration

### Configuration

The plugin accepts extensive configuration for different transport methods, retry behavior, caching, and request/response transformation hooks. See README.md for full option documentation.
export const dockerCanvasTracingIncludes = [
  'node_modules/@napi-rs/canvas/**/*',
  'node_modules/@napi-rs/canvas-*/package.json',
  'node_modules/@napi-rs/canvas-*/*.node',
  // Broad pnpm globs also match the symlink directory
  // `.../@napi-rs/canvas-linux-x64-gnu`; Turbopack 16.3.0-preview.5
  // tries to hash that directory as a file during Docker output tracing.
  'node_modules/.pnpm/@napi-rs+canvas-*/node_modules/@napi-rs/canvas-*/package.json',
  'node_modules/.pnpm/@napi-rs+canvas-*/node_modules/@napi-rs/canvas-*/*.node',
  // Optional DuckDB native (dynamic import). Worker cjs is COPY'd in Dockerfile
  // to /app/workbookParseWorker.cjs — do not list a static .cjs path here or
  // Turbopack may try to resolve it as a module during build.
  'node_modules/@duckdb/node-api/**/*',
  'node_modules/@duckdb/node-bindings/**/*',
  'node_modules/@duckdb/node-bindings-*/**/*',
  'node_modules/.pnpm/@duckdb+node-api@*/node_modules/@duckdb/node-api/**/*',
  'node_modules/.pnpm/@duckdb+node-bindings@*/node_modules/@duckdb/node-bindings/**/*',
  'node_modules/.pnpm/@duckdb+node-bindings-*@*/node_modules/@duckdb/node-bindings-*/**/*',
];

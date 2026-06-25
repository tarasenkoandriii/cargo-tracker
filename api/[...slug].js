// Vercel serverless entry (catch-all for /api/*).
//
// This is plain JS on purpose: the NestJS app is pre-compiled by `nest build`
// into ./dist-server (with decorator metadata emitted by tsc). Requiring the
// already-compiled JS avoids the well-known esbuild limitation around
// `emitDecoratorMetadata`, which otherwise breaks NestJS dependency injection
// when a function is TS-compiled by Vercel.
//
// The Express instance is created once and reused across warm invocations.
require('reflect-metadata');
const { createServer } = require('../dist-server/serverless.js');

let serverPromise = null;

module.exports = async (req, res) => {
  if (!serverPromise) serverPromise = createServer();
  const app = await serverPromise;
  return app(req, res);
};

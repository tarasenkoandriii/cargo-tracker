// Copies the JSON Schema into build outputs so it is available at runtime
// both for the serverless function (dist-server/schema) and as a static
// asset (dist/response.schema.json). Pure Node, no dependencies.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'schema', 'response.schema.json');

if (!fs.existsSync(src)) {
  console.warn('[copy-schema] source not found:', src);
  process.exit(0);
}

const targets = [
  path.join(root, 'dist-server', 'schema', 'response.schema.json'),
  path.join(root, 'dist', 'response.schema.json'),
];

for (const dest of targets) {
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log('[copy-schema] ->', path.relative(root, dest));
  } catch (err) {
    console.warn('[copy-schema] skip', dest, String(err && err.message));
  }
}

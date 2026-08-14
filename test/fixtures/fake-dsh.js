'use strict';

/**
 * Stand-in for `dsh web --host --port`. Serves a small HTML page so lifecycle
 * tests can spawn/ready/stop without the real harness.
 */
const http = require('node:http');

function argValue(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1];
}

if (process.argv.includes('--missing')) {
  process.stderr.write('fake-dsh: simulated missing binary path\n');
  process.exit(2);
}

const command = process.argv[2];
if (command !== 'web') {
  process.stderr.write(`fake-dsh: expected "web", got ${command}\n`);
  process.exit(2);
}

const host = argValue('--host') || '127.0.0.1';
const port = Number(argValue('--port') || 0);

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(
    '<!DOCTYPE html><html lang="en"><head><title>DeepSeek Harness</title></head>'
    + '<body data-standin="dsh-web"><h1>DeepSeek Harness</h1></body></html>\n',
  );
});

server.listen(port, host, () => {
  const addr = server.address();
  process.stdout.write(`fake-dsh listening http://${addr.address}:${addr.port}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

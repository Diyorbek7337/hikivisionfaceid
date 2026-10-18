'use strict';
const fs = require('node:fs');
const path = require('node:path');

/**
 * Port selection: PORT from .env, otherwise the port used last time (data/port.json), otherwise 3000.
 * If it is busy, the next free port is used and remembered, so terminals keep working after restarts.
 */
function preferredPort(cfg, env = process.env) {
  if (env.PORT) return { port: Number(env.PORT), fixed: true };
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(cfg.dataDir, 'port.json'), 'utf8'));
    if (Number(saved.port)) return { port: Number(saved.port), fixed: false };
  } catch { /* first run */ }
  return { port: 3000, fixed: false };
}

function rememberPort(cfg, port) {
  try {
    fs.mkdirSync(cfg.dataDir, { recursive: true });
    fs.writeFileSync(path.join(cfg.dataDir, 'port.json'), JSON.stringify({ port }));
  } catch { /* not critical */ }
}

/** Listens on `start`, or the next free port (up to `tries` ports). Resolves { server, port }. */
function listenWithFallback(app, start, tries = 30) {
  return new Promise((resolve, reject) => {
    let port = start;
    const attempt = () => {
      const server = app.listen(port);
      server.once('listening', () => resolve({ server, port }));
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && port < start + tries - 1) {
          port += 1;
          attempt();
        } else reject(err);
      });
    };
    attempt();
  });
}

module.exports = { preferredPort, rememberPort, listenWithFallback };

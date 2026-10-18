'use strict';
const os = require('node:os');
const { execFileSync } = require('node:child_process');

/** Private IPv4 addresses of this computer (e.g. 192.168.1.10), most likely LAN address first. */
function lanAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (/vethernet|virtualbox|vmware|docker|wsl|hyper-v|loopback|tailscale|zerotier/i.test(name)) continue;
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) out.push(a.address);
    }
  }
  return out.sort((a, b) => (b.startsWith('192.168.') ? 1 : 0) - (a.startsWith('192.168.') ? 1 : 0));
}

/**
 * Which program listens on this TCP port (Windows only): { pid, name } or null.
 * Shown when the system's port is taken, so the user knows what to close.
 */
function portOwner(port, platform = process.platform) {
  if (platform !== 'win32') return null;
  try {
    const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    const pid = parseNetstat(out, port);
    if (!pid) return null;
    let name = '';
    try {
      const t = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
      name = (/^"([^"]+)"/.exec(t.trim()) || [])[1] || '';
    } catch { /* name unknown */ }
    return { pid, name };
  } catch {
    return null;
  }
}

/** PID listening on the port in `netstat -ano` output (any language: the state word is not checked, the remote address is). */
function parseNetstat(text, port) {
  for (const line of String(text).split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || !/^TCP/i.test(cols[0])) continue;
    const local = cols[1];
    const remote = cols[2];
    if (!local.endsWith(`:${port}`)) continue;
    if (!/^(0\.0\.0\.0|\[::\]):0$/.test(remote)) continue; // listening sockets have no remote side
    const pid = Number(cols[cols.length - 1]);
    if (pid) return pid;
  }
  return null;
}

module.exports = { lanAddresses, portOwner, parseNetstat };

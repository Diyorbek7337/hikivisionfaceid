'use strict';
const fs = require('node:fs');
const path = require('node:path');

/** Loads bridge/.env (simple KEY=VALUE lines) into process.env without overriding existing values. */
function loadEnvFile(file = path.join(__dirname, '..', '.env')) {
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return true;
}

module.exports = { loadEnvFile };

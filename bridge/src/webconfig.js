'use strict';
/**
 * Reads the Firebase web config. Accepts plain JSON or the snippet copied from Firebase Console:
 *   const firebaseConfig = { apiKey: "…", authDomain: "…", … };
 */
function parseWebConfig(text) {
  const t = String(text || '').replace(/^﻿/, '');
  try {
    return JSON.parse(t);
  } catch { /* fall through */ }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('Faylda { … } topilmadi');
  const body = t.slice(start, end + 1)
    .replace(/\/\/[^\n]*/g, '') // comments
    .replace(/'([^']*)'/g, '"$1"') // single -> double quotes
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":') // unquoted keys
    .replace(/,\s*}/g, '}'); // trailing comma
  return JSON.parse(body);
}

module.exports = { parseWebConfig };

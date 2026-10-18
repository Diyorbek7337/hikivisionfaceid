// Exit code 1 when web/out is missing or older than the source (new version copied in) -> rebuild.
const fs = require('fs');
const path = require('path');

const root = __dirname;
const built = path.join(root, 'out', 'index.html');
if (!fs.existsSync(built)) process.exit(1);
const builtAt = fs.statSync(built).mtimeMs;

function newest(p) {
  const st = fs.statSync(p);
  if (!st.isDirectory()) return st.mtimeMs;
  let m = 0;
  for (const f of fs.readdirSync(p)) m = Math.max(m, newest(path.join(p, f)));
  return m;
}
const sources = ['src', 'public', 'package.json', 'next.config.mjs'].map((f) => path.join(root, f)).filter((f) => fs.existsSync(f));
process.exit(Math.max(...sources.map(newest)) > builtAt ? 1 : 0);

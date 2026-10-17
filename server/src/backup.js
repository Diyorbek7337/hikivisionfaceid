'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { localDate } = require('./time');

/** Daily copies of the database in data/backups (keeps the last `keep` days). */
function createBackup({ db, dir, tz, keep = 30, log = console }) {
  function snapshot(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) fs.rmSync(file);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    return file;
  }

  function daily() {
    try {
      const file = path.join(dir, `davomat-${localDate(new Date(), tz)}.db`);
      if (!fs.existsSync(file)) {
        snapshot(file);
        log.log(`💾 Zaxira nusxa: ${file}`);
      }
      const files = fs.readdirSync(dir).filter((f) => /^davomat-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
      for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.rmSync(path.join(dir, f));
    } catch (err) {
      log.error('Zaxira nusxa xatosi:', err.message);
    }
  }

  return { snapshot, daily };
}

module.exports = { createBackup };

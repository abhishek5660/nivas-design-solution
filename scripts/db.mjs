// Starts a real PostgreSQL server (embedded-postgres) for local development.
// Data lives in ./.pgdata (override with PG_DATA_DIR), port 5433 (override with PG_PORT).
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.env.PG_DATA_DIR || '.pgdata');
const port = Number(process.env.PG_PORT || 5433);
const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port, persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'] });

const fresh = !fs.existsSync(path.join(dir, 'PG_VERSION'));
if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase('nivas');
console.log(`[db] PostgreSQL ready on port ${port} (database "nivas", data in ${dir})`);
const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);

// One-command local development: starts a local PostgreSQL (if nothing listens on PG_PORT),
// applies the schema, then runs the Next.js dev server on PORT (default 3000).
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';

const pgPort = Number(process.env.PG_PORT || 5433);
const port = String(process.env.PORT || 3000);
const up = () => new Promise((r) => { const s = net.connect(pgPort, '127.0.0.1'); s.on('connect', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });
let db;
if (!(await up())) {
  console.log('[dev] starting local PostgreSQL…');
  db = spawn(process.execPath, ['scripts/db.mjs'], { stdio: 'inherit' });
  for (let i = 0; i < 90 && !(await up()); i++) await new Promise((r) => setTimeout(r, 1000));
  if (!(await up())) { console.error('[dev] PostgreSQL did not start'); process.exit(1); }
} else console.log(`[dev] using PostgreSQL on port ${pgPort}`);
const push = spawnSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], { stdio: 'inherit', shell: true });
if (push.status !== 0) { console.error('[dev] could not apply the database schema'); db?.kill(); process.exit(1); }
const next = spawn('npx', ['next', 'dev', '-p', port], { stdio: 'inherit', shell: true });
const end = () => { next.kill(); db?.kill(); process.exit(0); };
process.on('SIGINT', end); process.on('SIGTERM', end);
next.on('exit', end);

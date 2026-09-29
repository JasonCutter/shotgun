import { Pool } from 'pg';

import { verifyVPProjectionReplay } from './vp-projection-replay.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for VP replay verification.');

const pool = new Pool({ connectionString: databaseUrl });
try {
  const projects = await pool.query<{ project_id: string }>(
    `SELECT DISTINCT project_id FROM vp.assertions
     UNION SELECT DISTINCT project_id FROM vp.history_events
     UNION SELECT DISTINCT project_id FROM vp.project_epochs
     ORDER BY project_id`,
  );
  let matched = true;
  for (const project of projects.rows) {
    const report = await verifyVPProjectionReplay(pool, project.project_id);
    console.log(JSON.stringify(report));
    matched &&= report.matches;
  }
  console.log(`VP projection replay: ${matched ? 'PASS' : 'FAIL'} (${projects.rowCount} scopes)`);
  if (!matched) process.exitCode = 1;
} finally {
  await pool.end();
}

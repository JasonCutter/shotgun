/* global process */

if (process.env.SHOTGUN_TEST_WORKER_FAIL === '1') {
  process.send?.(
    {
      type: 'startup-failure',
      code: 'DATABASE_UNAVAILABLE',
      message: 'synthetic temporary PostgreSQL outage',
    },
    () => process.exit(1),
  );
} else {
  process.send?.({ type: 'ready' });
  process.on('message', (message) => {
    if (message?.type === 'shutdown') process.exit(0);
  });
}

import { spawnSync } from 'node:child_process';
// c8 inherits NODE_V8_COVERAGE across Vitest workers and the actual CLI fixtures.
for (const [command, args] of [
  [process.execPath, ['node_modules/vitest/vitest.mjs', 'run']],
  [
    'bash',
    [
      'test_harness.sh',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '10',
      '11',
      '12',
      '13',
      '14',
      '15',
      '16',
      '17',
      '18',
      '19',
    ],
  ],
]) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

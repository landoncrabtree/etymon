import { expect, it } from 'vitest';
import { join } from 'node:path';
import { noSymlink } from '../src/core/fs.js';

it('validates native paths without applying portable path restrictions', async () => {
  const root = join(process.cwd(), 'root');
  await expect(noSymlink(join(root, 'nested\\path'), root)).resolves.toBeUndefined();
  await expect(noSymlink(join(root, '..', 'outside'), root)).rejects.toMatchObject({
    code: 'UNSAFE_PATH',
  });
});

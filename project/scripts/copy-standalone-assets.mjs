import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const standaloneDir = path.join(projectRoot, '.next', 'standalone');

async function copyIfExists(from, to) {
  try {
    await rm(to, { recursive: true, force: true });
    await mkdir(path.dirname(to), { recursive: true });
    await cp(from, to, { recursive: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

await copyIfExists(path.join(projectRoot, 'public'), path.join(standaloneDir, 'public'));
await copyIfExists(path.join(projectRoot, '.next', 'static'), path.join(standaloneDir, '.next', 'static'));

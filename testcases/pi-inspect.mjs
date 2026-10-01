import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [packageDirectory, cwd, home] = process.argv.slice(2);
const { DefaultResourceLoader } = await import(
  pathToFileURL(join(packageDirectory, 'dist/index.js')).href
);
async function inspect(directory) {
  const loader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: join(home, '.pi/agent'),
    noExtensions: true,
    noThemes: true,
    noPromptTemplates: true,
  });
  await loader.reload();
  return { skills: loader.getSkills(), context: loader.getAgentsFiles() };
}
const root = await inspect(cwd),
  nested = await inspect(join(cwd, 'src'));
console.log(JSON.stringify({ skills: root.skills, root: root.context, nested: nested.context }));

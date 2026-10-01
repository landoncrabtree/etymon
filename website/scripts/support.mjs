import { profiles } from "../../dist/index.js";
import { mkdir, writeFile } from "node:fs/promises";

// Build-time export keeps the website's support list tied to CLI profiles.
const support = profiles.map(
  ({ id, label, skill, agent, mcp, rule, projectOnly, globalMcpOnly }) => ({
    id,
    label,
    skills: Boolean(skill),
    agents: Boolean(agent),
    mcp: Boolean(mcp),
    rules: Boolean(rule),
    projectOnly: Boolean(projectOnly),
    globalMcpOnly: Boolean(globalMcpOnly),
  }),
);
await mkdir(new URL("../src/data/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../src/data/support.json", import.meta.url),
  JSON.stringify(support, null, 2) + "\n",
);

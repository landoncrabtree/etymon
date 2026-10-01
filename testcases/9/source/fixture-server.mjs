import { createInterface } from 'node:readline';
const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  const result =
    message.method === 'initialize'
      ? {
          protocolVersion: message.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'etymon-fixture', version: '1.0.0' },
        }
      : message.method === 'tools/list'
        ? {
            tools: [
              {
                name: 'fixture_echo',
                description: 'Deterministic fixture tool',
                inputSchema: { type: 'object', properties: {} },
              },
            ],
          }
        : {};
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
});

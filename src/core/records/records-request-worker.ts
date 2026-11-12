// Child-process fixture for records.waiting.test.ts; no Flow or agent harness.
import { createHttpExecutor } from './sql/httpExecutor';

process.on('message', (message: { type: string; url: string; token: string; index: number }) => {
  if (message.type === 'ping') {
    process.send?.({ type: 'pong' });
    return;
  }
  if (message.type !== 'request') return;
  const client = createHttpExecutor({ url: message.url, token: message.token, timeoutMs: 15_000 });
  void client.transaction([
    { sql: 'INSERT INTO waiting_probe(caller, step) VALUES ($1, $2)', params: [message.index, 'start'] },
    { sql: 'INSERT INTO waiting_probe(caller, step) VALUES ($1, $2)', params: [message.index, 'end'] },
  ]).then(() => process.send?.({ type: 'done', index: message.index }))
    .catch(error => process.send?.({ type: 'failure', message: error.message }));
});
process.send?.({ type: 'ready' });

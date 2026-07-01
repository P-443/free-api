// Simple static server for the HC Panel
// Serves the dashboard + proxies API calls to the backend
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const HTML = readFileSync(join(__dirname, 'index.html'), 'utf-8');

createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(HTML);
}).listen(PORT, () => {
  console.log(`[Panel] HC Panel running on http://0.0.0.0:${PORT}`);
  console.log(`[Panel] Configure API_URL in the panel UI to point to your API server`);
});

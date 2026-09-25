import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.cwd());
const port = Number(process.env.PORT) || 49153;
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.glb': 'model/gltf-binary',
  '.json': 'application/json; charset=utf-8',
};

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const relativePath = normalize(pathname).replace(/^([/\\])+/, '');
  let filePath = resolve(join(root, relativePath));

  if (!filePath.startsWith(`${root}\\`) && filePath !== root) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    if (statSync(filePath).isDirectory()) filePath = join(filePath, 'index.html');
    const fileStats = statSync(filePath);
    const type = mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream';
    const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), fileStats.size - 1) : fileStats.size - 1;
      if (start > end || start >= fileStats.size) {
        response.writeHead(416, { 'Content-Range': `bytes */${fileStats.size}` }).end();
        return;
      }
      response.writeHead(206, {
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${fileStats.size}`,
        'Content-Type': type,
      });
      createReadStream(filePath, { start, end }).pipe(response);
      return;
    }
    response.writeHead(200, {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Content-Length': fileStats.size,
      'Content-Type': type,
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Demo server: http://127.0.0.1:${port}/viewer/morioka-sandbox/`);
});

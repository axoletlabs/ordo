import { createServer } from 'node:http';

const port = Number(process.env.WEBKIT_TEST_PORT ?? 8739);
createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/redirect') {
    response.writeHead(302, { Location: `http://www.publisher.ordo.test:${port}/` });
    response.end();
  } else if (request.url === '/ad.js') {
    response.setHeader('Content-Type', 'application/javascript');
    response.end('window.fixtureAdRan = true;');
  } else if (request.url === '/essential.js') {
    response.setHeader('Content-Type', 'application/javascript');
    response.end('window.fixtureEssentialRan = true;');
  } else if (request.url === '/frame') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<p id="frame-ok">Embedded content works</p>');
  } else {
    response.setHeader('Set-Cookie', 'fixture=yes; Path=/; SameSite=Lax');
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html><head><script src="http://ads.doubleclick.net:${port}/ad.js"></script>
      <script src="/essential.js"></script></head><body><h1>Publisher</h1><iframe src="/frame"></iframe>
      <form action="/next"><input name="q"><button>Continue</button></form></body></html>`);
  }
}).listen(port, '0.0.0.0', () => console.log(`WebKit fixture listening on ${port}`));

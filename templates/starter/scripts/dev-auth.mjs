import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

/** ローカル開発専用の認証サーバー。Workerからimportせず、公開デプロイに含めない。 */
export async function startDevAuth({ port = 8790, appOrigin = 'http://127.0.0.1:8787' } = {}) {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = { ...await exportJWK(publicKey), kid: 'local-development', alg: 'ES256', use: 'sig' };
  let issuer;
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => { response.writeHead(500); response.end('Local authentication failed'); });
  });
  async function handle(request, response) {
    const url = new URL(request.url, issuer);
    response.setHeader('Cache-Control', 'no-store');
    if (request.headers.origin && request.headers.origin !== appOrigin) { response.writeHead(403); response.end(); return; }
    response.setHeader('Access-Control-Allow-Origin', appOrigin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    if (url.pathname === '/.well-known/jwks.json') {
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ keys: [jwk] })); return;
    }
    if (url.pathname !== '/login' && url.pathname !== '/refresh') { response.writeHead(404); response.end(); return; }
    const cookieActor = request.headers.cookie?.match(/(?:^|;\s*)__dev_actor=([0-9a-f-]{36})(?:;|$)/)?.[1];
    if (url.pathname === '/refresh' && !cookieActor) { response.writeHead(401); response.end(); return; }
    const actorId = cookieActor ?? randomUUID();
    const token = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: jwk.kid })
      .setIssuer(issuer).setAudience('def-game-local').setSubject(actorId).setIssuedAt().setExpirationTime('15m').sign(privateKey);
    response.setHeader('Set-Cookie', [
      `__token=${token}; HttpOnly; SameSite=Lax; Path=/`,
      `__dev_actor=${actorId}; HttpOnly; SameSite=Lax; Path=/`,
    ]);
    if (url.pathname === '/refresh') { response.writeHead(204); response.end(); return; }
    const target = new URL(url.searchParams.get('return_to') ?? '/', appOrigin);
    if (target.origin !== appOrigin) { response.writeHead(400); response.end('Invalid return URL'); return; }
    response.writeHead(302, { Location: target.toString() }); response.end();
  }
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  issuer = `http://127.0.0.1:${server.address().port}`;
  return { issuer, jwksUrl: `${issuer}/.well-known/jwks.json`, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

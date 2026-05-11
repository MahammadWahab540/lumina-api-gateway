import { Socket, connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { IncomingMessage, Server } from 'node:http';

type UpgradeLogger = Pick<Console, 'warn' | 'error'>;

const HMR_PATH = '/_next/webpack-hmr';

export function isOpenMaicHmrPath(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    return new URL(rawUrl, 'http://localhost').pathname === HMR_PATH;
  } catch {
    return false;
  }
}

export function getOpenMaicHmrTarget(openmaicServiceUrl: string, requestUrl: string): URL {
  const base = new URL(openmaicServiceUrl);
  const incoming = new URL(requestUrl, base);
  return new URL(`${HMR_PATH}${incoming.search}`, base);
}

export function buildOpenMaicHmrUpgradeRequest(
  request: Pick<IncomingMessage, 'method' | 'httpVersion' | 'headers'>,
  target: URL,
): string {
  const path = `${target.pathname}${target.search}`;
  const lines = [`${request.method || 'GET'} ${path} HTTP/${request.httpVersion || '1.1'}`];

  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (key.toLowerCase() === 'host') {
      lines.push(`host: ${target.host}`);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) lines.push(`${key}: ${item}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }

  if (!('host' in request.headers)) {
    lines.push(`host: ${target.host}`);
  }

  return `${lines.join('\r\n')}\r\n\r\n`;
}

export function installOpenMaicHmrProxy(
  server: Server,
  openmaicServiceUrl: string,
  logger: UpgradeLogger = console,
): void {
  server.on('upgrade', (request: IncomingMessage, clientSocket: Socket, head: Buffer) => {
    if (!isOpenMaicHmrPath(request.url)) {
      return;
    }

    const target = getOpenMaicHmrTarget(openmaicServiceUrl, request.url || HMR_PATH);
    const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
    const upstreamSocket =
      target.protocol === 'https:'
        ? tlsConnect({ port, host: target.hostname }, onUpstreamConnected)
        : netConnect(port, target.hostname, onUpstreamConnected);

    function onUpstreamConnected() {
      upstreamSocket.write(buildOpenMaicHmrUpgradeRequest(request, target));
      if (head.length > 0) upstreamSocket.write(head);
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);
    }

    upstreamSocket.on('error', (error: Error) => {
      logger.error(`OpenMAIC HMR proxy failed: ${error.message}`);
      clientSocket.destroy();
    });

    clientSocket.on('error', (error) => {
      logger.warn(`OpenMAIC HMR client socket failed: ${error.message}`);
      upstreamSocket.destroy();
    });
  });
}

import { buildOpenMaicHmrUpgradeRequest, getOpenMaicHmrTarget, isOpenMaicHmrPath } from './hmr-proxy';

describe('OpenMAIC HMR proxy helpers', () => {
  it('recognizes the Next.js HMR endpoint only', () => {
    expect(isOpenMaicHmrPath('/_next/webpack-hmr?id=abc')).toBe(true);
    expect(isOpenMaicHmrPath('/_next/static/chunk.js')).toBe(false);
    expect(isOpenMaicHmrPath('/openmaic/proxy/classroom/stage-1')).toBe(false);
  });

  it('builds an upstream HMR target from the OpenMAIC service URL', () => {
    const target = getOpenMaicHmrTarget('http://127.0.0.1:3000/base', '/_next/webpack-hmr?id=abc');

    expect(target.protocol).toBe('http:');
    expect(target.host).toBe('127.0.0.1:3000');
    expect(target.pathname).toBe('/_next/webpack-hmr');
    expect(target.search).toBe('?id=abc');
  });

  it('rewrites the Host header while preserving the WebSocket upgrade headers', () => {
    const target = new URL('http://127.0.0.1:3000/_next/webpack-hmr?id=abc');
    const raw = buildOpenMaicHmrUpgradeRequest(
      {
        method: 'GET',
        httpVersion: '1.1',
        headers: {
          host: 'localhost:3001',
          upgrade: 'websocket',
          connection: 'Upgrade',
          'sec-websocket-key': 'key',
        },
      },
      target,
    );

    expect(raw).toContain('GET /_next/webpack-hmr?id=abc HTTP/1.1\r\n');
    expect(raw).toContain('host: 127.0.0.1:3000\r\n');
    expect(raw).toContain('upgrade: websocket\r\n');
    expect(raw).not.toContain('host: localhost:3001\r\n');
  });
});

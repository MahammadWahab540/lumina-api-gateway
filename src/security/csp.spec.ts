import { buildCspDirectives } from './csp';

describe('buildCspDirectives', () => {
  it('allows jsDelivr ONNX runtime modules used by Kokoro Web TTS', () => {
    const directives = buildCspDirectives([]);

    expect(directives['script-src']).toContain('https://cdn.jsdelivr.net');
    expect(directives['connect-src']).toContain('https://cdn.jsdelivr.net');
  });
});

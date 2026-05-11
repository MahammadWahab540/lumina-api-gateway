import { buildHelmetOptions } from './helmet-options';

describe('buildHelmetOptions', () => {
  it('keeps OpenMAIC embeddable by disabling X-Frame-Options and cross-origin isolation defaults', () => {
    const options = buildHelmetOptions(['http://localhost:8080']);

    expect(options.frameguard).toBe(false);
    expect(options.crossOriginOpenerPolicy).toBe(false);
    expect(options.crossOriginResourcePolicy).toBe(false);
  });

  it('uses the explicit Kokoro-capable CSP without upgrade-insecure-requests', () => {
    const options = buildHelmetOptions(['http://localhost:8080']);
    const csp = options.contentSecurityPolicy;

    expect(csp).toMatchObject({ useDefaults: false });
    expect(csp && typeof csp === 'object' && 'directives' in csp ? csp.directives : {}).not.toHaveProperty(
      'upgrade-insecure-requests',
    );
  });
});

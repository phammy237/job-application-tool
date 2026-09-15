import { describe, expect, it } from 'vitest';
import { isSafeExternalUrl } from './is-safe-external-url';

describe('isSafeExternalUrl', () => {
  it('accepts an ordinary https URL', () => {
    expect(isSafeExternalUrl('https://acme.com/newsroom/announcement')).toBe(true);
  });

  it('accepts an ordinary http URL', () => {
    expect(isSafeExternalUrl('http://acme.com/about')).toBe(true);
  });

  it('rejects an unparseable URL', () => {
    expect(isSafeExternalUrl('not a url')).toBe(false);
  });

  it('rejects non-http(s) schemes', () => {
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeExternalUrl('ftp://example.com/file')).toBe(false);
  });

  it('rejects a URL with embedded credentials', () => {
    expect(isSafeExternalUrl('https://user:pass@acme.com/')).toBe(false);
  });

  it('rejects localhost and its subdomains', () => {
    expect(isSafeExternalUrl('http://localhost/')).toBe(false);
    expect(isSafeExternalUrl('http://LOCALHOST/')).toBe(false);
    expect(isSafeExternalUrl('http://foo.localhost/')).toBe(false);
  });

  it('rejects loopback and private IPv4 ranges', () => {
    expect(isSafeExternalUrl('http://127.0.0.1/')).toBe(false);
    expect(isSafeExternalUrl('http://10.0.0.5/')).toBe(false);
    expect(isSafeExternalUrl('http://172.16.0.1/')).toBe(false);
    expect(isSafeExternalUrl('http://192.168.1.1/')).toBe(false);
  });

  it('rejects link-local IPv4, including the cloud metadata address', () => {
    expect(isSafeExternalUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
  });

  it('accepts a public IPv4 literal', () => {
    expect(isSafeExternalUrl('http://93.184.216.34/')).toBe(true);
  });

  it('rejects loopback and link-local IPv6', () => {
    expect(isSafeExternalUrl('http://[::1]/')).toBe(false);
    expect(isSafeExternalUrl('http://[fe80::1]/')).toBe(false);
    expect(isSafeExternalUrl('http://[fc00::1]/')).toBe(false);
  });

  it('rejects IP-literal decimal/hex obfuscation tricks', () => {
    expect(isSafeExternalUrl('http://2130706433/')).toBe(false); // decimal for 127.0.0.1
    expect(isSafeExternalUrl('http://0x7f000001/')).toBe(false); // hex for 127.0.0.1
  });

  it('rejects malformed IPv4-looking hostnames rather than treating them as safe', () => {
    expect(isSafeExternalUrl('http://999.999.999.999/')).toBe(false);
  });
});

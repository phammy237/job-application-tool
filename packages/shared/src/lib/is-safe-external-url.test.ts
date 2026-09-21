import { describe, expect, it } from 'vitest';
import { isNonPublicIpAddress, isSafeExternalUrl } from './is-safe-external-url';

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

describe('isSafeExternalUrl — extended internal-address coverage', () => {
  it.each([
    'http://localhost./',
    'http://printer.local/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://db.localdomain/',
    'http://router.home.arpa/',
    'http://0.0.0.0/',
    'http://100.64.0.1/', // CGNAT
    'http://198.18.0.1/', // benchmarking
    'http://192.0.0.1/',
    'http://[::]/',
    'http://[fe90::1]/', // fe80::/10 spans fe80–febf
    'http://[febf::1]/',
    'http://[fd12:3456:789a::1]/', // fc00::/7
    'http://[::ffff:127.0.0.1]/', // IPv4-mapped loopback
    'http://[ff02::1]/', // multicast
    'http://[2002:7f00:1::]/', // 6to4 embedding 127.0.0.1
    'http://[64:ff9b::7f00:1]/', // NAT64 embedding 127.0.0.1
    'http://127.1/', // short IPv4 form (normalized by the URL parser)
    'http://0177.0.0.1/', // octal
    'http://172.31.255.255/',
    'http://169.254.169.254/',
    'file:///etc/passwd',
  ])('rejects %s', (url) => {
    expect(isSafeExternalUrl(url)).toBe(false);
  });

  it.each([
    'https://careers.tiktok.com/m/position/123/detail',
    'https://lifeattiktok.com/search/123',
    'https://93.184.216.34/',
    'https://172.32.0.1/', // just outside 172.16/12
    'https://[2606:4700:4700::1111]/',
    'https://[2001:4860:4860::8888]/', // public IPv6 that starts with 2001:
  ])('accepts %s', (url) => {
    expect(isSafeExternalUrl(url)).toBe(true);
  });
});

describe('isNonPublicIpAddress', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.0.1', '169.254.169.254', '0.0.0.0', '100.64.0.1',
    '::1', '::', 'fe80::1', 'fe90::1', 'fc00::1', 'fd00::1', '::ffff:10.0.0.1', '[::1]', 'fe80::1%eth0',
    'not-an-ip', '',
  ])('%s is non-public', (address) => {
    expect(isNonPublicIpAddress(address)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111', '[2606:4700:4700::1111]'])('%s is public', (address) => {
    expect(isNonPublicIpAddress(address)).toBe(false);
  });
});

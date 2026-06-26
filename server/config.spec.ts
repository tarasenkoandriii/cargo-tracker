import { describe, it, expect, afterEach } from 'vitest';
import { webshareProxyUrl } from './config';

const WS = [
  'WEBSHARE_PROXY_USERNAME',
  'WEBSHARE_PROXY_PASSWORD',
  'WEBSHARE_PROXY_HOST',
  'WEBSHARE_PROXY_PORT',
  'WEBSHARE_PROXY_COUNTRY',
  'WEBSHARE_PROXY_ROTATE',
];

function clear() {
  for (const k of WS) delete process.env[k];
}

describe('webshareProxyUrl', () => {
  afterEach(clear);

  it('returns null without credentials', () => {
    clear();
    expect(webshareProxyUrl()).toBeNull();
  });

  it('builds a rotating backbone URL from username/password', () => {
    clear();
    process.env.WEBSHARE_PROXY_USERNAME = 'abc';
    process.env.WEBSHARE_PROXY_PASSWORD = 'secret';
    expect(webshareProxyUrl()).toBe('http://abc-rotate:secret@p.webshare.io:80');
  });

  it('appends a lowercased country segment', () => {
    clear();
    process.env.WEBSHARE_PROXY_USERNAME = 'abc';
    process.env.WEBSHARE_PROXY_PASSWORD = 'secret';
    process.env.WEBSHARE_PROXY_COUNTRY = 'US';
    expect(webshareProxyUrl()).toBe('http://abc-us-rotate:secret@p.webshare.io:80');
  });

  it('omits -rotate when rotation is disabled', () => {
    clear();
    process.env.WEBSHARE_PROXY_USERNAME = 'abc';
    process.env.WEBSHARE_PROXY_PASSWORD = 'secret';
    process.env.WEBSHARE_PROXY_ROTATE = 'false';
    expect(webshareProxyUrl()).toBe('http://abc:secret@p.webshare.io:80');
  });

  it('honors custom host and port', () => {
    clear();
    process.env.WEBSHARE_PROXY_USERNAME = 'abc';
    process.env.WEBSHARE_PROXY_PASSWORD = 'secret';
    process.env.WEBSHARE_PROXY_HOST = 'proxy.example.com';
    process.env.WEBSHARE_PROXY_PORT = '1080';
    expect(webshareProxyUrl()).toBe('http://abc-rotate:secret@proxy.example.com:1080');
  });
});

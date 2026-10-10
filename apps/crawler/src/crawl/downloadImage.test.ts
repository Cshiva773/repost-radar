import { describe, expect, it } from 'vitest';
import { downloadImage } from './downloadImage.js';

function fakeFetch(bodyBytes: number, headerDetails: Record<string, string>, statusCode = 200): typeof fetch {
  return (async () => new Response(new Uint8Array(bodyBytes), { status: statusCode, headers: headerDetails })) as typeof fetch;
}

describe('downloadImage', () => {
  it('returns the bytes of an image under the cap', async () => {
    const downloadResult = await downloadImage('https://x/a.jpg', 1000, 'ua', fakeFetch(500, { 'content-type': 'image/jpeg' }));
    expect(downloadResult).toMatchObject({ isError: false, contentType: 'image/jpeg' });
    if (!downloadResult.isError) expect(downloadResult.imageBuffer.byteLength).toBe(500);
  });

  it('rejects a body larger than the cap even without content-length', async () => {
    const downloadResult = await downloadImage('https://x/a.jpg', 100, 'ua', fakeFetch(500, { 'content-type': 'image/png' }));
    expect(downloadResult).toMatchObject({ isError: true, reason: 'too-large' });
  });

  it('rejects early on an oversized content-length', async () => {
    const downloadResult = await downloadImage('https://x/a.jpg', 100, 'ua', fakeFetch(10, { 'content-type': 'image/png', 'content-length': '999' }));
    expect(downloadResult).toMatchObject({ isError: true, reason: 'too-large' });
  });

  it('rejects non-image content types and HTTP errors', async () => {
    expect(await downloadImage('https://x/a', 100, 'ua', fakeFetch(10, { 'content-type': 'text/html' }))).toMatchObject({ reason: 'not-image' });
    expect(await downloadImage('https://x/a', 100, 'ua', fakeFetch(10, { 'content-type': 'image/png' }, 404))).toMatchObject({ reason: 'http-error' });
  });
});

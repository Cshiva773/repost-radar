// Downloads one post image with a hard byte cap, refusing anything that is not an image.

export type DownloadResult =
  | { isError: false; imageBuffer: Buffer; contentType: string }
  | { isError: true; reason: 'too-large' | 'not-image' | 'http-error' | 'network-error'; message: string };

const ACCEPTED_CONTENT_TYPE_PATTERN = /^image\/(jpeg|png|webp)/i;

async function readWithCap(responseBody: ReadableStream<Uint8Array>, maxBytes: number): Promise<Buffer | undefined> {
  const chunkList: Uint8Array[] = [];
  let receivedBytes = 0;
  const bodyReader = responseBody.getReader();
  for (;;) {
    const { done, value } = await bodyReader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > maxBytes) {
      await bodyReader.cancel();
      return undefined;
    }
    chunkList.push(value);
  }
  return Buffer.concat(chunkList);
}

export async function downloadImage(imageUrl: string, maxBytes: number, userAgent: string, fetchImpl: typeof fetch = fetch): Promise<DownloadResult> {
  try {
    const imageResponse = await fetchImpl(imageUrl, { headers: { 'User-Agent': userAgent } });
    if (!imageResponse.ok || !imageResponse.body) return { isError: true, reason: 'http-error', message: `HTTP ${imageResponse.status}` };
    const contentType = imageResponse.headers.get('content-type') ?? '';
    if (!ACCEPTED_CONTENT_TYPE_PATTERN.test(contentType)) return { isError: true, reason: 'not-image', message: contentType || 'no content-type' };
    if (Number(imageResponse.headers.get('content-length') ?? 0) > maxBytes) {
      return { isError: true, reason: 'too-large', message: 'content-length over cap' };
    }
    const imageBuffer = await readWithCap(imageResponse.body, maxBytes);
    if (!imageBuffer) return { isError: true, reason: 'too-large', message: 'body over cap' };
    return { isError: false, imageBuffer, contentType: contentType.split(';')[0] ?? contentType };
  } catch (error) {
    return { isError: true, reason: 'network-error', message: error instanceof Error ? error.message : 'Something went wrong' };
  }
}

import { ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';

/** Every outbound HTTP request has a deadline, size bound, and no redirects. */
let activeRequests = 0;
export const upstreamGet = async (url: string) => {
  if (activeRequests >= 16) throw new ServiceUnavailableException('Upstream capacity exhausted');
  activeRequests++;
  try {
    return await axios.get(url, {
      timeout: 10_000,
      maxContentLength: 8 * 1024 * 1024,
      maxBodyLength: 8 * 1024 * 1024,
      maxRedirects: 0,
    });
  } finally {
    activeRequests--;
  }
};

export async function readBoundedText(response: globalThis.Response, maxBytes = 8 * 1024 * 1024) {
  if (Number(response.headers?.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw new Error('Upstream response exceeds size limit');
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) throw new Error('Upstream response exceeds size limit');
    return text;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error('Upstream response exceeds size limit');
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

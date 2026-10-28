/**
 * Yields at most `take` bytes from `body`, after discarding `skip` leading bytes.
 *
 * Needed because a CDN may ignore our Range header and stream the whole file: we read
 * only the requested window, then cancel, so a single response can never exceed Vercel's
 * 4.5 MB payload cap.
 */
export function limitStream(body: ReadableStream<Uint8Array>, skip: number, take: number) {
  const reader = body.getReader();
  let skipped = 0;
  let sent = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            return;
          }

          let chunk = value;

          if (skipped < skip) {
            const needed = skip - skipped;
            if (chunk.byteLength <= needed) {
              skipped += chunk.byteLength;
              continue;
            }
            chunk = chunk.subarray(needed);
            skipped = skip;
          }

          if (sent + chunk.byteLength > take) {
            chunk = chunk.subarray(0, take - sent);
          }

          sent += chunk.byteLength;
          controller.enqueue(chunk);

          if (sent >= take) {
            await reader.cancel().catch(() => {});
            controller.close();
          }
          return;
        }
      } catch (error) {
        controller.error(error);
        await reader.cancel().catch(() => {});
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
}

/** Reads a whole stream into one buffer (test helper and small-response convenience). */
export async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

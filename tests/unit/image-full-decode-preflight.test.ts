import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { PythonDocumentFormatAdapter } from '../../adapters/document-format-python/src/index.js';

const authorImages = async () => {
  const { stdout } = await promisify(execFile)(
    process.env.PYTHON ?? 'python',
    [
      '-c',
      `from PIL import Image
import io,json,base64,zlib,struct
a=Image.new('RGB',(16,16),'blue');b=Image.new('RGB',(16,16),'red')
j=io.BytesIO();a.save(j,format='JPEG')
p=io.BytesIO();a.save(p,format='PNG',save_all=True,append_images=[b],duration=100,loop=0)
def chunk(t,d): return struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
bad=b'\\x89PNG\\r\\n\\x1a\\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',16,16,8,2,0,0,0))+chunk(b'IDAT',b'not-a-zlib-stream')+chunk(b'IEND',b'')
print(json.dumps({'jpeg':base64.b64encode(j.getvalue()).decode(),'animated':base64.b64encode(p.getvalue()).decode(),'badPixels':base64.b64encode(bad).decode()}))`,
    ],
    { windowsHide: true, encoding: 'utf8' },
  );
  return JSON.parse(stdout) as { jpeg: string; animated: string; badPixels: string };
};
describe('full image pixel decoding before any model description', () => {
  it.each([
    { key: 'truncatedJPEG', type: 'image/jpeg', code: 'FORMAT_CORRUPT' },
    { key: 'animated', type: 'image/png', code: 'FORMAT_UNSUPPORTED' },
    { key: 'badPixels', type: 'image/png', code: 'FORMAT_CORRUPT' },
  ] as const)('rejects $key with zero provider calls', async ({ key, type, code }) => {
    const images = await authorImages();
    const bytes =
      key === 'truncatedJPEG'
        ? Buffer.from(images.jpeg, 'base64').subarray(0, -2)
        : Buffer.from(images[key], 'base64');
    const describeImage = vi.fn().mockResolvedValue('must not be requested');
    const adapter = new PythonDocumentFormatAdapter({
      pythonExecutable: process.env.PYTHON ?? 'python',
      multimodal: { describe: describeImage },
    });
    await expect(
      adapter.transform({
        sourceId: 'image',
        sourceVersionId: 'version',
        sourceContentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        mediaType: type,
        contentBase64: bytes.toString('base64'),
      }),
    ).rejects.toMatchObject({ code });
    expect(describeImage).not.toHaveBeenCalled();
  });
  it('fully decodes an authored valid JPEG with its exact byte pin and dimensions', async () => {
    const images = await authorImages(),
      bytes = Buffer.from(images.jpeg, 'base64'),
      contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const result = await new PythonDocumentFormatAdapter({
      pythonExecutable: process.env.PYTHON ?? 'python',
    }).preflightImage({
      mediaType: 'image/jpeg',
      contentBase64: images.jpeg,
      sourceContentHash: contentHash,
    });
    expect(result).toEqual({ width: 16, height: 16, pixels: 256, contentHash });
  });
});

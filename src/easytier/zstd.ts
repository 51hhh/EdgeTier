import { decompress } from 'fzstd';
import { MAX_FRAME_SIZE } from './constants';

export function decompressZstdRpcBody(body: Uint8Array): Uint8Array {
  const decompressed = decompress(body);
  if (decompressed.byteLength > MAX_FRAME_SIZE) {
    throw new Error('decompressed EasyTier RPC body exceeds frame limit');
  }
  return decompressed;
}

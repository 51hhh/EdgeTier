import { EASYTIER_HEADER_SIZE } from './constants';

export interface EasyTierPacketHeader {
  fromPeerId: number;
  toPeerId: number;
  packetType: number;
  flags: number;
  forwardCounter: number;
  reserved: number;
  len: number;
}

export function parseEasyTierHeader(frame: ArrayBuffer): EasyTierPacketHeader | null {
  if (frame.byteLength < EASYTIER_HEADER_SIZE) return null;
  const view = new DataView(frame);
  return {
    fromPeerId: view.getUint32(0, true),
    toPeerId: view.getUint32(4, true),
    packetType: view.getUint8(8),
    flags: view.getUint8(9),
    forwardCounter: view.getUint8(10),
    reserved: view.getUint8(11),
    len: view.getUint32(12, true),
  };
}

export function createEasyTierHeader(header: EasyTierPacketHeader): ArrayBuffer {
  const buffer = new ArrayBuffer(EASYTIER_HEADER_SIZE);
  const view = new DataView(buffer);
  view.setUint32(0, header.fromPeerId, true);
  view.setUint32(4, header.toPeerId, true);
  view.setUint8(8, header.packetType);
  view.setUint8(9, header.flags);
  view.setUint8(10, header.forwardCounter);
  view.setUint8(11, header.reserved);
  view.setUint32(12, header.len, true);
  return buffer;
}

export function payloadLengthMatches(frame: ArrayBuffer, header: EasyTierPacketHeader): boolean {
  return frame.byteLength - EASYTIER_HEADER_SIZE === header.len;
}

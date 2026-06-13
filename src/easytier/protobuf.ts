const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export const WIRE_VARINT = 0;
export const WIRE_FIXED64 = 1;
export const WIRE_LEN = 2;
export const WIRE_FIXED32 = 5;

export interface ProtoTag {
  field: number;
  wire: number;
}

export class ProtoReader {
  private pos = 0;

  constructor(private readonly buf: Uint8Array) {}

  get done(): boolean {
    return this.pos >= this.buf.length;
  }

  tag(): ProtoTag {
    const raw = Number(this.varint());
    return { field: raw >>> 3, wire: raw & 0x7 };
  }

  varint(): bigint {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      if (this.pos >= this.buf.length) throw new Error('protobuf varint truncated');
      const byte = this.buf[this.pos++];
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7n;
      if (shift > 70n) throw new Error('protobuf varint too long');
    }
  }

  uint32(): number {
    return Number(this.varint() & 0xffffffffn) >>> 0;
  }

  uint64(): bigint {
    return this.varint();
  }

  int32(): number {
    return this.uint32() | 0;
  }

  bool(): boolean {
    return this.varint() !== 0n;
  }

  bytes(): Uint8Array {
    const len = Number(this.varint());
    if (!Number.isSafeInteger(len) || len < 0 || this.pos + len > this.buf.length) {
      throw new Error('protobuf length-delimited field out of range');
    }
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }

  string(): string {
    return textDecoder.decode(this.bytes());
  }

  fixed32(): number {
    if (this.pos + 4 > this.buf.length) throw new Error('protobuf fixed32 truncated');
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 4);
    this.pos += 4;
    return view.getUint32(0, true);
  }

  fixed64(): bigint {
    if (this.pos + 8 > this.buf.length) throw new Error('protobuf fixed64 truncated');
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8);
    this.pos += 8;
    return view.getBigUint64(0, true);
  }

  skip(wire: number): void {
    if (wire === WIRE_VARINT) {
      this.varint();
      return;
    }
    if (wire === WIRE_LEN) {
      this.bytes();
      return;
    }
    if (wire === WIRE_FIXED32) {
      this.fixed32();
      return;
    }
    if (wire === WIRE_FIXED64) {
      this.fixed64();
      return;
    }
    throw new Error(`unsupported protobuf wire type ${wire}`);
  }
}

export function writeTag(out: number[], field: number, wire: number): void {
  writeVarint(out, BigInt((field << 3) | wire));
}

export function writeVarint(out: number[], value: bigint | number | string): void {
  let v = typeof value === 'bigint' ? value : BigInt(value);
  if (v < 0n) v = BigInt.asUintN(64, v);
  while (v > 0x7fn) {
    out.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  out.push(Number(v));
}

export function writeUint32Field(out: number[], field: number, value: number | undefined): void {
  if (value === undefined) return;
  writeTag(out, field, WIRE_VARINT);
  writeVarint(out, value >>> 0);
}

export function writeUint64Field(out: number[], field: number, value: bigint | number | string | undefined): void {
  if (value === undefined) return;
  writeTag(out, field, WIRE_VARINT);
  writeVarint(out, value);
}

export function writeInt32Field(out: number[], field: number, value: number | undefined): void {
  if (value === undefined) return;
  writeTag(out, field, WIRE_VARINT);
  writeVarint(out, BigInt.asUintN(64, BigInt(value | 0)));
}

export function writeBoolField(out: number[], field: number, value: boolean | undefined): void {
  if (value === undefined) return;
  writeTag(out, field, WIRE_VARINT);
  writeVarint(out, value ? 1 : 0);
}

export function writeBytesField(out: number[], field: number, payload: Uint8Array | undefined): void {
  if (!payload) return;
  writeTag(out, field, WIRE_LEN);
  writeVarint(out, payload.length);
  for (const byte of payload) out.push(byte);
}

export function writeStringField(out: number[], field: number, value: string | undefined): void {
  if (value === undefined) return;
  writeBytesField(out, field, textEncoder.encode(value));
}

export function finish(out: number[]): Uint8Array {
  return Uint8Array.from(out);
}

export function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

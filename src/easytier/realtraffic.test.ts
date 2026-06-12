import { describe, expect, it } from 'vitest';
import { decryptAesGcm, deriveKeys } from './crypto';

const unhex = (s: string) => new Uint8Array((s.match(/.{2}/g) ?? []).map((h) => parseInt(h, 16)));

// Real encrypted RpcReq body (PacketType=8, flags=1) captured from easytier-core
// 2.6.4 on network "home-mesh". This is the ultimate interop proof: our
// WebCrypto AES-GCM + SipHash key derivation decrypt genuine EasyTier control
// traffic, and the plaintext is an OspfRouteRpc.SyncRouteInfo carrying the
// node's hostname / version / peer info (the full-mesh data we want to expose).
const REAL_ENCRYPTED_RPC = 'c107e99a289f5cd73cb2c1c552ee940ca178da796ed3e4bf94f7ff70c0827f0b4a00b3a1880e8b69073816153dacb48ca47be0c9791ad7a72604cbb6a26184768c6eb81d0138a22ec88caed8c81f5131ccdc2506ba820ff4588ae8e448d4652b85e29b330255e8bed67d3883975e084776454e146cc4c7e75c8ab151698858b9e0268e4ad32b39a242b9ed52c979414ab3895225e891ed4b3058b3481045f77097be43a12f10d927ba9cca1f491cd85b88382193948a553a28d0c1b41f84a6fe304fdaff9999e73c2a8dea5ca51d20a23c0a44802ea0b821e61da49ebe25f537d0ce6f7d90bc37cb24c76e9c179fe2354ed33a85138b40fcc3abca';
const SECRET = 'HkpyEtYJx0nUnEs8HKsiOVjjo8ujOPdyQCVuLZ4G';

describe('decrypts real easytier-core 2.6.4 control traffic', () => {
  it('decrypts an OspfRouteRpc SyncRouteInfo with key128 and reveals mesh info', async () => {
    const { key128 } = deriveKeys(SECRET);
    const plaintext = await decryptAesGcm(unhex(REAL_ENCRYPTED_RPC), key128);
    const text = new TextDecoder('utf-8', { fatal: false }).decode(plaintext);
    // The decrypted RpcPacket embeds these readable markers.
    expect(text).toContain('home-mesh');
    expect(text).toContain('OspfRouteRpc');
    expect(text).toContain('toe2-ubuntu24'); // RoutePeerInfo.hostname
    expect(text).toContain('2.6.4'); // RoutePeerInfo.easytier_version
  });
});

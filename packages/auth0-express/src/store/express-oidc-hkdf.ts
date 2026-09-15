// HKDF parameters matching express-openid-connect's key derivation (lib/crypto.js).
// Both encryption ('JWE CEK') and signing ('JWS Cookie Signing') use the same approach.
const BYTE_LENGTH = 32;
const DIGEST = 'SHA-256';
const encoder = new TextEncoder();

export async function deriveHkdfKey(secret: string, info: string): Promise<Uint8Array<ArrayBuffer>> {
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveBits']);
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: DIGEST, info: encoder.encode(info), salt: new Uint8Array(0) },
    keyMaterial,
    BYTE_LENGTH * 8
  );
  return new Uint8Array(derivedBits as ArrayBuffer);
}

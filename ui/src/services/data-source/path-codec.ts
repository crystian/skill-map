/**
 * Browser-compatible base64url codec for `node.path` values used by
 * `/api/nodes/:pathB64`. Mirror of `src/server/path-codec.ts` — the BFF
 * and SPA must round-trip identically.
 *
 * Base64url alphabet (RFC 4648 §5, no padding): `A-Z a-z 0-9 - _`.
 *
 * Why two implementations: `Buffer` is Node-only (the BFF uses it); the
 * browser uses `btoa` / `atob` over UTF-8 byte sequences. Keep both
 * implementations trivial enough to re-implement identically — same
 * alphabet, same padding policy, same error semantics.
 */

export class PathCodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathCodecError';
  }
}

/**
 * Encode a `node.path` string for use as the `:pathB64` route param.
 * Output is base64url (URL-safe alphabet, no `=` padding).
 */
export function encodeNodePath(path: string): string {
  const utf8 = new TextEncoder().encode(path);
  let bin = '';
  for (let i = 0; i < utf8.length; i++) {
    bin += String.fromCharCode(utf8[i]);
  }
  return btoa(bin)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Decode a base64url-encoded `node.path` back to its UTF-8 form.
 * Throws `PathCodecError` on malformed input (matches the BFF's
 * rejection semantics so the SPA can branch identically).
 */
export function decodeNodePath(encoded: string): string {
  if (encoded.length === 0) {
    throw new PathCodecError('empty pathB64');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new PathCodecError(
      'pathB64 contains characters outside the base64url alphabet',
    );
  }
  const std = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const pad = std + '='.repeat((4 - (std.length % 4)) % 4);
  let bin: string;
  try {
    bin = atob(pad);
  } catch {
    throw new PathCodecError('pathB64 atob decode failed');
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new PathCodecError('pathB64 decoded bytes are not valid UTF-8');
  }
  // Round-trip check: the encoder is deterministic, so a non-roundtrip
  // means `encoded` was not produced by `encodeNodePath` (e.g. came from
  // a hand-typed URL with valid alphabet chars but bad padding shape).
  if (encodeNodePath(decoded) !== encoded) {
    throw new PathCodecError(
      'pathB64 did not round-trip cleanly through base64url',
    );
  }
  return decoded;
}

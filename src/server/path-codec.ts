/**
 * Base64url codec for `node.path` values used in the `/api/nodes/:pathB64`
 * route. Uses the Node-native base64url encoding (RFC 4648 §5, no padding)
 * so URLs stay safe for slashes / pluses / equals / unicode.
 *
 * Why a transport-only codec instead of percent-encoding the path: paths
 * routinely contain `/` (segment separators) which would split the
 * `:pathB64` route param across multiple Hono path segments. Base64url
 * collapses the path to a single segment with zero ambiguity.
 *
 * The mirror implementation lives at `ui/src/services/data-source/path-codec.ts`
 * (Step 14.3). Keep both implementations trivial enough to re-implement
 * identically — same alphabet, same padding policy, same error semantics.
 *
 * Pure: no IO, no logging. The decoder rejects malformed input by
 * throwing — the route handler catches and translates to the
 * `not-found` error envelope (a malformed pathB64 effectively means
 * "no such node" from the client's perspective).
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
  return Buffer.from(path, 'utf8').toString('base64url');
}

/**
 * Decode a base64url-encoded `node.path` back to its UTF-8 form.
 * Throws `PathCodecError` on malformed input.
 *
 * Rejection cases:
 *   - empty input.
 *   - characters outside the base64url alphabet (`A-Za-z0-9_-`).
 *   - decoded bytes that don't round-trip through UTF-8 cleanly
 *     (the encoder always uses UTF-8, so a non-roundtrip means the
 *     caller didn't produce the input via `encodeNodePath`).
 */
export function decodeNodePath(encoded: string): string {
  if (encoded.length === 0) {
    throw new PathCodecError('empty pathB64');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new PathCodecError('pathB64 contains characters outside the base64url alphabet');
  }
  const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
  // Round-trip check: the encoder is deterministic, so a non-roundtrip
  // means `encoded` was not produced by `encodeNodePath` (e.g. came from
  // a hand-typed URL with valid alphabet chars but bad padding shape).
  if (encodeNodePath(decoded) !== encoded) {
    throw new PathCodecError('pathB64 did not round-trip cleanly through base64url');
  }
  return decoded;
}

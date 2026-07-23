/**
 * FNV-1a 32-bit hash — deterministic fallback identifier for `slugify`'s D2 guard.
 *
 * Public surface:
 *   - fnv1a32Hex(input) — 8 lowercase hex chars, FNV-1a 32-bit over the UTF-8 bytes of `input`.
 *
 * Invariants:
 *   - Deterministic: the same input always yields the same output (referential
 *     transparency) — same title, same run, same hash, forever.
 *   - Pure: no IO, no randomness, no wall-clock reads.
 *   - Output is always exactly 8 lowercase hex characters, zero-padded.
 *
 * Side-effect class: Pure.
 *
 * Used by `slugify`'s D2 fallback (`schemas.ts`) — when a title transliterates
 * (if a transliterator was injected) and kebabs to an empty name part (e.g.
 * Korean/kana/emoji-only titles, or a CJK title with no transliterator supplied),
 * the slug becomes `{type}-{fnv1a32Hex(title)}` instead of the bare type name, so
 * two distinct untransliterable titles under the same type still get DISTINCT
 * (if opaque) slugs rather than colliding on the bare prefix.
 *
 * Source: SPEC-068 §Design Decisions D2
 */

const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

/**
 * Compute the FNV-1a 32-bit hash of a string's UTF-8 byte representation, rendered
 * as 8 lowercase hex characters.
 *
 * @param input - Raw string to hash (e.g. a document title).
 * @returns 8-character lowercase hex string, zero-padded (e.g. "a1b2c3d4").
 * @example
 *   fnv1a32Hex("hello") // => an 8-char hex string, e.g. "4f9f2cab"
 * @example
 *   fnv1a32Hex("hello") === fnv1a32Hex("hello") // true — deterministic
 * @example
 *   fnv1a32Hex("hello") !== fnv1a32Hex("world") // true (in practice — no
 *   collision guarantee, this is a 32-bit hash, only used for a display suffix)
 */
export function fnv1a32Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let hash = FNV_OFFSET_BASIS_32;
  for (const byte of bytes) {
    hash ^= byte;
    // reason: Math.imul performs 32-bit-wraparound integer multiplication —
    // plain `*` would promote to a float and lose the low bits FNV-1a depends on.
    hash = Math.imul(hash, FNV_PRIME_32);
  }
  // hash is a signed 32-bit int here (Math.imul's return type); >>> 0 reinterprets
  // it as unsigned before hex rendering so the output never carries a sign bit.
  return (hash >>> 0).toString(16).padStart(8, "0");
}

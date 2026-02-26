/**
 * Normalizes speaker count value from various input formats
 * to a number suitable for the transcription engine.
 *
 * Returns -1 for auto-detect (when value is "auto", empty, or undefined).
 * The Rust/Python backends use -1 as the sentinel for automatic speaker detection.
 */
export function normalizeNumSpeakers(
  value: string | number | undefined | null
): number {
  if (value === undefined || value === null || value === "" || value === "auto") {
    return -1;
  }
  const num = typeof value === "string" ? parseInt(value, 10) : value;
  return isNaN(num) || num <= 0 ? -1 : num;
}

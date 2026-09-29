/** Treat upstream identifiers as untrusted, bounded correlation data.
 * Reject malformed/oversized values rather than truncating distinct IDs into collisions.
 */
export function validateProviderIdentifier(value: unknown): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    /^[A-Za-z0-9][A-Za-z0-9._:/+=-]*$/.test(value)
    ? value
    : null;
}

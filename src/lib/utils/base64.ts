function toStandardBase64Alphabet(value: string): string {
  return value.replace(/ /g, "+").replace(/-/g, "+").replace(/_/g, "/");
}

/**
 * Decode Base64 encoded UTF-8 string.
 *
 * Accepts standard and URL-safe Base64 so the confirmation UI sees the same
 * payload that the Rust deeplink parser will import.
 */
export function decodeBase64Utf8(str: string): string {
  try {
    let cleaned = toStandardBase64Alphabet(str.trim());

    // Try to decode with standard Base64 first
    try {
      const binString = atob(cleaned);
      const bytes = Uint8Array.from(binString, (m) => m.codePointAt(0)!);
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } catch (e1) {
      // If standard fails, try adding padding
      const remainder = cleaned.length % 4;
      if (remainder !== 0) {
        cleaned += "=".repeat(4 - remainder);
      }
      const binString = atob(cleaned);
      const bytes = Uint8Array.from(binString, (m) => m.codePointAt(0)!);
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    }
  } catch (e) {
    console.error("Base64 decode error:", e, "Input:", str);
    // Last resort fallback using deprecated but sometimes working method
    try {
      return decodeURIComponent(escape(atob(toStandardBase64Alphabet(str))));
    } catch {
      // If all else fails, return original string
      return str;
    }
  }
}

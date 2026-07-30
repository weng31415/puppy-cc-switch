// Presentation helpers for deeplink import confirmation. These are warnings
// only: custom endpoints and environment variables remain supported.

export type RiskKind = "envHijack" | "privateEndpoint" | "shellCommand";

const ENV_HIJACK_PATTERNS: RegExp[] = [
  /^LD_/i,
  /^DYLD_/i,
  /^NODE_OPTIONS$/i,
  /^NODE_EXTRA_CA_CERTS$/i,
  /^PYTHONPATH$/i,
  /^PYTHONSTARTUP$/i,
  /^RUBYOPT$/i,
  /^PERL5OPT$/i,
  /^JAVA_TOOL_OPTIONS$/i,
  /^BASH_ENV$/i,
  /^ENV$/i,
  /^IFS$/i,
  /^PATH$/i,
  /^HTTPS?_PROXY$/i,
];

const SHELL_INTERPRETERS = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "fish",
  "csh",
  "tcsh",
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
]);

function isInlineCommandFlag(arg: string): boolean {
  const lower = arg.toLowerCase();

  if (/^\/[ck]\b/.test(lower)) return true;
  if (/^-c(o(m(m(a(n(d)?)?)?)?)?)?$/.test(lower)) return true;
  if (lower === "-encodedcommand" || lower === "-e" || lower === "-ec") {
    return true;
  }

  return /^-[a-z]*c[a-z]*$/.test(lower);
}

function extractIpv4Prefix(host: string): [number, number] | null {
  const dotted = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dotted) return [Number(dotted[1]), Number(dotted[2])];

  const mapped = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapped) {
    const high = Number.parseInt(mapped[1], 16);
    return [(high >> 8) & 0xff, high & 0xff];
  }

  const mappedDotted = host.match(
    /^::ffff:(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/,
  );
  if (mappedDotted) {
    return [Number(mappedDotted[1]), Number(mappedDotted[2])];
  }

  return null;
}

export function classifyEndpoint(rawUrl: unknown): RiskKind | null {
  if (typeof rawUrl !== "string") return null;

  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }

  const bare =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

  if (
    bare === "localhost" ||
    bare.endsWith(".localhost") ||
    bare.endsWith(".local") ||
    bare.endsWith(".internal") ||
    bare === "::1" ||
    bare === "::" ||
    bare === "0.0.0.0"
  ) {
    return "privateEndpoint";
  }

  const prefix = extractIpv4Prefix(bare);
  if (prefix) {
    const [first, second] = prefix;
    if (
      first === 127 ||
      first === 10 ||
      first === 0 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254)
    ) {
      return "privateEndpoint";
    }
  }

  if (/^f[cd][0-9a-f]{2}:/.test(bare) || /^fe[89ab][0-9a-f]:/.test(bare)) {
    return "privateEndpoint";
  }

  return null;
}

export function classifyEnvKey(key: unknown): RiskKind | null {
  if (typeof key !== "string") return null;
  return ENV_HIJACK_PATTERNS.some((pattern) => pattern.test(key))
    ? "envHijack"
    : null;
}

export function classifyCommand(
  command: unknown,
  args?: unknown,
): RiskKind | null {
  if (typeof command !== "string" || !command) return null;

  const basename = command.split(/[/\\]/).pop()?.toLowerCase() ?? "";
  if (!SHELL_INTERPRETERS.has(basename) || !Array.isArray(args)) {
    return null;
  }

  return args.some((arg) => typeof arg === "string" && isInlineCommandFlag(arg))
    ? "shellCommand"
    : null;
}

export function maskValue(key: string, value: string): string {
  const sensitiveKeys = ["TOKEN", "KEY", "SECRET", "PASSWORD"];
  const sensitive = sensitiveKeys.some((item) =>
    key.toUpperCase().includes(item),
  );

  return sensitive && value.length > 8
    ? `${value.substring(0, 8)}${"*".repeat(12)}`
    : value;
}

export function riskI18nKey(kind: RiskKind): string {
  return `deeplink.risk.${kind}`;
}

export function decodeDeeplinkPayload(
  encoded: unknown,
  decode: (value: string) => string,
): string {
  if (typeof encoded !== "string") return "";

  try {
    const decoded = decode(encoded);
    return decoded === "" ? encoded : decoded;
  } catch {
    return encoded;
  }
}

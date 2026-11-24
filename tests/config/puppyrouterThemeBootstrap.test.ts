import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it.each(["index.html", "tray-panel.html"])(
  "permits the PuppyRouter theme bootstrap in %s",
  (page) => {
    const root = resolve(__dirname, "../..");
    const html = readFileSync(resolve(root, "src", page), "utf8");
    const { app } = JSON.parse(
      readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"),
    );
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toContain("puppyrouter-app-theme");
    const hash = createHash("sha256").update(script!).digest("base64");
    expect(app.security.csp).toContain(`'sha256-${hash}'`);
  },
);

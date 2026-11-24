import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

const READMES = [
  ["README_EN.md", "English"],
  ["README_ZH.md", "简体中文"],
  ["README_ZH-TW.md", "繁體中文"],
  ["README_JA.md", "日本語"],
  ["README_KO.md", "한국어"],
  ["README_TR.md", "Türkçe"],
  ["README_RU.md", "Русский"],
  ["README_DE.md", "Deutsch"],
] as const;

const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

const headingLevels = (text: string) =>
  [...text.matchAll(/^(#{1,4}) /gm)].map((m) => m[1].length);

const english = read("README_EN.md");

describe.each(READMES)("%s", (file) => {
  it("exists", () => {
    expect(existsSync(path.join(ROOT, file))).toBe(true);
  });

  const text = existsSync(path.join(ROOT, file)) ? read(file) : "";

  it("links every other README from its language switcher", () => {
    const switcher = text
      .split("\n")
      .find(
        (line) => line.includes("(CHANGELOG.md)") && line.includes("README"),
      );
    expect(switcher, "language switcher line").toBeDefined();
    for (const [other, name] of READMES) {
      if (other === file) {
        expect(switcher).toContain(name);
        expect(switcher).not.toContain(`(${other})`);
      } else {
        expect(switcher).toContain(`[${name}](${other})`);
      }
    }
  });

  it("keeps the same heading structure as the English README", () => {
    expect(headingLevels(text)).toEqual(headingLevels(english));
  });

  it("directs readers to the PuppyRouter download and account guide", () => {
    expect(text).toContain("](https://puppyrouter.com/client)");
    expect(text).toContain(
      "](https://blog.puppyrouter.com/docs/puppyrouter-app)",
    );
    expect(text).not.toMatch(/github\.com\/farion1231\/cc-switch\/releases/);
  });

  it("links to the local license without sending readers to a source repository", () => {
    expect(text).toMatch(/^# PuppyRouter App$/m);
    expect(text).not.toContain("github.com/");
    expect(text).toContain("](LICENSE)");
  });
});

it("keeps project links on PuppyRouter across the product documentation", () => {
  for (const file of ["README.md", ...READMES.map(([name]) => name)]) {
    const text = read(file);
    for (const match of text.matchAll(/(?:\]\(|src=")(https?:\/\/[^\s)"]+)/g)) {
      expect(["puppyrouter.com", "blog.puppyrouter.com"]).toContain(
        new URL(match[1]).hostname,
      );
    }
  }
});

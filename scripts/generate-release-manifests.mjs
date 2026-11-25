#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, "").split("=");
    return [key, value.join("=")];
  }),
);

const dir = args.dir || "release-assets";
const release = args.release;
const baseUrl = args["base-url"]?.replace(/\/+$/, "");

if (!release || !baseUrl) {
  throw new Error(
    "Usage: generate-release-manifests.mjs --release=<tag> --base-url=<url> [--dir=<path>]",
  );
}

const versionMatch = release.match(/v?(\d+\.\d+\.\d+)/);
if (!versionMatch) {
  throw new Error(`Could not extract a semantic version from ${release}`);
}

const version = versionMatch[1];
const publishedAt = new Date().toISOString();
const files = readdirSync(dir).sort();

const findOne = (suffixes, required = true) => {
  const matches = files.filter((file) =>
    suffixes.some((suffix) => file.endsWith(suffix)),
  );
  if (matches.length === 1) return matches[0];
  if (!required && matches.length === 0) return null;
  throw new Error(
    `Expected exactly one asset ending in ${suffixes.join(" or ")}, found ${matches.length}`,
  );
};

const sha256 = (filename) =>
  createHash("sha256")
    .update(readFileSync(path.join(dir, filename)))
    .digest("hex");

const manualAsset = (filename) => ({
  url: `${baseUrl}/${filename}`,
  sha256: sha256(filename),
  size: statSync(path.join(dir, filename)).size,
});

const windows = findOne(["-Windows.msi"]);
const windowsArm = findOne(["-Windows-arm64.msi"]);
const macDmg = findOne(["-macOS-arm64.dmg", "-macOS.dmg"]);
const linuxDeb = findOne(["-Ubuntu-x86_64.deb", "-Linux-x86_64.deb"]);

const releaseLabel = windows.slice(
  "PuppyRouter-App-".length,
  -"-Windows.msi".length,
);
if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(releaseLabel)) {
  throw new Error(`Unexpected release label in ${windows}`);
}

if (
  releaseLabel.split("-")[0] !== `v${version}` ||
  (release.startsWith("v") && releaseLabel !== release) ||
  files.some(
    (name) =>
      name.startsWith("PuppyRouter-App-") &&
      !name.startsWith(`PuppyRouter-App-${releaseLabel}-`),
  )
) {
  throw new Error("The installers do not all belong to the requested release");
}

const manual = {
  schema_version: 1,
  version,
  release: releaseLabel,
  published_at: publishedAt,
  downloads: {
    windows_x86_64: manualAsset(windows),
    windows_aarch64: manualAsset(windowsArm),
    macos_aarch64: manualAsset(macDmg),
    linux_x86_64_deb: manualAsset(linuxDeb),
  },
};

const { plugins } = JSON.parse(
  readFileSync(
    new URL("../src-tauri/tauri.conf.json", import.meta.url),
    "utf8",
  ),
);
const publicKey = Buffer.from(plugins.updater.pubkey, "base64")
  .toString("utf8")
  .trim()
  .split(/\r?\n/)
  .at(-1);
const verified = new Set();

const platforms = {};
const addUpdaterPlatform = (key, filename) => {
  const signaturePath = path.join(dir, `${filename}.sig`);
  let signature;
  try {
    signature = readFileSync(signaturePath, "utf8").trim();
  } catch {
    throw new Error(`Missing updater signature for ${filename}`);
  }
  if (!verified.has(filename)) {
    const temp = mkdtempSync(path.join(tmpdir(), "puppyrouter-signature-"));
    try {
      const decoded = path.join(temp, "updater.minisig");
      writeFileSync(decoded, Buffer.from(signature, "base64"));
      execFileSync("minisign", [
        "-V",
        "-q",
        "-P",
        publicKey,
        "-x",
        decoded,
        "-m",
        path.join(dir, filename),
      ]);
      verified.add(filename);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
  platforms[key] = {
    signature,
    url: `${baseUrl}/${filename}`,
  };
};

addUpdaterPlatform("windows-x86_64", windows);
addUpdaterPlatform("windows-aarch64", windowsArm);

const macUpdater = findOne(["-macOS.tar.gz"]);
addUpdaterPlatform("darwin-aarch64", macUpdater);
if (macDmg.endsWith("-macOS.dmg")) {
  addUpdaterPlatform("darwin-x86_64", macUpdater);
}

addUpdaterPlatform("linux-x86_64-deb", linuxDeb);
const linuxArm = findOne(["-Linux-arm64.deb"], false);
if (linuxArm) {
  addUpdaterPlatform("linux-aarch64-deb", linuxArm);
}

const latest = {
  version,
  notes: `PuppyRouter App ${release}`,
  pub_date: publishedAt,
  platforms,
};

for (const [filename, value] of [
  ["latest.json", latest],
  ["manual-latest.json", manual],
]) {
  const output = path.join(dir, filename);
  writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`Generated ${output}`);
}

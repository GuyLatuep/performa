#!/usr/bin/env node
/**
 * Uploads a release to performa.polz.in (or any instance of the site). Meant for CI; needs
 * Node 22+ and no dependencies. Talks to the site only through its HTTP API, so a change
 * to /api/releases there has to be mirrored here.
 *
 *   PERFORMA_UPLOAD_TOKEN=… node scripts/upload-release.mjs \
 *     --site https://performa.polz.in --version 2.6.5 --notes notes.md \
 *     --manual-en docs/user-manual.en.md --manual-de docs/user-manual.de.md \
 *     --file performa_2.6.5_aarch64.dmg:darwin-aarch64:installer \
 *     --file performa_2.6.5_aarch64.app.tar.gz:darwin-aarch64:updater \
 *     --file performa_2.6.5_x64-setup.exe:windows-x86_64:installer+updater
 *
 * An updater file's signature is read from `<file>.sig`, as Tauri writes it. The release ends
 * up as a draft; publish it on /admin.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    site: { type: "string" },
    version: { type: "string" },
    notes: { type: "string" },
    "manual-en": { type: "string" },
    "manual-de": { type: "string" },
    file: { type: "string", multiple: true },
  },
});

function fail(message) {
  console.error(`upload-release: ${message}`);
  process.exit(1);
}

const token = process.env.PERFORMA_UPLOAD_TOKEN;
for (const required of ["site", "version", "manual-en", "manual-de", "file"]) {
  if (!values[required]) fail(`--${required} is required`);
}
if (!token) fail("PERFORMA_UPLOAD_TOKEN is not set");

const site = values.site.replace(/\/$/, "");
const version = values.version.replace(/^v/, "");

async function call(method, path, body, contentType) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${site}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(contentType && { "content-type": contentType }),
      },
      body,
    });
    if (response.ok) return response.status === 204 ? null : response.json();
    const text = await response.text();
    // Retry what may be transient; a 4xx is a real answer.
    if (response.status < 500 || attempt === 3)
      fail(`${method} ${path} → ${response.status} ${text}`);
    console.warn(`${method} ${path} → ${response.status}, retrying`);
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
}

const files = [];
for (const spec of values.file) {
  const [path, platform, roles = "installer"] = spec.split(":");
  const data = await readFile(path);
  const updater = roles.includes("updater");
  files.push({
    data,
    meta: {
      name: basename(path),
      platform,
      installer: roles.includes("installer"),
      updater,
      signature: updater
        ? (await readFile(`${path}.sig`, "utf8")).trim()
        : null,
      size: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
    },
  });
}

const notes = values.notes ? await readFile(values.notes, "utf8") : "";
const created = await call(
  "POST",
  "/api/releases",
  JSON.stringify({ version, notes, files: files.map((f) => f.meta) }),
  "application/json",
);
console.log(
  `Created upload for ${version} (chunks of ${created.chunkSize} bytes)`,
);

for (const { data, meta } of files) {
  const chunks = created.files.find((f) => f.name === meta.name).chunks;
  for (let i = 0; i < chunks; i++) {
    const part = data.subarray(
      i * created.chunkSize,
      (i + 1) * created.chunkSize,
    );
    const path = `/api/releases/${version}/files/${encodeURIComponent(meta.name)}/${i}`;
    await call("PUT", path, part, "application/octet-stream");
  }
  console.log(`Uploaded ${meta.name} (${chunks} chunks)`);
}

for (const lang of ["en", "de"]) {
  const text = await readFile(values[`manual-${lang}`], "utf8");
  await call(
    "PUT",
    `/api/releases/${version}/manuals/${lang}`,
    text,
    "text/markdown; charset=utf-8",
  );
}
console.log("Uploaded manuals");

// Sent as JSON: SvelteKit treats a POST without a content type as a cross-site form submission.
const result = await call(
  "POST",
  `/api/releases/${version}/finalize`,
  "{}",
  "application/json",
);
console.log(
  `${result.version} is now a ${result.state}. Publish it on ${site}/admin`,
);

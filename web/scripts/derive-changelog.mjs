#!/usr/bin/env node
/**
 * derive-changelog.mjs — emit `web/lib/changelog.generated.ts` and
 * `web/lib/release-notes.generated.ts` from the repository CHANGELOG.md so
 * /changelog, /changelog/<version> and the docs release-truth band render the
 * real release record, never a hand-typed copy.
 *
 * Runs at `npm run prebuild`, `npm run dev` and in the vitest global setup.
 * The output is NOT tracked (web/.gitignore): a committed copy raced between
 * merges — two PRs that each added a CHANGELOG line each regenerated it
 * against their own base, git merged both to a stale item count, and main
 * went red (twice on 2026-09-26). Deriving at build time removes the race.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseChangelog,
  parseReleaseNotes,
  renderChangelogModule,
  renderReleaseNotesModule,
} from "./changelog-lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const SOURCE = resolve(REPO_ROOT, "CHANGELOG.md");
const TARGET = resolve(__dirname, "..", "lib", "changelog.generated.ts");
const NOTES_TARGET = resolve(__dirname, "..", "lib", "release-notes.generated.ts");

if (!existsSync(SOURCE)) {
  console.error(`[derive-changelog] CHANGELOG.md not found at ${SOURCE}`);
  process.exit(1);
}

const markdown = readFileSync(SOURCE, "utf-8");
const parsed = parseChangelog(markdown);
const notes = parseReleaseNotes(markdown);
for (const [target, next, count] of [
  [TARGET, renderChangelogModule(parsed), parsed.releases.length],
  [NOTES_TARGET, renderReleaseNotesModule(notes), notes.length],
]) {
  const name = `lib/${basename(target)}`;
  const current = existsSync(target) ? readFileSync(target, "utf-8") : null;
  if (current !== next) {
    writeFileSync(target, next);
    console.log(`[derive-changelog] wrote ${count} releases → ${name}`);
  } else {
    console.log(`[derive-changelog] ${name} is current (${count} releases)`);
  }
}

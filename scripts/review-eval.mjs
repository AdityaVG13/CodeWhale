#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const SCHEMA = "codewhale.review-eval.corpus/1";
const RUN_SCHEMA = "codewhale.review-eval.run/1";
const GRADE_SCHEMA = "codewhale.review-eval.grade/1";
const DEFAULT_WINDOW_LINES = 3;

const CODE_EXT = /\.(?:rs|mjs|cjs|js|jsx|ts|tsx|py|go|java|kt|kts|swift|c|cc|cpp|h|hpp|cs|rb|php|scala|zig|lua|sh|bash|zsh|sql|toml|ya?ml|json|wl|cu)$/i;
const SKIP_PATH = /(?:^|\/)(?:CHANGELOG|Cargo\.lock|package-lock\.json|pnpm-lock\.yaml|bun\.lockb?)(?:\.|$)|(?:^|\/)(?:target|node_modules|dist|build|\.git)\//;

function usage() {
  return [
    "review-eval — escaped-defect corpus and reviewer replay for Codewhale review",
    "",
    "  node scripts/review-eval.mjs corpus  --repo <path> [--since YYYY-MM-DD] [--until YYYY-MM-DD]",
    "                                       [--limit N] [--cache <path>] [--out <path>] [--fetch]",
    "  node scripts/review-eval.mjs replay  --corpus <path> --reviewer cli|hosted-floor|skill --out <dir>",
    "                                       [--binary codewhale] [--model M] [--provider P] [--max-cases N]",
    "                                       [--money-cap-usd X] [--hosted-root <codewhale-platform>]",
    "  node scripts/review-eval.mjs grade   --corpus <path> --run <dir> [--window 3] [--out <path>]",
    "  node scripts/review-eval.mjs report  --grade <path> [--baseline <path>]",
    "  node scripts/review-eval.mjs all     --repo <path> --reviewer cli --out <dir> [corpus/replay/grade flags]",
    "",
    "Exit codes: 0 ok, 1 usage or IO error, 2 budget cap reached (partial run retained).",
  ].join("\n");
}

function parseArgs(argv) {
  const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : "help";
  const flags = {};
  for (let index = command === "help" ? 0 : 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const [rawKey, inline] = token.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
    if (inline !== undefined) {
      flags[key] = inline;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return { command, flags };
}

function git(repo, args, { allowFailure = false } = {}) {
  const result = spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  if (result.status !== 0) {
    if (allowFailure) return "";
    throw new Error(`git ${args.join(" ")} failed: ${String(result.stderr || "").trim()}`);
  }
  return result.stdout;
}

function gitBuffer(repo, args) {
  return spawnSync("git", ["-C", repo, ...args], { maxBuffer: 512 * 1024 * 1024 }).stdout;
}

function nullSeparated(text) {
  return String(text || "").split("\u0000").filter((entry) => entry.length > 0);
}

function readCache(path) {
  if (!path || !existsSync(path)) return { commits: {}, prs: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return { commits: parsed.commits || {}, prs: parsed.prs || {} };
  } catch {
    return { commits: {}, prs: {} };
  }
}

function writeCache(path, cache) {
  if (!path) return;
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, JSON.stringify(cache));
}

function parseHunks(diffText) {
  const hunks = [];
  let path = "";
  let oldPath = "";
  for (const line of String(diffText || "").split("\n")) {
    if (line.startsWith("diff --git ")) {
      path = "";
      oldPath = "";
      continue;
    }
    if (line.startsWith("--- ")) {
      oldPath = line.slice(4).replace(/^a\//, "");
      continue;
    }
    if (line.startsWith("+++ ")) {
      const next = line.slice(4).trim();
      path = next === "/dev/null" ? "" : next.replace(/^b\//, "");
      continue;
    }
    const header = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!header) continue;
    hunks.push({
      path: path || oldPath,
      oldStart: Number(header[1]),
      oldCount: Number(header[2] ?? 1),
      newStart: Number(header[3]),
      newCount: Number(header[4] ?? 1),
    });
  }
  return hunks;
}

function addedLineSet(repo, base, head) {
  const diff = git(repo, ["diff", "--no-color", "-U0", base, head], { allowFailure: true });
  const added = new Map();
  let path = "";
  let newLine = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const next = line.slice(4).trim();
      path = next === "/dev/null" ? "" : next.replace(/^b\//, "");
      continue;
    }
    const header = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (header) {
      newLine = Number(header[1]);
      continue;
    }
    if (!path) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      if (!added.has(path)) added.set(path, new Set());
      added.get(path).add(newLine);
      newLine += 1;
      continue;
    }
    if (line.startsWith(" ") || line === "") continue;
  }
  return added;
}

function looksReviewable(path) {
  if (!path || SKIP_PATH.test(path)) return false;
  if (/\.(?:md|mdx|txt|lock|snap)$/i.test(path)) return false;
  return CODE_EXT.test(path);
}

function commitSubject(repo, sha) {
  return git(repo, ["show", "-s", "--format=%s", sha], { allowFailure: true }).trim();
}

function prFromSubject(subject) {
  const squash = String(subject || "").match(/^(.*)\(#(\d+)\)\s*$/);
  if (squash) return { pr: Number(squash[2]), via: "squash" };
  const merge = String(subject || "").match(/^Merge pull request #(\d+) /);
  if (merge) return { pr: Number(merge[1]), via: "merge" };
  return null;
}

function prBaseFor(repo, record, sha) {
  if (record.base_sha) return record.base_sha;
  const anchor = record.merge_sha || sha;
  const base = git(repo, ["rev-parse", `${anchor}^1`], { allowFailure: true }).trim();
  if (base) record.base_sha = base;
  return base || "";
}

function prSize(repo, base, head) {
  if (!base || !head) return null;
  const numstat = git(repo, ["diff", "--numstat", base, head], { allowFailure: true });
  if (!numstat) return null;
  let files = 0;
  let lines = 0;
  for (const row of numstat.split("\n")) {
    const match = row.match(/^(\d+|-)\t(\d+|-)\t/);
    if (!match) continue;
    files += 1;
    lines += Number(match[1] === "-" ? 0 : match[1]) + Number(match[2] === "-" ? 0 : match[2]);
  }
  return { files, lines };
}

function firstParentMerge(repo, sha, branch) {
  const merges = git(repo, ["rev-list", "--merges", "--ancestry-path", `${sha}..${branch}`], {
    allowFailure: true,
  })
    .split("\n")
    .filter(Boolean);
  const oldest = merges.length ? merges[merges.length - 1] : "";
  return oldest ? [oldest] : [];
}

function prForCommit(repo, sha, branch, cache) {
  if (cache.commits[sha]) return cache.commits[sha];
  const own = prFromSubject(commitSubject(repo, sha));
  if (own) {
    cache.commits[sha] = own;
    return own;
  }
  const merges = firstParentMerge(repo, sha, branch)
  for (const merge of merges) {
    const found = prFromSubject(commitSubject(repo, merge));
    if (found) {
      const record = { pr: found.pr, via: "ancestry", merge_sha: merge };
      cache.commits[sha] = record;
      return record;
    }
  }
  cache.commits[sha] = { pr: null, via: null };
  return cache.commits[sha];
}

function fetchPullRef(repo, prNumber) {
  const ref = `refs/cw-eval/pr-${prNumber}`;
  const exists = spawnSync("git", ["-C", repo, "rev-parse", "--verify", "--quiet", ref], {
    encoding: "utf8",
  });
  if (exists.status === 0) return ref;
  const fetched = spawnSync(
    "git",
    ["-C", repo, "fetch", "--no-tags", "origin", `refs/pull/${prNumber}/head:${ref}`],
    { encoding: "utf8" },
  );
  if (fetched.status !== 0) return "";
  return ref;
}

function fileLinesAt(repo, sha, path) {
  const out = git(repo, ["show", `${sha}:${path}`], { allowFailure: true });
  return out === "" ? null : out.split("\n");
}

function locateAnchor(repo, headSha, path, text, nearLine) {
  const lines = fileLinesAt(repo, headSha, path);
  if (!lines) return null;
  const needle = String(text || "").trim();
  if (!needle) return null;
  const hits = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() === needle) hits.push(index + 1);
  }
  if (!hits.length) return null;
  hits.sort((left, right) => Math.abs(left - nearLine) - Math.abs(right - nearLine));
  return { line: hits[0], ambiguous: hits.length > 1 };
}

function buildCorpus(flags) {
  const repo = resolve(String(flags.repo || "."));
  const branch = String(flags.branch || "origin/main");
  const since = String(flags.since || "2026-08-01");
  const until = flags.until ? String(flags.until) : "";
  const limit = flags.limit ? Number(flags.limit) : 0;
  const maxHunksPerFix = flags.maxHunksPerFix ? Number(flags.maxHunksPerFix) : 8;
  const maxPrFiles = flags.maxFiles ? Number(flags.maxFiles) : 40;
  const maxPrLines = flags.maxLines ? Number(flags.maxLines) : 4000;
  const cache = readCache(flags.cache ? resolve(String(flags.cache)) : "");
  const stats = {
    fix_commits_scanned: 0,
    hunks_scanned: 0,
    blamed_lines: 0,
    sized_prs: 0,
    pr_lines_total: 0,
    dropped: {
      no_blame: 0,
      no_pr: 0,
      not_reviewable: 0,
      pr_too_large: 0,
      pr_mismatch: 0,
      no_head_sha: 0,
      anchor_not_found: 0,
      anchor_not_introduced: 0,
      anchor_ambiguous: 0,
      same_pr: 0,
      duplicate_case: 0,
    },
  };
  const logArgs = ["log", "--no-merges", "--grep=^fix", "--since", since, "--format=%H"];
  if (until) logArgs.push("--until", until);
  logArgs.push(branch);
  const fixShas = git(repo, logArgs).split("\n").filter(Boolean);
  const cases = new Map();

  for (const fixSha of fixShas) {
    if (limit && stats.fix_commits_scanned >= limit) break;
    stats.fix_commits_scanned += 1;
    const diff = git(repo, ["show", "-U0", "--format=", "--no-color", fixSha], { allowFailure: true });
    const hunks = parseHunks(diff)
      .filter((hunk) => hunk.oldCount > 0 && looksReviewable(hunk.path))
      .slice(0, maxHunksPerFix);
    if (!hunks.length) continue;
    stats.hunks_scanned += hunks.length;
    const fixSubject = commitSubject(repo, fixSha);
    for (const hunk of hunks) {
      const blame = git(
        repo,
        ["blame", "--porcelain", `-L${hunk.oldStart},${hunk.oldStart + hunk.oldCount - 1}`, `${fixSha}^`, "--", hunk.path],
        { allowFailure: true },
      );
      if (!blame) {
        stats.dropped.no_blame += 1;
        continue;
      }
      const entries = [];
      let current = null;
      for (const line of blame.split("\n")) {
        const header = line.match(/^([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?$/);
        if (header) {
          current = {
            sha: header[1],
            originalLine: Number(header[2]),
            finalLine: Number(header[3]),
            text: "",
            filename: hunk.path,
          };
          entries.push(current);
          continue;
        }
        if (current && line.startsWith("filename ")) current.filename = line.slice(9);
        if (current && line.startsWith("\t")) {
          stats.blamed_lines += 1;
          current.text = line.slice(1);
        }
      }
      for (const entry of entries) {
        if (!entry.text.trim()) continue;
        const found = prForCommit(repo, entry.sha, branch, cache);
        if (!found || !found.pr) {
          stats.dropped.no_pr += 1;
          continue;
        }
        const pr = Number(found.pr);
        const key = `${pr}:${entry.filename}:${entry.originalLine}`;
        if (cases.has(key)) {
          stats.dropped.duplicate_case += 1;
          continue;
        }
        if (flags.fetch) fetchPullRef(repo, pr);
        const headRef = flags.fetch ? `refs/cw-eval/pr-${pr}` : "";
        const headSha = headRef
          ? git(repo, ["rev-parse", headRef], { allowFailure: true }).trim()
          : "";
        // A "(#NNNN)" subject or an ancestry walk can name a pull request in a
        // different repository of this history, so the introducing commit must
        // be proven to be on that pull request's head before it is a case. A
        // pull request whose head cannot be fetched is not replayable at all,
        // and admitting it would put a case in the corpus that no reviewer can
        // ever be shown.
        if (!headSha) {
          stats.dropped.no_head_sha += 1;
          cases.set(`bad:${pr}`, true);
          continue;
        }
        const contained = spawnSync(
          "git",
          ["-C", repo, "merge-base", "--is-ancestor", entry.sha, headSha],
        );
        if (contained.status !== 0) {
          stats.dropped.pr_mismatch += 1;
          cases.set(`bad:${pr}`, true);
          continue;
        }
        let size = null;
        if (headSha && !cases.has(`size:${pr}`)) {
          const base = prBaseFor(repo, found, entry.sha);
          size = prSize(repo, base, headSha);
          cases.set(`size:${pr}`, size);
          if (size && (size.files > maxPrFiles || size.lines > maxPrLines)) {
            stats.dropped.pr_too_large += 1;
            cases.set(`large:${pr}`, true);
          }
        }
        if (cases.get(`large:${pr}`)) continue;
        if (size) {
          stats.sized_prs += 1;
          stats.pr_lines_total += size.lines;
        }
        let introduced = null;
        if (headSha) {
          const base = prBaseFor(repo, found, entry.sha);
          if (base) introduced = addedLineSet(repo, base, headSha);
        }
        const anchor = headSha
          ? locateAnchor(repo, headSha, entry.filename, entry.text, entry.originalLine)
          : null;
        if (headSha && !anchor) {
          stats.dropped.anchor_not_found += 1;
          continue;
        }
        if (anchor?.ambiguous) stats.dropped.anchor_ambiguous += 1;
        if (introduced) {
          const lines = introduced.get(entry.filename);
          const target = anchor ? anchor.line : entry.originalLine;
          if (!lines || !lines.has(target)) {
            stats.dropped.anchor_not_introduced += 1;
            continue;
          }
        }
        cases.set(key, {
          id: `${pr}:${entry.filename}:${entry.originalLine}`,
          pr,
          pr_source: found.via,
          head_sha: headSha || null,
          merge_sha: found.merge_sha || null,
          introduced_by: entry.sha,
          fix: {
            sha: fixSha,
            subject: fixSubject,
            path: hunk.path,
            line: entry.originalLine,
          },
          anchor: anchor
            ? { path: entry.filename, line: anchor.line, text: entry.text }
            : { path: entry.filename, line: entry.originalLine, text: entry.text },
          anchor_ambiguous: Boolean(anchor?.ambiguous),
        });
      }
    }
  }
  writeCache(flags.cache ? resolve(String(flags.cache)) : "", cache);
  const byPr = new Map();
  for (const entry of cases.values()) {
    if (!entry || !entry.pr || typeof entry.pr !== "number") continue;
    const existing = byPr.get(entry.pr);
    if (!existing) {
      byPr.set(entry.pr, { ...entry, anchors: [entry.anchor], fixes: [entry.fix] });
      continue;
    }
    existing.anchors.push(entry.anchor);
    existing.fixes.push(entry.fix);
  }
  const corpus = {
    schema: SCHEMA,
    generated_at: new Date().toISOString(),
    repo: {
      path: repo,
      remote: git(repo, ["config", "--get", "remote.origin.url"], { allowFailure: true }).trim(),
      branch,
      head: git(repo, ["rev-parse", branch], { allowFailure: true }).trim(),
    },
    window: { since, until: until || null },
    stats,
    cases: [...byPr.values()].sort((left, right) => left.pr - right.pr),
  };
  const out = flags.out ? resolve(String(flags.out)) : join(process.cwd(), "review-eval-corpus.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(corpus, null, 2));
  process.stdout.write(
    `${JSON.stringify(
      {
        out,
        cases: corpus.cases.length,
        prs: corpus.cases.length,
        stats,
      },
      null,
      2,
    )}\n`,
  );
  return corpus;
}

function parseCliPayload(stdout) {
  const text = String(stdout || "");
  const start = text.indexOf("{");
  if (start < 0) return null;
  for (let end = text.length; end > start; end -= 1) {
    if (text[end - 1] !== "}") continue;
    try {
      return JSON.parse(text.slice(start, end));
    } catch {
      continue;
    }
  }
  return null;
}

function claimsFromStructured(review) {
  if (!review || typeof review !== "object") return [];
  const claims = [];
  for (const issue of Array.isArray(review.issues) ? review.issues : []) {
    claims.push({
      path: typeof issue?.path === "string" ? issue.path : "",
      line: Number.isInteger(issue?.line) ? issue.line : null,
      severity: String(issue?.severity || ""),
      body: [issue?.title, issue?.description].filter(Boolean).join(" — "),
      origin: "issue",
    });
  }
  for (const suggestion of Array.isArray(review.suggestions) ? review.suggestions : []) {
    claims.push({
      path: typeof suggestion?.path === "string" ? suggestion.path : "",
      line: Number.isInteger(suggestion?.line) ? suggestion.line : null,
      severity: "suggestion",
      body: String(suggestion?.suggestion || ""),
      origin: "suggestion",
    });
  }
  return claims;
}

function prFiles(pr, repoSlug) {
  const result = spawnSync(
    "gh",
    ["api", "--paginate", `repos/${repoSlug}/pulls/${pr}/files?per_page=100`],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (result.status !== 0) return [];
  const pages = [];
  let buffer = "";
  for (const line of String(result.stdout || "").split("\n")) {
    buffer += line;
    try {
      const parsed = JSON.parse(buffer);
      if (Array.isArray(parsed)) pages.push(...parsed);
      buffer = "";
    } catch {
      buffer += "\n";
    }
  }
  return pages;
}

function prView(pr, repoSlug) {
  const result = spawnSync(
    "gh",
    ["pr", "view", String(pr), "--repo", repoSlug, "--json", "number,title,body,headRefOid,baseRefOid,files"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function repoSlugFor(corpus) {
  const remote = String(corpus?.repo?.remote || "");
  const match = remote.match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/);
  return match ? match[1] : "";
}

function runCliCase(entry, corpus, flags) {
  const slug = repoSlugFor(corpus);
  const binary = String(flags.binary || "codewhale");
  const args = ["review", "--pr", String(entry.pr)];
  if (slug) args.push("--repo", slug);
  args.push("--json", "--max-passes", String(flags.maxPasses || 1));
  if (flags.model) args.push("--model", String(flags.model));
  if (flags.provider) args.push("--provider", String(flags.provider));
  const started = Date.now();
  const result = spawnSync(binary, args, {
    cwd: resolve(String(flags.workspace || corpus.repo.path)),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: Number(flags.timeoutSeconds || 900) * 1000,
    env: process.env,
  });
  const wallMs = Date.now() - started;
  const payload = parseCliPayload(result.stdout);
  return {
    status: result.status,
    wall_ms: wallMs,
    payload,
    claims: payload?.review ? claimsFromStructured(payload.review) : [],
    usage: payload?.usage || null,
    stop_reason: payload?.stop_reason || null,
    summary: payload?.review?.summary || "",
    overall: payload?.review?.overall_assessment || "",
    stderr: String(result.stderr || "").slice(-4000),
    error: result.error ? String(result.error.message || result.error) : null,
  };
}

async function runHostedFloorCase(entry, corpus, flags, moduleCache) {
  const root = String(flags.hostedRoot || "");
  if (!root) throw new Error("hosted-floor replay needs --hosted-root <codewhale-platform checkout>");
  const modulePath = join(
    resolve(root),
    "services/control-plane/src/integrations/github/pr-review.mjs",
  );
  if (!existsSync(modulePath)) throw new Error(`hosted review module not found at ${modulePath}`);
  moduleCache.modules ??= new Map();
  if (!moduleCache.modules.has(modulePath)) {
    moduleCache.modules.set(modulePath, await import(`file://${modulePath}`));
  }
  const module = moduleCache.modules.get(modulePath);
  const view = prView(entry.pr, repoSlugFor(corpus));
  if (!view) return { status: 1, wall_ms: 0, claims: [], error: "gh_pr_view_failed" };
  const started = Date.now();
  const comments = await module.buildPullRequestReviewComments({
    files: prFiles(entry.pr, repoSlugFor(corpus)),
    pullRequest: { number: view.number, title: view.title, headSha: view.headRefOid },
  });
  return {
    status: 0,
    wall_ms: Date.now() - started,
    claims: comments.map((comment) => ({
      path: comment.path,
      line: comment.line,
      side: comment.side,
      severity: comment.severity,
      body: comment.body,
      origin: "hosted-floor",
    })),
    usage: null,
  };
}

function runSkillCase(entry, corpus, flags) {
  const skillPath = join(
    resolve(String(flags.workspace || corpus.repo.path)),
    "crates/tui/assets/skills/review/SKILL.md",
  );
  const skill = existsSync(skillPath) ? readFileSync(skillPath, "utf8") : "";
  const slug = repoSlugFor(corpus);
  const view = prView(entry.pr, slug);
  const diff = spawnSync("gh", ["pr", "diff", String(entry.pr), "--repo", slug], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const prompt = [
    skill,
    "",
    "---",
    `Pull request #${entry.pr} in ${slug}`,
    `Title: ${view?.title || ""}`,
    "Description:",
    String(view?.body || "").slice(0, 4000),
    "",
    "Diff:",
    String(diff.stdout || "").slice(0, Number(flags.maxChars || 200000)),
  ].join("\n");
  const binary = String(flags.binary || "codewhale");
  const args = ["exec", "--json"];
  if (flags.model) args.push("--model", String(flags.model));
  if (flags.provider) args.push("--provider", String(flags.provider));
  args.push(prompt);
  const started = Date.now();
  const result = spawnSync(binary, args, {
    cwd: resolve(String(flags.workspace || corpus.repo.path)),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: Number(flags.timeoutSeconds || 900) * 1000,
  });
  const payload = parseCliPayload(result.stdout);
  const text = String(payload?.result || payload?.content || result.stdout || "");
  return {
    status: result.status,
    wall_ms: Date.now() - started,
    claims: claimsFromMarkdown(text),
    usage: payload?.usage || null,
    raw_excerpt: text.slice(0, 4000),
  };
}

function claimsFromMarkdown(text) {
  const claims = [];
  const linePattern = /`?([\w./-]+\.\w+):(\d+)`?/g;
  for (const block of String(text || "").split(/\n(?=\s*(?:\d+[.)]|[-*])\s)/)) {
    const match = block.match(linePattern);
    if (!match) continue;
    const [, path, line] = match[0].match(/`?([\w./-]+\.\w+):(\d+)`?/) || [];
    if (!path) continue;
    claims.push({ path, line: Number(line), severity: "", body: block.trim().slice(0, 1200), origin: "skill" });
  }
  return claims;
}

async function replay(flags) {
  const corpus = JSON.parse(readFileSync(resolve(String(flags.corpus)), "utf8"));
  const reviewer = String(flags.reviewer || "cli");
  const outDir = resolve(String(flags.out));
  mkdirSync(outDir, { recursive: true });
  const maxCases = flags.maxCases ? Number(flags.maxCases) : corpus.cases.length;
  const moneyCap = flags.moneyCapUsd ? Number(flags.moneyCapUsd) : 0;
  const moduleCache = {};
  const runs = [];
  let spend = 0;
  for (const entry of corpus.cases.slice(0, maxCases)) {
    if (moneyCap > 0 && spend >= moneyCap) {
      process.stderr.write(`money cap ${moneyCap} USD reached after ${runs.length} case(s)\n`);
      break;
    }
    const started = new Date().toISOString();
    let record;
    try {
      if (reviewer === "cli") record = runCliCase(entry, corpus, flags);
      else if (reviewer === "hosted-floor") record = await runHostedFloorCase(entry, corpus, flags, moduleCache);
      else if (reviewer === "skill") record = runSkillCase(entry, corpus, flags);
      else throw new Error(`unknown reviewer ${reviewer}`);
    } catch (error) {
      record = { status: 1, wall_ms: 0, claims: [], error: String(error?.message || error) };
    }
    const cost = estimateCost(record.usage, flags);
    spend += cost;
    const runRecord = {
      id: entry.id,
      pr: entry.pr,
      reviewer,
      started_at: started,
      status: record.status,
      wall_ms: record.wall_ms,
      claims: record.claims || [],
      usage: record.usage || null,
      estimated_cost_usd: Number(cost.toFixed(6)),
      stop_reason: record.stop_reason || null,
      summary: record.summary || "",
      overall: record.overall || "",
      error: record.error || null,
      stderr: record.stderr || "",
      raw_excerpt: record.raw_excerpt || "",
    };
    writeFileSync(join(outDir, `${entry.pr}.json`), JSON.stringify(runRecord, null, 2));
    runs.push(runRecord);
    process.stderr.write(
      `${reviewer} ${entry.id} status=${record.status} claims=${runRecord.claims.length} ${record.wall_ms}ms\n`,
    );
  }
  const manifest = {
    schema: RUN_SCHEMA,
    reviewer,
    corpus: resolve(String(flags.corpus)),
    model: flags.model || null,
    provider: flags.provider || null,
    generated_at: new Date().toISOString(),
    money_cap_usd: moneyCap || null,
    cases_attempted: runs.length,
    estimated_cost_usd: Number(spend.toFixed(6)),
    cases: runs.map((run) => run.id),
  };
  writeFileSync(join(outDir, "run.json"), JSON.stringify(manifest, null, 2));
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  return moneyCap > 0 && spend >= moneyCap ? 2 : 0;
}

function estimateCost(usage, flags) {
  const inputRate = flags.inputUsdPerMTok ? Number(flags.inputUsdPerMTok) : 0;
  const outputRate = flags.outputUsdPerMTok ? Number(flags.outputUsdPerMTok) : 0;
  if (!usage) return 0;
  const input = Number(usage.input_tokens || 0) + Number(usage.cache_read_input_tokens || 0);
  const output = Number(usage.output_tokens || 0);
  return (input / 1_000_000) * inputRate + (output / 1_000_000) * outputRate;
}

function matchCase(entry, claims, windowLines) {
  let fileMatch = null;
  let lineMatch = null;
  for (const claim of claims) {
    if (!claim.path) continue;
    const anchors = Array.isArray(entry.anchors) ? entry.anchors : [entry.anchor];
    for (const anchor of anchors) {
      if (!anchor?.path) continue;
      if (claim.path === anchor.path || claim.path.endsWith(`/${anchor.path}`) || anchor.path.endsWith(`/${claim.path}`)) {
        fileMatch ??= claim;
        if (Number.isInteger(claim.line) && Math.abs(claim.line - anchor.line) <= windowLines) {
          lineMatch ??= claim;
        }
      }
    }
  }
  return { fileMatch, lineMatch };
}

function words(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function grade(flags) {
  const corpus = JSON.parse(readFileSync(resolve(String(flags.corpus)), "utf8"));
  const runDir = resolve(String(flags.run));
  const manifestPath = join(runDir, "run.json");
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { reviewer: "unknown" };
  const windowLines = flags.window ? Number(flags.window) : DEFAULT_WINDOW_LINES;
  const rows = [];
  for (const entry of corpus.cases) {
    const file = join(runDir, `${entry.pr}.json`);
    if (!existsSync(file)) continue;
    const run = JSON.parse(readFileSync(file, "utf8"));
    const claims = Array.isArray(run.claims) ? run.claims : [];
    const { fileMatch, lineMatch } = matchCase(entry, claims, windowLines);
    const matchedClaims = claims.filter((claim) =>
      (Array.isArray(entry.anchors) ? entry.anchors : [entry.anchor]).some(
        (anchor) =>
          anchor?.path &&
          Number.isInteger(claim.line) &&
          (claim.path === anchor.path || claim.path.endsWith(`/${anchor.path}`)) &&
          Math.abs(claim.line - anchor.line) <= windowLines,
      ),
    );
    rows.push({
      id: entry.id,
      pr: entry.pr,
      status: run.status,
      claims: claims.length,
      words: claims.reduce((total, claim) => total + words(claim.body), 0),
      caught: Boolean(lineMatch),
      caught_file: Boolean(fileMatch),
      caught_by: lineMatch ? { path: lineMatch.path, line: lineMatch.line, severity: lineMatch.severity } : null,
      claims_in_region: matchedClaims.length,
      precise_share: claims.length ? Number((matchedClaims.length / claims.length).toFixed(3)) : null,
      wall_ms: run.wall_ms || 0,
      cost_usd: run.estimated_cost_usd || 0,
      error: run.error || null,
    });
  }
  const attempted = rows.length;
  const caught = rows.filter((row) => row.caught).length;
  const caughtFile = rows.filter((row) => row.caught_file).length;
  const claimsTotal = rows.reduce((total, row) => total + row.claims, 0);
  const wordsTotal = rows.reduce((total, row) => total + row.words, 0);
  const summary = {
    schema: GRADE_SCHEMA,
    reviewer: manifest.reviewer,
    model: manifest.model || null,
    corpus: resolve(String(flags.corpus)),
    run: runDir,
    window_lines: windowLines,
    graded_at: new Date().toISOString(),
    metrics: {
      cases_attempted: attempted,
      cases_with_claims: rows.filter((row) => row.claims > 0).length,
      recall_at_window: attempted ? Number((caught / attempted).toFixed(4)) : null,
      recall_same_file: attempted ? Number((caughtFile / attempted).toFixed(4)) : null,
      claims_total: claimsTotal,
      claims_in_region: rows.reduce((total, row) => total + row.claims_in_region, 0),
      words_total: wordsTotal,
      claims_per_case: attempted ? Number((claimsTotal / attempted).toFixed(2)) : null,
      words_per_case: attempted ? Math.round(wordsTotal / attempted) : null,
      wall_ms_total: rows.reduce((total, row) => total + row.wall_ms, 0),
      wall_ms_mean: attempted ? Math.round(rows.reduce((total, row) => total + row.wall_ms, 0) / attempted) : null,
      cost_usd_total: Number(rows.reduce((total, row) => total + row.cost_usd, 0).toFixed(6)),
      cost_usd_per_case: attempted
        ? Number((rows.reduce((total, row) => total + row.cost_usd, 0) / attempted).toFixed(6))
        : null,
      failures: rows.filter((row) => row.status !== 0).length,
    },
    rows,
  };
  const out = flags.out ? resolve(String(flags.out)) : join(runDir, "grade.json");
  writeFileSync(out, JSON.stringify(summary, null, 2));
  process.stdout.write(`${JSON.stringify({ out, ...summary.metrics }, null, 2)}\n`);
  return 0;
}

function report(flags) {
  const current = JSON.parse(readFileSync(resolve(String(flags.grade)), "utf8"));
  const lines = [];
  const header = ["metric", current.reviewer, flags.baseline ? "baseline" : "", flags.baseline ? "delta" : ""].filter(Boolean);
  lines.push(header.join(" | "));
  const baseline = flags.baseline
    ? JSON.parse(readFileSync(resolve(String(flags.baseline)), "utf8"))
    : null;
  const keys = [
    "cases_attempted",
    "recall_at_window",
    "recall_same_file",
    "claims_total",
    "claims_per_case",
    "words_per_case",
    "cost_usd_per_case",
    "wall_ms_mean",
    "failures",
  ];
  for (const key of keys) {
    const value = current.metrics?.[key];
    const base = baseline?.metrics?.[key];
    const delta = baseline && typeof value === "number" && typeof base === "number"
      ? (value - base).toFixed(4)
      : "";
    lines.push([key, value ?? "", baseline ? base ?? "" : "", delta].filter((cell) => cell !== "").join(" | "));
  }
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (command === "help" || flags.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (command === "corpus") {
    buildCorpus(flags);
    return 0;
  }
  if (command === "replay") return replay(flags);
  if (command === "grade") return grade(flags);
  if (command === "report") return report(flags);
  if (command === "all") {
    const outDir = resolve(String(flags.out));
    const corpusPath = join(outDir, "corpus.json");
    flags.out = corpusPath;
    buildCorpus({ ...flags, fetch: flags.fetch ?? true });
    const runDir = join(outDir, `run-${flags.reviewer || "cli"}`);
    const replayCode = await replay({ ...flags, corpus: corpusPath, out: runDir });
    grade({ ...flags, corpus: corpusPath, run: runDir, out: join(runDir, "grade.json") });
    return replayCode;
  }
  process.stderr.write(`${usage()}\n`);
  return 1;
}

main().then(
  (code) => process.exit(code ?? 0),
  (error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exit(1);
  },
);

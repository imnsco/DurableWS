# Releasing

How a `durablews` release works end to end. Publishing is fully automated —
npm **trusted publishing** via OIDC, so no npm token exists anywhere — and a
release is exactly **two PR merges**.

## The flow

1. Feature PRs that affect the published package include a changeset
   (`pnpm changeset`). The summary you write there is the changelog entry —
   write it user-facing.
2. On every merge to `main`, `release.yml` runs. While changesets are
   pending it opens (or force-updates) the **"Version Packages" PR**
   (branch `changeset-release/main`) containing the version bumps and
   CHANGELOG entries.
3. **Merging the Version PR is the publish button.** The release run it
   triggers builds, publishes to npm with provenance, pushes the
   `durablews@X.Y.Z` tag, and creates the GitHub Release. The docs
   `/changelog` page picks the new entries up on its next deploy.

## Mechanics worth knowing

- **npm auth:** Trusted Publisher (OIDC) — `imnsco/DurableWS` →
  `release.yml` → environment `production`, configured on the npm package
  settings. Nothing to rotate. Trusted publishing needs npm ≥ 11.5.1, so
  the workflow installs `npm@latest` before publishing.
- **`RELEASE_TOKEN`:** a fine-grained PAT (this repo only; Contents +
  Pull requests read/write; deliberately **no** workflows permission). It
  must be in **both** places in `release.yml`: `actions/checkout`'s
  `token` (the changesets action pushes through git, which uses the
  credentials checkout persists) and the changesets step's `GITHUB_TOKEN`
  env (PR creation via the API). Without it the Version PR branch is
  pushed by the built-in `GITHUB_TOKEN`, whose events never trigger
  workflows — the PR's required checks would sit "expected" forever.
- Every merge to `main` force-rebuilds the open Version PR branch; its
  checks re-run automatically.

## If something looks stuck

- **Version PR has no checks:** `RELEASE_TOKEN` is missing, expired, or
  was removed from one of its two spots in `release.yml`. Stopgap while
  fixing the token: close and reopen the PR — a real-user event
  re-triggers CI.
- **Publish fails on auth:** the Trusted Publisher config on npm must
  match the workflow exactly (owner/repo, workflow filename, environment
  name).

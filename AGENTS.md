# Repository Guidelines

## Project Structure

- `src/extension.ts`: VS Code extension entry (`activate`/`deactivate`) and status bar logic.
- `src/test/**/*.test.ts`: Extension tests (compiled to `out/test/**/*.test.js`).
- `media/`: Dashboard webview assets (CSS/JS).
- `images/`: Extension assets (icon, etc.).
- `dist/`: Build output created by `esbuild` (ignored by default).
- `.github/workflows/ci-release.yml`: CI (typecheck/lint/build) and tag-based release.

## Build, Test, and Development Commands

- Prereqs: Node.js 20 and pnpm 9 (matches CI).
- `pnpm install`: Install dependencies (CI uses `--frozen-lockfile`).
- `pnpm run check-types`: TypeScript typecheck (`strict`).
- `pnpm run lint`: Lint TypeScript under `src/` (ESLint).
- `pnpm run compile`: Typecheck + lint + dev build via `esbuild`.
- `pnpm run watch`: Run `esbuild` and `tsc` in watch mode.
- `pnpm run package`: Production build (used for publishing).
- `pnpm test`: Run extension tests via `@vscode/test-cli`.

## Coding Style & Naming

- TypeScript only (`src/**/*.ts`); keep `strict` typing intact.
- Indentation: use tabs in `src/**/*.ts` (matches existing sources); avoid reformat-only diffs.
- Linting: follow `eslint.config.mjs`; run `pnpm run lint` before pushing.
- Naming: `camelCase` for values/functions, `PascalCase` for types, command IDs `rightcode-bar.*`, settings keys `rightcodeBar.*`.

## Testing Guidelines

- Place tests in `src/test/` and name files `*.test.ts`.
- Keep tests deterministic: avoid real network calls to `right.codes` (mock/stub).
- Run locally with `pnpm test` (tests execute from compiled `out/`).

## Commit & Pull Request Guidelines

- Use Conventional Commits seen in history: `feat: ...`, `fix: ...`, `ci: ...`, `chore(scope): ...` (e.g. `chore(release): v0.0.2`).
- PRs should include: a clear description, manual verification steps (VS Code `F5` Extension Development Host), and screenshots of the status bar/tooltip when UI changes (redact tokens/cookies).
- Don’t commit generated artifacts (`out/`, `dist/`, `node_modules/`) unless the change explicitly requires it.
- Releases are automated on tags: push `vX.Y.Z` to trigger VSIX packaging + Marketplace publish.

## Security & Configuration

- Never commit or paste real `rightcodeBar.token` / `rightcodeBar.cookie` values in issues, PRs, logs, or screenshots.
- Prefer secure storage via commands: `RightCode: Set Token (Secure)` and `RightCode: Set Cookie (Secure)`.

# CI

`github-workflows-ci.yml` is the CI pipeline. It is stored here (not under
`.github/workflows/`) because the token used to push this branch does not have
the GitHub **`workflow`** scope, and GitHub refuses to accept workflow-file
changes from a token without it.

To activate CI, a maintainer with a `workflow`-scoped token (or the GitHub UI)
copies it into place:

```sh
mkdir -p .github/workflows
cp docs/ci/github-workflows-ci.yml .github/workflows/ci.yml
git add .github/workflows/ci.yml
git commit -m "ci: enable pipeline"
git push
```

The file is otherwise final: it runs typecheck/unit/levels(≥10k)/build/
`check:release`, the server suite against a real Postgres 16 service, the
headless-Chromium Playwright suite, and the assetgen reconcile tests. It never
deploys to production and writes no secrets.

Local equivalents (all reproducible without CI):

```sh
npm ci
npm run typecheck && npm run test && npm run test:levels
npm run build && npm run check:release
npm run test:server          # PG_URL unset → pg tests skip
npm run test:e2e             # needs `npx playwright install chromium` once
python -m unittest discover -s .opencode/skills/minigames-assetgen/tests -v
```

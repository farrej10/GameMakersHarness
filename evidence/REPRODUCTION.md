# Clean-checkout reproduction

Commit `8e19f60` was cloned with `--no-hardlinks` into a new temporary directory on 2026-09-09 using Node 24.16.0 and npm 11.13.0.

```text
npm.cmd ci
added 56 packages
found 0 vulnerabilities

npm.cmd run verify
status: passed
11 of 11 stages passed
120 unit/integration tests passed across 12 files
14 browser gameplay/policy tests passed
production smoke passed
```

The clean checkout contained no `.env` file and required no OpenRouter key for offline verification or the committed static exports.

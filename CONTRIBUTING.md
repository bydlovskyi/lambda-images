# Contributing

## Setup

```bash
git clone <repo>
cd lambda-images
npm ci
```

Requirements: Node.js ≥ 22 and npm ≥ 10.4 (needed to install the Linux build of Sharp from any host).

## Before you open a pull request

```bash
npm run typecheck   # strict TypeScript, no emit
npm test            # vitest — Lambda handlers with mocked AWS SDK, real Sharp, CDK template assertions
npm run synth       # the stack must synthesise; no AWS credentials needed
```

CI runs exactly these three steps on every push and pull request.

## Ground rules

- Shared contracts (DynamoDB item, SQS payload, HTTP responses) live in `types/image-record.ts` — import them, don't redeclare.
- Handlers never return `error.message` to clients; internal details go to CloudWatch only.
- Infrastructure guarantees the README promises (DLQ, visibility timeout, TTL, log retention) are pinned by `test/stack.test.ts`. If you change one on purpose, update the test and the README in the same commit.
- Keep Lambda IAM grants scoped to the key prefix the function actually touches.

## Commit messages

Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

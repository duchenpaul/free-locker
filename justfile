default: run

run:
    pnpm dev

check:
    pnpm check

format:
    pnpm format

build:
    pnpm build

test-worker:
    pnpm test:worker

test-web:
    pnpm test:web

test-cli:
    pnpm test:cli

test-integration:
    pnpm test:integration

test: test-worker test-web test-cli test-integration

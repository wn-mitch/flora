# Type-check everything.
typecheck:
    npx tsc --noEmit -p .

# Unit tests under Node, then the renderers in headless Chrome.
test: typecheck
    node --test tests/*.test.ts
    node tests/browser.mjs

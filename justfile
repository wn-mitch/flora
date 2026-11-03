# Lua interpreters for the engine's Lua builds: LuaTeX's texlua (Lua 5.3)
# and LuaJIT. TinyTeX, which tikz-flora uses, does not put texlua on PATH.
texlua := env("TEXLUA", if path_exists(env("HOME") / "Library/TinyTeX/bin/universal-darwin/texlua") == "true" { env("HOME") / "Library/TinyTeX/bin/universal-darwin/texlua" } else { "texlua" })
luajit := env("LUAJIT", "luajit")

# Type-check everything.
typecheck:
    npx tsc --noEmit -p .

# The engine as Lua (TypeScriptToLua): build/lua53/ for LuaTeX and build/jit/
# for LuaJIT, each holding flora.lua, the engine as one module, tests.lua,
# its tests, and dump.lua (tests/agreement.ts).
build-lua:
    rm -rf build/lua53 build/jit
    for c in lua53 jit; do \
      npx tstl -p tsconfig.$c.json --luaBundle flora.lua --luaBundleEntry src/engine/index.ts && \
      npx tstl -p tsconfig.$c.json --luaBundle tests.lua --luaBundleEntry tests/engine/run.ts && \
      npx tstl -p tsconfig.$c.json --luaBundle dump.lua --luaBundleEntry tests/engine/dump.ts || exit 1; \
    done

# The engine's tests under texlua and LuaJIT, and each bundle loaded as a
# plain module.
test-lua: build-lua
    {{texlua}} build/lua53/tests.lua
    {{luajit}} build/jit/tests.lua
    {{texlua}} tests/engine/load.lua build/lua53/flora.lua
    {{luajit}} tests/engine/load.lua build/jit/flora.lua
    node tests/agreement.ts

# The engine against tikz-flora's Lua generator, which it was ported from
# (TIKZ_FLORA: the checkout, default ../tikz-flora).
reference:
    node tests/reference.ts

# Unit tests and the engine's tests under Node, the renderers in headless
# Chrome, then the engine's tests in Lua.
test: typecheck
    node --test tests/*.test.ts
    node tests/engine/run.ts
    node tests/browser.mjs
    just test-lua
    just reference

# Times the engine in headless Chrome: grows LEAVES leaves with their
# washes, converts the scene and draws it with WebGL2 (build/leaf-bench.png).
leaf-bench LEAVES="50" RUNS="5" SCALE="2":
    node tests/leaf-bench.mjs {{LEAVES}} {{RUNS}} {{SCALE}}

# The same for BLOOMS blooms of every style, the tilted hero and lilies
# (build/bloom-bench.png).
bloom-bench BLOOMS="12" RUNS="5" SCALE="2":
    node tests/leaf-bench.mjs {{BLOOMS}} {{RUNS}} {{SCALE}} blooms

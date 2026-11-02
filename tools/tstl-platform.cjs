// A TypeScriptToLua plugin: "#platform" (package.json "imports") becomes
// lua/53/platform.lua for Lua 5.3 builds and lua/jit/platform.lua for
// LuaJIT ones. TypeScript types it with lua/platform.d.ts, which the
// "flora-lua" condition selects; TSTL's own resolver does not read
// "imports".
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const DIRS = { "5.3": "53", JIT: "jit" };

module.exports = {
  moduleResolution(id, _file, options) {
    if (id !== "#platform") return undefined;
    const dir = DIRS[options.luaTarget];
    if (!dir) throw new Error(`#platform: no platform for luaTarget ${options.luaTarget}`);
    return path.join(ROOT, "lua", dir, "platform.lua");
  },
};

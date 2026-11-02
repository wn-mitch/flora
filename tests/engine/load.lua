-- The engine bundle loads as a plain Lua module, as LuaTeX and mlua load
-- it: `lua load.lua build/<target>/flora.lua`.
local path = assert(arg[1], "usage: load.lua <bundle>")
local flora = dofile(path)
assert(type(flora) == "table", path .. " did not return a module")
assert(flora.fmt(-0.00001, 4) == "0.0000", "fmt from the bundle")
assert(flora.mul32(0xdeadbeef, 0xcafebabe) == 0x88cf5b62, "mul32 from the bundle")
assert(flora.mod(-7, 3) == 2, "mod from the bundle")
io.write(_VERSION, ": ", path, " loads\n")

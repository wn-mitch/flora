-- What the engine needs from its host, for LuaJIT (games, through mlua);
-- see src/engine/platform.ts, whose answers these match. LuaJIT's bit
-- library returns signed 32-bit results, so each is brought back to
-- [0, 2^32).
-- LuaJIT opens its bit library as a global; a require() here would send
-- TypeScriptToLua's bundler looking for a bit.lua.
local bit = assert(rawget(_G, "bit"), "flora needs LuaJIT's bit library")
local M = {}
local U = 4294967296
local floor, fmod = math.floor, math.fmod

function M.add32(a, b) return (a + b) % U end
-- In 16-bit halves, so every product stays exact in a double.
function M.mul32(a, b)
  local al, bl = a % 65536, b % 65536
  local ah, bh = floor(a / 65536) % 65536, floor(b / 65536) % 65536
  return ((ah * bl + al * bh) % 65536 * 65536 + al * bl) % U
end
function M.xor32(a, b) return bit.bxor(a, b) % U end
function M.and32(a, b) return bit.band(a, b) % U end
function M.or32(a, b) return bit.bor(a, b) % U end
function M.shl32(a, n) return bit.lshift(a, n) % U end
function M.shr32(a, n) return bit.rshift(a, n) % U end

-- LuaJIT's `%` is a - floor(a/b)*b, which can differ from Lua 5.3's in the
-- last bit; this is 5.3's: fmod, moved to the sign of b.
function M.mod(a, b)
  local m = fmod(a, b)
  if m ~= 0 and (m < 0) ~= (b < 0) then m = m + b end
  return m
end

function M.fmt(x, digits)
  if x ~= x or x == math.huge or x == -math.huge then error("fmt: " .. tostring(x) .. " is not finite", 2) end
  if type(digits) ~= "number" or digits < 0 or digits > 12 or digits ~= floor(digits) then error("fmt: " .. tostring(digits) .. " digits", 2) end
  if math.abs(x) >= 1e15 then error("fmt: " .. tostring(x) .. " is too large", 2) end
  local s = string.format("%." .. digits .. "f", x)
  if s:match("^%-[0.]+$") then s = s:sub(2) end
  return s
end

function M.sortedKeys(o)
  local keys = {}
  for k in pairs(o) do keys[#keys + 1] = k end
  table.sort(keys)
  return keys
end
function M.sortNumbers(xs) table.sort(xs) end
function M.utf8(s) return { s:byte(1, -1) } end

function M.hypot(x, y) return math.sqrt(x * x + y * y) end

function M.out(line) io.write(line, "\n") end
function M.exit(code) os.exit(code) end

return M

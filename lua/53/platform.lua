-- What the engine needs from its host, for Lua 5.3 (LuaTeX); see
-- src/engine/platform.ts, whose answers these match.
local M = {}
local MASK = 0xffffffff

function M.add32(a, b) return (a + b) & MASK end
-- Integer multiplication wraps at 64 bits, so the low 32 are exact.
function M.mul32(a, b) return ((a & MASK) * (b & MASK)) & MASK end
function M.xor32(a, b) return (a ~ b) & MASK end
function M.and32(a, b) return a & b & MASK end
function M.or32(a, b) return (a | b) & MASK end
function M.shl32(a, n) return (a << n) & MASK end
function M.shr32(a, n) return (a & MASK) >> n end

-- Lua's own `%` floors, as mod should.
function M.mod(a, b) return a % b end

function M.fmt(x, digits)
  if x ~= x or x == math.huge or x == -math.huge then error("fmt: " .. tostring(x) .. " is not finite", 2) end
  if type(digits) ~= "number" or digits < 0 or digits > 12 or digits ~= math.floor(digits) then error("fmt: " .. tostring(digits) .. " digits", 2) end
  if math.abs(x) >= 1e15 then error("fmt: " .. tostring(x) .. " is too large", 2) end
  local s = string.format("%." .. math.floor(digits) .. "f", x)
  if s:match("^%-[0.]+$") then s = s:sub(2) end
  return s
end

function M.hypot(x, y) return math.sqrt(x * x + y * y) end

function M.out(line) io.write(line, "\n") end
function M.exit(code) os.exit(code) end

return M

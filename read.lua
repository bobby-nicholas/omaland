-- Reads a chunk of Hyprland Lua config by running it against recording stubs,
-- and reports what it set. Lua reading Lua, so there is no second grammar to
-- keep in sync with Hyprland's.
--
--   lua read.lua <path>        run a file  (Omarchy's shipped looknfeel.lua)
--   lua read.lua -e <source>   run a string (an Omaland managed block)
--
-- Output is one tab-separated record per line:
--
--   k  <key:path>  <type>  <value>                     an hl.config setting
--   a  <leaf>  <enabled>  <speed>  <bezier>  <style>   an hl.animation leaf
--   w  <opacity>                                       a window rule opacity
--
-- Nothing is applied: every stub only records. Exits non-zero with the Lua
-- error on stderr if the chunk does not load or run.

local out = {}

local function clean(s)
  return (tostring(s):gsub("\t", " "):gsub("\n", " "))
end

local function emit(...)
  local parts = {}
  for i, v in ipairs({ ... }) do parts[i] = clean(v) end
  out[#out + 1] = table.concat(parts, "\t")
end

local function walk(t, prefix)
  for k, v in pairs(t) do
    local path = prefix == "" and tostring(k) or (prefix .. ":" .. tostring(k))
    if type(v) == "table" then
      walk(v, path)
    else
      emit("k", path, type(v), v)
    end
  end
end

hl = {
  config = function(t) walk(t, "") end,
  animation = function(t)
    emit("a", t.leaf or "", t.enabled ~= false, t.speed or "", t.bezier or "", t.style or "")
  end,
  curve = function() end,
  window_rule = function(t) if t and t.opacity then emit("w", t.opacity) end end,
  bind = function() end,
  unbind = function() end,
  monitor = function() end,
  on = function() end,
}

o = {
  window = function(_, rules)
    if type(rules) == "table" and rules.opacity then emit("w", rules.opacity) end
  end,
  bind = function() end,
}

local source, name
if arg[1] == "-e" then
  source, name = arg[2] or "", "omaland-block"
else
  local file, err = io.open(arg[1], "r")
  if not file then
    io.stderr:write(tostring(err))
    os.exit(1)
  end
  source, name = file:read("a"), arg[1]
  file:close()
end

local chunk, loadErr = load(source, name, "t")
if not chunk then
  io.stderr:write(tostring(loadErr))
  os.exit(1)
end

local ok, runErr = pcall(chunk)
if not ok then
  io.stderr:write(tostring(runErr))
  os.exit(1)
end

print(table.concat(out, "\n"))

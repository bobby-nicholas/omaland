// Pure-JS tests for the two library files. QML's `.pragma library` header is
// stripped so node can evaluate them; nothing else about the modules changes.
//
//   node test/run.js

const fs = require("fs")
const path = require("path")

const root = path.join(__dirname, "..")

function load(file, exports) {
  const src = fs.readFileSync(path.join(root, file), "utf8").replace(".pragma library", "")
  const module = {}
  new Function("__exports", src + "\n;Object.assign(__exports, {" + exports.join(",") + "});")(module)
  return module
}

const Schema = load("Schema.js", [
  "SECTIONS", "ANIMATION_SPEED_KEY", "allItems", "itemFor", "queryKeys", "quantize"
])
const Lua = load("LuaConfig.js", [
  "renderBlock", "renderConfigBody", "renderWindowsBody", "renderPreview",
  "parseOverrides", "applyBlock", "parseAnimationBaseline", "splitBlock"
])

let failures = 0
function check(name, condition, detail) {
  if (condition) {
    console.log("  ok   " + name)
  } else {
    failures++
    console.log("  FAIL " + name + (detail === undefined ? "" : "  → " + detail))
  }
}
// Key order is not part of the contract — the managed block groups keys the way
// a person would write them, not the order they were set — so compare plain
// objects by sorted key.
function stable(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value)
  return JSON.stringify(Object.keys(value).sort().map(function(k) { return [k, value[k]] }))
}
function eq(name, actual, expected) {
  check(name, stable(actual) === stable(expected),
        "got " + JSON.stringify(actual) + ", want " + JSON.stringify(expected))
}

const OMARCHY = process.env.OMARCHY_PATH || "/usr/share/omarchy"
const defaultsPath = OMARCHY + "/default/hypr/looknfeel.lua"
const baseline = fs.existsSync(defaultsPath)
  ? Lua.parseAnimationBaseline(fs.readFileSync(defaultsPath, "utf8"))
  : []

console.log("\nSchema")

// Regression: the numeric guard used to run before the type dispatch, so
// Number("dwindle") → NaN → 0. Hyprland then accepted a layout literally named
// "0" without reporting a config error, silently breaking tiling.
const layout = Schema.itemFor("general:layout")
eq("enum keeps its name", Schema.quantize(layout, "dwindle"), "dwindle")
eq("enum never degrades to a number", Schema.quantize(layout, "scrolling"), "scrolling")

const rounding = Schema.itemFor("decoration:rounding")
eq("int rounds", Schema.quantize(rounding, 11.6), 12)

const noise = Schema.itemFor("decoration:blur:noise")
eq("float honours decimals", Schema.quantize(noise, 0.0123456), 0.012)
eq("float drops binary dust", Schema.quantize(Schema.itemFor("decoration:blur:vibrancy"), 0.7300000000000001), 0.73)

const dim = Schema.itemFor("decoration:dim_inactive")
eq("bool stays strict", Schema.quantize(dim, "yes"), false)
eq("bool true", Schema.quantize(dim, true), true)

check("every item has a unique key", (function() {
  const seen = {}
  return Schema.allItems().every(function(i) {
    if (seen[i.key]) return false
    seen[i.key] = true
    return true
  })
})())

// A plain `needs` dims the row and must name a bool; `needs` + `needsValue`
// hides it and must name an enum that actually offers that value.
check("every plain `needs` points at a real bool", Schema.allItems().every(function(i) {
  if (!i.needs || i.needsValue !== undefined) return true
  const dep = Schema.itemFor(i.needs)
  return dep && dep.type === "bool"
}))
check("every `needsValue` names a real option of a real enum", Schema.allItems().every(function(i) {
  if (i.needsValue === undefined) return true
  const dep = Schema.itemFor(i.needs)
  if (!dep || dep.type !== "enum") return false
  return (dep.options || []).some(function(o) { return String(o.value) === String(i.needsValue) })
}))

const forceSplit = Schema.itemFor("dwindle:force_split")
eq("numeric enum stays a number", Schema.quantize(forceSplit, "2"), 2)
check("numeric enum renders unquoted",
      Lua.renderConfigBody({ "dwindle:force_split": 2 }, baseline).indexOf("force_split = 2,") !== -1)
eq("numeric enum round trips",
   Lua.parseOverrides(Lua.applyBlock("", Lua.renderConfigBody({ "dwindle:force_split": 0 }, baseline)))["dwindle:force_split"], 0)
check("string enums still quote",
      Lua.renderConfigBody({ "master:orientation": "top" }, baseline).indexOf('orientation = "top"') !== -1)

// hyprctl is asked only about real options; synthetics are backed by emitted
// Lua and must stay out of the getoption batch.
eq("synthetic keys are excluded from the hyprctl batch",
   Schema.allItems().filter(function(i) { return i.synthetic }).map(function(i) { return i.key }).sort(),
   ["omaland:animation_speed", "omaland:opaque_windows"])
check("every non-synthetic key is queried",
      Schema.queryKeys().every(function(k) { return k.indexOf("omaland:") !== 0 }))
eq("queryKeys covers exactly the real options",
   Schema.queryKeys().length, Schema.allItems().length - 2)

// Hyprland spells colors as a `col` path segment (general:col:active_border,
// group:groupbar:col:active) or a segment containing "color"
// (decoration:shadow:color, group:groupbar:text_color). Matched per segment so
// scrolling:column_width isn't a false positive.
check("no color options are exposed", Schema.allItems().every(function(i) {
  return i.key.split(":").every(function(seg) {
    return seg !== "col" && seg.indexOf("color") === -1
  })
}))

console.log("\nLua rendering")

const overrides = {
  "general:gaps_in": 8,
  "general:border_size": 3,
  "general:layout": "scrolling",
  "decoration:rounding": 12,
  "decoration:blur:enabled": true,
  "decoration:blur:size": 6,
  "decoration:blur:noise": 0.015,
  "decoration:shadow:sharp": false
}

const body = Lua.renderConfigBody(overrides, baseline)
check("enum renders as a quoted Lua string", body.indexOf('layout = "scrolling"') !== -1, body)
check("booleans render bare", body.indexOf("enabled = true") !== -1)
check("nested tables nest", /blur = \{[\s\S]*size = 6/.test(body))

eq("empty override set renders nothing", Lua.renderConfigBody({}, baseline), "")

const opaque = Lua.renderWindowsBody({ "omaland:opaque_windows": true })
check("opaque toggle uses Omarchy's o.window helper",
      /o\.window\("\.\*", \{ opacity = "1 1" \}\)/.test(opaque), opaque)
check("opaque toggle writes its marker", opaque.indexOf("-- omaland:opaque_windows = true") !== -1)
eq("opaque toggle off emits nothing", Lua.renderWindowsBody({ "omaland:opaque_windows": false }), "")
eq("window rules stay out of the looknfeel body",
   Lua.renderConfigBody({ "omaland:opaque_windows": true }, baseline), "")
eq("config settings stay out of the hyprland body",
   Lua.renderWindowsBody({ "decoration:rounding": 12 }), "")
check("preview carries both bodies", (function() {
  const both = Lua.renderPreview({ "decoration:rounding": 12, "omaland:opaque_windows": true }, baseline)
  return both.indexOf("rounding = 12") !== -1 && both.indexOf("o.window") !== -1
})())

console.log("\nManaged block round trip")

const userFile = [
  "-- my own config",
  "hl.config({ general = { resize_on_border = true } })",
  ""
].join("\n")

const configBody = Lua.renderConfigBody(overrides, baseline)
const withBlock = Lua.applyBlock(userFile, configBody)
check("user content is preserved verbatim", withBlock.indexOf(userFile.trim()) === 0)
eq("round trip is exact", Lua.parseOverrides(withBlock), overrides)
eq("re-rendering is idempotent",
   Lua.applyBlock(withBlock, Lua.renderConfigBody(Lua.parseOverrides(withBlock), baseline)), withBlock)
eq("clearing every override restores the original file", Lua.applyBlock(withBlock, ""), userFile)

// A block that was hand-edited between sessions has to survive being read back.
const handEdited = withBlock.replace("gaps_in = 8", "gaps_in = 21  -- bumped by hand")
eq("hand edits are read back", Lua.parseOverrides(handEdited)["general:gaps_in"], 21)

console.log("\nAnimation baseline")

if (baseline.length === 0) {
  console.log("  skip (no " + defaultsPath + " on this machine)")
} else {
  check("baseline parsed", baseline.length >= 10, baseline.length + " leaves")
  const windows = baseline.filter(function(l) { return l.leaf === "windows" })[0]
  check("a known leaf carries speed + curve", windows && windows.speed > 0 && windows.bezier !== "")

  const styled = baseline.filter(function(l) { return l.style })[0]
  check("styles survive parsing", !!styled, JSON.stringify(styled))

  const doubled = Lua.renderConfigBody({ "omaland:animation_speed": 2 }, baseline)
  const halved = new RegExp("leaf = \"windows\", enabled = true, speed = "
    + String(Math.round((windows.speed / 2) * 100) / 100).replace(".", "\\."))
  check("multiplier halves the duration", halved.test(doubled), doubled.split("\n")[2])
  check("marker is written for round trip", doubled.indexOf("-- omaland:animation_speed = 2") !== -1)
  eq("marker round trips",
     Lua.parseOverrides(Lua.applyBlock("", Lua.renderConfigBody({ "omaland:animation_speed": 2 }, baseline)))["omaland:animation_speed"], 2)

  // Scaling must always start from the shipped set, never from a previous
  // result, or repeated adjustments would compound.
  const once = Lua.renderConfigBody({ "omaland:animation_speed": 1.5 }, baseline)
  const twice = Lua.renderConfigBody({ "omaland:animation_speed": 1.5 }, baseline)
  eq("multiplier does not compound", once, twice)

  check("disabled leaves emit no speed",
        /leaf = "workspaces", enabled = false \}/.test(doubled))
}

console.log("")
if (failures > 0) {
  console.log(failures + " failing\n")
  process.exit(1)
}
console.log("all passing\n")

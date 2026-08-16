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
  "renderBlock", "renderBody", "parseOverrides", "applyBlock", "parseAnimationBaseline", "splitBlock"
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

check("every `needs` points at a real bool", Schema.allItems().every(function(i) {
  if (!i.needs) return true
  const dep = Schema.itemFor(i.needs)
  return dep && dep.type === "bool"
}))

// hyprctl is asked only about real options; synthetics are backed by emitted
// Lua and must stay out of the getoption batch.
eq("synthetic keys are excluded from the hyprctl batch",
   Schema.allItems().filter(function(i) { return i.synthetic }).map(function(i) { return i.key }).sort(),
   ["omaland:animation_speed", "omaland:opaque_windows"])
check("every non-synthetic key is queried",
      Schema.queryKeys().every(function(k) { return k.indexOf("omaland:") !== 0 }))
eq("queryKeys covers exactly the real options",
   Schema.queryKeys().length, Schema.allItems().length - 2)

check("no color options are exposed", Schema.allItems().every(function(i) {
  return i.key.indexOf("col") === -1 && i.key.indexOf("color") === -1
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

const body = Lua.renderBody(overrides, baseline)
check("enum renders as a quoted Lua string", body.indexOf('layout = "scrolling"') !== -1, body)
check("booleans render bare", body.indexOf("enabled = true") !== -1)
check("nested tables nest", /blur = \{[\s\S]*size = 6/.test(body))

eq("empty override set renders nothing", Lua.renderBody({}, baseline), "")

const opaque = Lua.renderBody({ "omaland:opaque_windows": true }, baseline)
check("opaque toggle emits a blanket window rule",
      /hl\.window_rule\(\{ match = \{ class = "\.\*" \}, opacity = "1 1" \}\)/.test(opaque), opaque)
check("opaque toggle writes its marker", opaque.indexOf("-- omaland:opaque_windows = true") !== -1)
eq("opaque marker round trips",
   Lua.parseOverrides(Lua.applyBlock("", { "omaland:opaque_windows": true }, baseline))["omaland:opaque_windows"], true)
// The rule lives outside hl.config(); the table reader must not scrape it.
eq("window rule does not leak into parsed config keys",
   Object.keys(Lua.parseOverrides(Lua.applyBlock("", { "omaland:opaque_windows": true }, baseline))),
   ["omaland:opaque_windows"])
eq("opaque toggle off emits nothing", Lua.renderBody({ "omaland:opaque_windows": false }, baseline), "")

console.log("\nManaged block round trip")

const userFile = [
  "-- my own config",
  "hl.config({ general = { resize_on_border = true } })",
  ""
].join("\n")

const withBlock = Lua.applyBlock(userFile, overrides, baseline)
check("user content is preserved verbatim", withBlock.indexOf(userFile.trim()) === 0)
eq("round trip is exact", Lua.parseOverrides(withBlock), overrides)
eq("re-rendering is idempotent", Lua.applyBlock(withBlock, Lua.parseOverrides(withBlock), baseline), withBlock)
eq("clearing every override restores the original file", Lua.applyBlock(withBlock, {}, baseline), userFile)

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

  const doubled = Lua.renderBody({ "omaland:animation_speed": 2 }, baseline)
  const halved = new RegExp("leaf = \"windows\", enabled = true, speed = "
    + String(Math.round((windows.speed / 2) * 100) / 100).replace(".", "\\."))
  check("multiplier halves the duration", halved.test(doubled), doubled.split("\n")[2])
  check("marker is written for round trip", doubled.indexOf("-- omaland:animation_speed = 2") !== -1)
  eq("marker round trips",
     Lua.parseOverrides(Lua.applyBlock("", { "omaland:animation_speed": 2 }, baseline))["omaland:animation_speed"], 2)

  // Scaling must always start from the shipped set, never from a previous
  // result, or repeated adjustments would compound.
  const once = Lua.renderBody({ "omaland:animation_speed": 1.5 }, baseline)
  const twice = Lua.renderBody({ "omaland:animation_speed": 1.5 }, baseline)
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

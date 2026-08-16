.pragma library

// Renders and parses Omaland's managed blocks, one per file:
//
//   hypr/looknfeel.lua   hl.config / hl.animation
//   hypr/hyprland.lua    o.window rules, where the stock template's own
//                        example puts personal window rules
//
// Only what's between the fences is ever rewritten. The same text feeds
// `hyprctl eval` for the live preview, so preview and saved state can't drift.

var BEGIN_FENCE = "-- >>> omaland managed block >>>"
var END_FENCE = "-- <<< omaland managed block <<<"

var ANIMATION_SPEED_KEY = "omaland:animation_speed"
var OPAQUE_WINDOWS_KEY = "omaland:opaque_windows"

var SYNTHETIC_KEYS = [ANIMATION_SPEED_KEY, OPAQUE_WINDOWS_KEY]

// ---------------------------------------------------------------- rendering

function luaNumber(n) {
  var v = Number(n)
  if (!isFinite(v)) return "0"
  if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v))
  return String(parseFloat(v.toFixed(4)))
}

function luaValue(value) {
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") return luaNumber(value)
  return '"' + String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'
}

function isSynthetic(key) {
  return SYNTHETIC_KEYS.indexOf(key) !== -1
}

function nest(overrides) {
  var tree = {}
  for (var key in overrides) {
    if (isSynthetic(key)) continue
    var parts = key.split(":")
    var node = tree
    for (var i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]] || typeof node[parts[i]] !== "object") node[parts[i]] = {}
      node = node[parts[i]]
    }
    node[parts[parts.length - 1]] = overrides[key]
  }
  return tree
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v)
}

// Scalars first, then nested tables — the shape Omarchy's own looknfeel.lua uses.
function renderTable(node, indent) {
  var pad = new Array(indent + 1).join(" ")
  var inner = new Array(indent + 3).join(" ")
  var keys = Object.keys(node).sort()
  var lines = []
  for (var i = 0; i < keys.length; i++)
    if (!isPlainObject(node[keys[i]]))
      lines.push(inner + keys[i] + " = " + luaValue(node[keys[i]]) + ",")
  for (var j = 0; j < keys.length; j++) {
    if (!isPlainObject(node[keys[j]])) continue
    if (lines.length > 0) lines.push("")
    lines.push(inner + keys[j] + " = " + renderTable(node[keys[j]], indent + 2).replace(/^\s+/, "") + ",")
  }
  return pad + "{\n" + lines.join("\n") + "\n" + pad + "}"
}

function renderConfig(overrides) {
  var tree = nest(overrides)
  if (Object.keys(tree).length === 0) return ""
  return "hl.config(" + renderTable(tree, 0) + ")"
}

// Hyprland's third animation field is a duration in deciseconds, so a faster
// animation is a smaller number: duration = base / multiplier.
function renderAnimations(baseline, multiplier) {
  if (!baseline || baseline.length === 0) return ""
  var m = Number(multiplier)
  if (!isFinite(m) || m <= 0) return ""
  var lines = []
  for (var i = 0; i < baseline.length; i++) {
    var leaf = baseline[i]
    var parts = ['leaf = "' + leaf.leaf + '"', "enabled = " + (leaf.enabled ? "true" : "false")]
    if (leaf.enabled) {
      if (leaf.speed !== undefined && leaf.speed !== null)
        parts.push("speed = " + luaNumber(Math.round(Math.max(0.01, leaf.speed / m) * 100) / 100))
      if (leaf.bezier) parts.push('bezier = "' + leaf.bezier + '"')
      if (leaf.style) parts.push('style = "' + leaf.style + '"')
    }
    lines.push("hl.animation({ " + parts.join(", ") + " })")
  }
  return lines.join("\n")
}

function renderConfigBody(overrides, baseline) {
  var chunks = []
  var config = renderConfig(overrides)
  if (config) chunks.push(config)

  if (overrides[ANIMATION_SPEED_KEY] !== undefined) {
    var animations = renderAnimations(baseline, Number(overrides[ANIMATION_SPEED_KEY]))
    if (animations) chunks.push(animations)
  }
  return chunks.join("\n\n")
}

// Re-applies Omarchy's blanket opacity rule at 1.0. Registered after
// default/hypr/windows.lua, so it wins; the decoration:*_opacity globals still
// multiply on top, which is what keeps the opacity sliders meaningful.
function renderWindowsBody(overrides) {
  if (overrides[OPAQUE_WINDOWS_KEY] !== true) return ""
  return 'o.window(".*", { opacity = "1 1" })'
}

// Everything Omaland currently asserts, in one chunk, for `hyprctl eval`.
function renderPreview(overrides, baseline) {
  var parts = []
  var config = renderConfigBody(overrides, baseline)
  var windows = renderWindowsBody(overrides)
  if (config) parts.push(config)
  if (windows) parts.push(windows)
  return parts.join("\n\n")
}

function renderBlock(body) {
  var header = BEGIN_FENCE + "\n"
    + "-- Written by Omaland. Safe to hand-edit: Omaland re-reads this block\n"
    + "-- every time it opens, and only ever rewrites what's between the fences.\n"
  if (!body) return header + END_FENCE
  return header + body + "\n" + END_FENCE
}

// ------------------------------------------------------------------ parsing

// read.lua runs a chunk against recording stubs and prints one tab-separated
// record per line. Turning that into state is a split, not a parser.
//
//   k  <key:path>  <type>  <value>
//   a  <leaf>  <enabled>  <speed>  <bezier>  <style>
//   w  <opacity>
function parseHarness(stdout) {
  var result = { overrides: {}, animations: [], opaque: false }
  var lines = String(stdout || "").split("\n")

  for (var i = 0; i < lines.length; i++) {
    var f = lines[i].split("\t")
    if (f[0] === "k" && f.length >= 4) {
      result.overrides[f[1]] = f[2] === "number" ? Number(f[3])
        : f[2] === "boolean" ? f[3] === "true"
        : f[3]
    } else if (f[0] === "a" && f.length >= 6) {
      result.animations.push({
        leaf: f[1],
        enabled: f[2] === "true",
        speed: f[3] === "" ? undefined : Number(f[3]),
        bezier: f[4],
        style: f[5]
      })
    } else if (f[0] === "w") {
      result.opaque = true
    }
  }
  return result
}

// The multiplier is whatever the block's animations are scaled by, measured
// against the shipped baseline on a leaf both define.
function animationSpeedFrom(animations, baseline) {
  for (var i = 0; i < baseline.length; i++) {
    var base = baseline[i]
    if (!base.speed) continue
    for (var j = 0; j < animations.length; j++) {
      if (animations[j].leaf !== base.leaf || !animations[j].speed) continue
      return Math.round((base.speed / animations[j].speed) * 20) / 20
    }
  }
  return undefined
}





function splitBlock(text) {
  var source = String(text || "")
  var begin = source.indexOf(BEGIN_FENCE)
  if (begin === -1) return { found: false, before: source, body: "", after: "" }
  var endFence = source.indexOf(END_FENCE, begin)
  if (endFence === -1) return { found: false, before: source, body: "", after: "" }
  return {
    found: true,
    before: source.substring(0, begin),
    body: source.substring(begin + BEGIN_FENCE.length, endFence),
    after: source.substring(endFence + END_FENCE.length)
  }
}


// An empty body removes the block rather than leaving an empty husk.
function applyBlock(text, body) {
  var split = splitBlock(text)

  if (!body) {
    if (!split.found) return String(text || "")
    var joined = split.before.replace(/\n+$/, "\n") + split.after.replace(/^\n+/, "")
    return joined.replace(/\n{3,}$/, "\n")
  }

  var block = renderBlock(body)
  if (split.found) return split.before + block + split.after

  var head = String(text || "")
  if (head.length > 0 && head.charAt(head.length - 1) !== "\n") head += "\n"
  return head + "\n" + block + "\n"
}

// --------------------------------------------------- animation baseline


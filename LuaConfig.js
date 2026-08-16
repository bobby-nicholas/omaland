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
    var m = Number(overrides[ANIMATION_SPEED_KEY])
    var animations = renderAnimations(baseline, m)
    if (animations) {
      chunks.push("-- omaland:animation_speed = " + luaNumber(m) + "\n"
        + "-- Omarchy's animation set, re-timed. Higher multiplier = shorter durations.\n"
        + animations)
    }
  }
  return chunks.join("\n\n")
}

// Re-applies Omarchy's blanket opacity rule at 1.0. Registered after
// default/hypr/windows.lua, so it wins; the decoration:*_opacity globals still
// multiply on top, which is what keeps the opacity sliders meaningful.
function renderWindowsBody(overrides) {
  if (overrides[OPAQUE_WINDOWS_KEY] !== true) return ""
  return "-- omaland:opaque_windows = true\n"
    + "-- Overrides Omarchy's default 0.985/0.96 window opacity rule.\n"
    + 'o.window(".*", { opacity = "1 1" })'
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

function parseConfigCalls(body, out) {
  var start = 0
  while (true) {
    var at = body.indexOf("hl.config(", start)
    if (at === -1) return
    var open = body.indexOf("{", at)
    if (open === -1) return
    var end = matchBrace(body, open)
    if (end === -1) return
    readTable(body.substring(open + 1, end), [], out)
    start = end + 1
  }
}

// Index of the `}` closing the `{` at `open`, skipping string literals so a
// brace inside "popin 87%" can't throw the count off.
function matchBrace(text, open) {
  var depth = 0
  for (var i = open; i < text.length; i++) {
    var c = text.charAt(i)
    if (c === '"' || c === "'") {
      var quote = c
      i++
      while (i < text.length && text.charAt(i) !== quote) {
        if (text.charAt(i) === "\\") i++
        i++
      }
      continue
    }
    if (c === "{") depth++
    else if (c === "}") {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function stripComments(text) {
  return text.replace(/--[^\n]*/g, "")
}

// Tolerant reader for the subset of Lua the block contains: nested tables of
// scalars. Anything it can't make sense of is skipped rather than guessed at.
function readTable(text, prefix, out) {
  var src = stripComments(text)
  var re = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*/g
  var match
  while ((match = re.exec(src)) !== null) {
    var name = match[1]
    var rest = src.substring(re.lastIndex)
    var lead = rest.match(/^\s*/)[0]
    var valueStart = re.lastIndex + lead.length

    if (src.charAt(valueStart) === "{") {
      var close = matchBrace(src, valueStart)
      if (close === -1) return
      readTable(src.substring(valueStart + 1, close), prefix.concat([name]), out)
      re.lastIndex = close + 1
      continue
    }

    var scalar = rest.match(/^\s*(true|false|-?\d+(?:\.\d+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/)
    if (!scalar) continue
    var raw = scalar[1]
    var value
    if (raw === "true") value = true
    else if (raw === "false") value = false
    else if (raw.charAt(0) === '"' || raw.charAt(0) === "'") value = raw.substring(1, raw.length - 1)
    else value = Number(raw)

    out[prefix.concat([name]).join(":")] = value
    re.lastIndex = valueStart + scalar[1].length
  }
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

// Serves both files: whichever of markers / hl.config isn't there contributes
// nothing.
function parseOverrides(text) {
  var out = {}
  var split = splitBlock(text)
  if (!split.found) return out

  var speed = split.body.match(/--\s*omaland:animation_speed\s*=\s*(-?\d+(?:\.\d+)?)/)
  if (speed) out[ANIMATION_SPEED_KEY] = Number(speed[1])
  if (/--\s*omaland:opaque_windows\s*=\s*true/.test(split.body)) out[OPAQUE_WINDOWS_KEY] = true

  parseConfigCalls(split.body, out)
  return out
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

// Parsed from Omarchy's shipped default/hypr/looknfeel.lua, never from our own
// previous output — so the multiplier can't compound and follows upstream if
// Omarchy retunes its animations.
function parseAnimationBaseline(text) {
  var source = String(text || "")
  var out = []
  var re = /hl\.animation\(\s*\{/g
  var match
  while ((match = re.exec(source)) !== null) {
    var open = source.indexOf("{", match.index)
    var close = matchBrace(source, open)
    if (close === -1) break
    var fields = {}
    readTable(source.substring(open + 1, close), [], fields)
    if (typeof fields.leaf !== "string") { re.lastIndex = close + 1; continue }
    out.push({
      leaf: fields.leaf,
      enabled: fields.enabled !== false,
      speed: typeof fields.speed === "number" ? fields.speed : undefined,
      bezier: typeof fields.bezier === "string" ? fields.bezier : "",
      style: typeof fields.style === "string" ? fields.style : ""
    })
    re.lastIndex = close + 1
  }
  return out
}

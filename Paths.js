.pragma library

// Where the plugin lives on disk.
//
// The shell used to hand third-party plugins a manifest carrying the internal
// `__sourceDir`. Since the capability-scoped facades landed, `manifest` is a
// sanitized copy (shell.qml `publicPluginManifest` deletes `__sourceDir`,
// `__isFirstParty` and `__hostCapabilities`), so that field is now undefined
// for anything that isn't first-party.
//
// A QML file always knows its own URL, and every file we need is a sibling of
// an entry point at the root of the plugin directory, so resolving against
// Qt.resolvedUrl() gives the same path the manifest used to carry — and keeps
// working for hand-installs and clones that don't sit under the id-named
// directory `omarchy plugin add` creates.
function fromUrl(url) {
  var text = String(url)
  if (text.indexOf("file://") !== 0) return ""
  return decodeURIComponent(text.substring("file://".length))
}

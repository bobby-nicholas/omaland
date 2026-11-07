.pragma library

// Where the plugin lives on disk.
//
// The manifest the shell hands third-party plugins is a sanitized copy
// (shell.qml `publicPluginManifest`). Omarchy 4.0.4 through 4.0.6 deleted the
// internal `__sourceDir` from it along with the trust markers, so the field
// was undefined for anything that isn't first-party; 4.5 hands it back. Not
// depending on it keeps every version working.
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

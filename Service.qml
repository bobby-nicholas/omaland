import QtQuick
import Quickshell
import Quickshell.Io
import "Paths.js" as Paths
import "LuaConfig.js" as LuaConfig

// Installs the launcher entry, so the panel is reachable from SUPER+SPACE
// without the user wiring up a keybind first. Omarchy has no install hook and
// no manifest field for registering one, so it happens here instead.
//
// Only a file carrying the X-Omaland-Managed marker is written or deleted.
//
// It also brings blocks written by earlier Omaland versions in line with the
// Omarchy now installed (LuaConfig.migrateWindowsBlock), here rather than in the
// panel so an `omarchy plugin update` fixes the desktop without the panel
// being opened. Only Omaland's own lines between its fences change.
QtObject {
  id: root

  property string omarchyPath: ""
  property var shell: null
  property var manifest: null

  // Resolved from this file's own URL rather than the manifest, which carried
  // no __sourceDir for third-party plugins on Omarchy 4.0.4–4.0.6. See Paths.js.
  readonly property string source: Paths.fromUrl(Qt.resolvedUrl("omaland.desktop"))
  readonly property string icon: Paths.fromUrl(Qt.resolvedUrl("icon.png"))

  readonly property string dest: Quickshell.env("HOME") + "/.local/share/applications/omaland.desktop"
  readonly property string marker: "^X-Omaland-Managed=true$"

  readonly property string installScript:
      '[ -f "$1" ] || exit 0\n'
    + 'if [ -e "$2" ] && ! grep -q "$3" "$2"; then exit 0; fi\n'
    + 'mkdir -p "${2%/*}" || exit 0\n'
    + 'tmp=$2.omaland.new\n'
    + 'sed "s|@ICON@|$4|" "$1" > "$tmp" || exit 0\n'
    + 'if cmp -s "$tmp" "$2"; then rm -f "$tmp"; else mv -f "$tmp" "$2"; fi\n'

  readonly property string removeScript:
    'grep -q "$2" "$1" 2>/dev/null && rm -f "$1"\n'

  property bool installed: false

  // ------------------------------------------------------------ migration

  readonly property string omarchyRoot: omarchyPath || Quickshell.env("OMARCHY_PATH") || "/usr/share/omarchy"
  property bool omarchyOwnsOpacity: false
  property bool detected: false
  property bool removedFullOpacity: false

  // Omarchy 4.5 ships an Opaque mode of its own; its toggle file is the tell.
  property FileView opaqueToggle: FileView {
    path: root.omarchyRoot + "/default/hypr/toggles/window-opaque.lua"
    printErrors: false
    onLoaded: { root.omarchyOwnsOpacity = true; root.detected = true }
    onLoadFailed: { root.omarchyOwnsOpacity = false; root.detected = true }
  }

  property FileView windowsFile: FileView {
    path: root.detected ? Quickshell.env("HOME") + "/.config/hypr/hyprland.lua" : ""
    printErrors: false
    atomicWrites: true
    onLoaded: {
      var current = text()
      var migrated = LuaConfig.migrateWindowsBlock(current, root.omarchyOwnsOpacity)
      if (migrated.text === current) return
      root.removedFullOpacity = migrated.removedFullOpacity
      // Deferred: a write from inside the load handler lands, but never
      // reports `saved`, so nothing would reload Hyprland after it.
      Qt.callLater(function() { root.windowsFile.setText(migrated.text) })
    }
    // Detached, so a shell restart or plugin reload mid-way can't cut it short.
    onSaved: Quickshell.execDetached(["sh", "-c", root.applyScript, "sh", root.removedFullOpacity ? "1" : "0"])
  }

  // Full opacity carries over as Omarchy's Opaque mode unless the user already
  // picked a mode there; Omarchy's command reloads Hyprland itself.
  readonly property string applyScript:
      'if [ "$1" = 1 ] && [ "$(omarchy-hyprland-window-transparency)" = transparent ]; then\n'
    + '  exec omarchy-hyprland-window-transparency opaque\n'
    + 'fi\n'
    + 'exec hyprctl reload\n'

  Component.onCompleted: {
    if (source === "" || icon === "") return
    installed = true
    Quickshell.execDetached(["sh", "-c", installScript, "sh", source, dest, marker, icon])
  }

  // Reached on disable and on remove alike: omarchy-plugin-remove disables
  // first, so the service is torn down while the entry is still ours.
  Component.onDestruction: {
    if (!installed) return
    Quickshell.execDetached(["sh", "-c", removeScript, "sh", dest, marker])
  }
}

import QtQuick
import Quickshell

// Installs the launcher entry, so the panel is reachable from SUPER+SPACE
// without the user wiring up a keybind first.
//
// Omarchy has no install hook and no way for a plugin to register itself, so
// this runs on load instead. The shell destroys the service when the plugin is
// disabled or removed, and omarchy-plugin-remove disables before it deletes
// files, so onDestruction is a reliable place to take the entry back out.
//
// Only a file carrying the X-Omaland-Managed marker is ever written or
// deleted. Replace it with your own and Omaland leaves it alone.
QtObject {
  id: root

  property string omarchyPath: ""
  property var shell: null
  property var manifest: null

  readonly property string dest: Quickshell.env("HOME") + "/.local/share/applications/omaland.desktop"
  readonly property string marker: "^X-Omaland-Managed=true$"

  readonly property string installScript:
    '[ -f "$1" ] || exit 0\n'
    + 'if [ -e "$2" ] && ! grep -q "$3" "$2"; then exit 0; fi\n'
    + 'mkdir -p "${2%/*}" || exit 0\n'
    + 'cmp -s "$1" "$2" || cp -f "$1" "$2"\n'

  readonly property string removeScript:
    'grep -q "$2" "$1" 2>/dev/null && rm -f "$1"\n'

  property bool installed: false

  // The shell assigns `manifest` after createObject() has already run
  // Component.onCompleted, so the entry is installed off the property instead.
  // The source path is built here rather than bound, because a binding on
  // `manifest` has not re-evaluated yet when this handler runs.
  onManifestChanged: {
    if (installed || !manifest || !manifest.__sourceDir) return
    installed = true
    Quickshell.execDetached(["sh", "-c", installScript, "sh",
                             manifest.__sourceDir + "/omaland.desktop", dest, marker])
  }

  Component.onDestruction: {
    if (!installed) return
    Quickshell.execDetached(["sh", "-c", removeScript, "sh", dest, marker])
  }
}

import QtQuick
import Quickshell

// Installs the launcher entry, so the panel is reachable from SUPER+SPACE
// without the user wiring up a keybind first. Omarchy has no install hook and
// no manifest field for registering one, so it happens here instead.
//
// Only a file carrying the X-Omaland-Managed marker is written or deleted.
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
    + 'tmp=$2.omaland.new\n'
    + 'sed "s|@ICON@|$4|" "$1" > "$tmp" || exit 0\n'
    + 'if cmp -s "$tmp" "$2"; then rm -f "$tmp"; else mv -f "$tmp" "$2"; fi\n'

  readonly property string removeScript:
    'grep -q "$2" "$1" 2>/dev/null && rm -f "$1"\n'

  property bool installed: false

  // The shell assigns manifest after createObject() has already run
  // Component.onCompleted, and a binding on it has not re-evaluated by the
  // time this fires, so the paths are built here rather than bound.
  onManifestChanged: {
    var dir = manifest && manifest.__sourceDir
    if (installed || !dir) return
    installed = true
    Quickshell.execDetached(["sh", "-c", installScript, "sh",
                             dir + "/omaland.desktop", dest, marker, dir + "/icon.png"])
  }

  // Reached on disable and on remove alike: omarchy-plugin-remove disables
  // first, so the service is torn down while the entry is still ours.
  Component.onDestruction: {
    if (!installed) return
    Quickshell.execDetached(["sh", "-c", removeScript, "sh", dest, marker])
  }
}

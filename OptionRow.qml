import QtQuick
import qs.Commons
import qs.Ui

// One editable option: name and description left, control right, so a slider,
// a switch and a segmented picker all scan as the same kind of thing.
//
// Stateless about the value. `edited` fires continuously while a slider is
// dragged and only drives the live preview; `committed` is the point worth
// writing to disk.
Item {
  id: root

  required property var item
  property var value: 0
  property bool modified: false
  property bool available: true
  property bool hasCursor: false
  property color foreground: Color.foreground
  property color accent: Color.accent
  property string fontFamily: Style.font.family

  signal edited(var value)
  signal committed(var value)
  signal reset()
  signal focusRequested()

  readonly property bool isBool: item.type === "bool"
  readonly property bool isEnum: item.type === "enum"
  readonly property bool isSlider: item.type === "int" || item.type === "float"

  // Widen rather than clamp when the live value sits outside the schema range.
  readonly property real sliderMin: isSlider ? Math.min(item.min, Number(value)) : 0
  readonly property real sliderMax: isSlider ? Math.max(item.max, Number(value)) : 1

  function formatted() {
    if (!isSlider) return ""
    var n = Number(value)
    if (!isFinite(n)) return "—"
    var text = item.type === "int"
      ? String(Math.round(n))
      : n.toFixed(item.decimals === undefined ? 2 : item.decimals)
    return text + (item.unit || "")
  }

  implicitHeight: Math.max(labels.implicitHeight, control.implicitHeight) + Style.spacing.xxl
  opacity: available ? 1 : 0.38
  enabled: available

  Behavior on opacity { NumberAnimation { duration: 120 } }

  Rectangle {
    anchors.fill: parent
    anchors.leftMargin: -Style.spacing.md
    anchors.rightMargin: -Style.spacing.md
    radius: Style.cornerRadius
    color: root.hasCursor ? Style.hoverFillFor(root.foreground, root.accent) : "transparent"
    Behavior on color { ColorAnimation { duration: 100 } }
  }

  MouseArea {
    anchors.fill: parent
    acceptedButtons: Qt.NoButton
    hoverEnabled: true
    onEntered: root.focusRequested()
  }

  Column {
    id: labels
    anchors.left: parent.left
    anchors.verticalCenter: parent.verticalCenter
    width: Math.round(parent.width * 0.42)
    spacing: Style.spacing.xxs

    Row {
      spacing: Style.spacing.sm
      width: parent.width

      Text {
        text: root.item.label
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.subtitle
        font.bold: true
      }

      // Filled pip = this key is present in the managed block.
      Rectangle {
        width: Style.space(5)
        height: width
        radius: width / 2
        color: root.accent
        opacity: root.modified ? 1 : 0
        anchors.verticalCenter: parent.verticalCenter
        Behavior on opacity { NumberAnimation { duration: 120 } }
      }
    }

    Text {
      text: root.item.description
      visible: text !== ""
      color: Qt.darker(root.foreground, 1.55)
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
      width: parent.width
      wrapMode: Text.WordWrap
    }
  }

  Row {
    id: control
    anchors.right: parent.right
    anchors.left: labels.right
    anchors.leftMargin: Style.spacing.xxl
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.spacing.lg
    layoutDirection: Qt.RightToLeft

    // Reserved even when hidden, so sliders stay aligned down the section.
    Item {
      width: undoButton.width
      height: undoButton.height
      anchors.verticalCenter: parent.verticalCenter

      PanelActionButton {
        id: undoButton
        iconText: "󰕌"
        tooltipText: "Reset to Omarchy default"
        foreground: root.foreground
        opacity: root.modified ? 1 : 0
        enabled: root.modified
        onClicked: root.reset()
        Behavior on opacity { NumberAnimation { duration: 120 } }
      }
    }

    Text {
      visible: root.isSlider
      text: root.formatted()
      color: root.modified ? root.accent : root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.body
      horizontalAlignment: Text.AlignRight
      width: Style.space(52)
      anchors.verticalCenter: parent.verticalCenter
    }

    ToggleSwitch {
      visible: root.isBool
      checked: root.value === true
      hasCursor: root.hasCursor
      foreground: root.foreground
      accent: root.accent
      anchors.verticalCenter: parent.verticalCenter
      onToggled: root.committed(!root.value)
    }

    PanelSlider {
      visible: root.isSlider
      width: Math.max(Style.space(90), control.width - undoButton.width - Style.space(52) - Style.spacing.lg * 2)
      minimum: root.sliderMin
      maximum: root.sliderMax
      step: root.item.step === undefined ? 1 : root.item.step
      integer: root.item.type === "int"
      value: Number(root.value)
      fillColor: root.modified ? root.accent : root.foreground
      knobColor: root.modified ? root.accent : root.foreground
      anchors.verticalCenter: parent.verticalCenter
      onMoved: function(v) { root.edited(v) }
      onReleased: function(v) { root.committed(v) }
    }

    ButtonGroup {
      visible: root.isEnum
      options: root.item.options || []
      value: String(root.value)
      foreground: root.foreground
      accent: root.accent
      focusable: false
      anchors.verticalCenter: parent.verticalCenter
      onChanged: function(v) { root.committed(v) }
    }
  }
}

#Requires AutoHotkey v2.0
#SingleInstance Force

ITEMS   := ["After M", "Before M", "After O", "Before O"]
current := 1

MyGui := Gui("+AlwaysOnTop -Caption +ToolWindow")
MyGui.BackColor := "000000"
MyGui.MarginX   := 6
MyGui.MarginY   := 5

textControls := []
xPos := 6
for i, item in ITEMS {
    ; separator between items
    if (i > 1) {
        sep := MyGui.Add("Text", "x" xPos " y5 w6 h16 cFFFFFF", "|")
        sep.SetFont("s9 bold", "Consolas")
        xPos += 10
    }
    ctrl := MyGui.Add("Text", "x" xPos " y5 h16 c" (i = 1 ? "FFFF00" : "FFFFFF"), item)
    ctrl.SetFont("s9 bold", "Consolas")
    textControls.Push(ctrl)
    ; measure approximate width: ~8px per char at s9
    xPos += StrLen(item) * 8 + 4
}

totalW := xPos + 6
MyGui.Show("w" totalW " h26 x50 y50 NoActivate")

; ── drag to move ─────────────────────────────────────────────────────────────
OnMessage(0x0201, WM_LBUTTONDOWN)
WM_LBUTTONDOWN(*) {
    PostMessage(0x00A1, 2)
}

OnMessage(0x0204, WM_RBUTTONDOWN)
WM_RBUTTONDOWN(*) {
    ExitApp
}

MyGui.OnEvent("Close", (*) => ExitApp())

; ── global hotkey: X cycles highlight ────────────────────────────────────────
~x:: {
    global current
    textControls[current].Opt("cFFFFFF")
    current := (current = ITEMS.Length) ? 1 : current + 1
    textControls[current].Opt("cFFFF00")
}

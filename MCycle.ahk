#Requires AutoHotkey v2.0
#SingleInstance Force

ITEMS   := ["After M", "Before M", "After O", "Before O"]
current := 1
visible := true

; ── tray icon ─────────────────────────────────────────────────────────────────
A_TrayMenu.Delete()
A_TrayMenu.Add("Show/Hide", ToggleWindow)
A_TrayMenu.Add("Exit", (*) => ExitApp())
A_TrayMenu.Default := "Show/Hide"

; ── window ────────────────────────────────────────────────────────────────────
MyGui := Gui("+AlwaysOnTop -Caption +ToolWindow")
MyGui.BackColor := "000000"
MyGui.MarginX   := 0
MyGui.MarginY   := 0

FONT_SIZE := 13
CHAR_W    := 9   ; Consolas s13 bold ~9px per char
PAD_X     := 12
SEP_W     := 14
H         := 36

textControls := []
xPos := PAD_X
for i, item in ITEMS {
    if (i > 1) {
        sep := MyGui.Add("Text", "x" xPos " y9 w" SEP_W " h20 cFFFFFF Center", "|")
        sep.SetFont("s" FONT_SIZE " bold", "Consolas")
        xPos += SEP_W
    }
    w := StrLen(item) * CHAR_W + 6
    ctrl := MyGui.Add("Text", "x" xPos " y9 w" w " h20 c" (i = 1 ? "FFFF00" : "FFFFFF"), item)
    ctrl.SetFont("s" FONT_SIZE " bold", "Consolas")
    textControls.Push(ctrl)
    xPos += w
}

MyGui.Show("w" (xPos + PAD_X) " h" H " x50 y50 NoActivate")

; ── drag to move ──────────────────────────────────────────────────────────────
OnMessage(0x0201, WM_LBUTTONDOWN)
WM_LBUTTONDOWN(*) {
    PostMessage(0x00A1, 2)
}

MyGui.OnEvent("Close", (*) => MyGui.Hide())

; ── toggle via tray ───────────────────────────────────────────────────────────
ToggleWindow(*) {
    global visible
    if visible {
        MyGui.Hide()
        visible := false
    } else {
        MyGui.Show("NoActivate")
        visible := true
    }
}

; ── global hotkey: X cycles highlight ────────────────────────────────────────
~x:: {
    global current
    textControls[current].Opt("cFFFFFF")
    current := (current = ITEMS.Length) ? 1 : current + 1
    textControls[current].Opt("cFFFF00")
}

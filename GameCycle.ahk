#Requires AutoHotkey v2.0
#SingleInstance Force

ITEMS   := ["After M", "Before M", "After O", "Before O"]
current := 1

; ── tray icon (bottom-right corner) ──────────────────────────────────────────
A_TrayMenu.Delete()
A_TrayMenu.Add("Show/Hide", ToggleWindow)
A_TrayMenu.Add("Exit", (*) => ExitApp())
A_TrayMenu.Default := "Show/Hide"
TrayTip("GameCycle", "Running — right-click tray icon to exit", 2)

; ── window ────────────────────────────────────────────────────────────────────
MyGui := Gui("+AlwaysOnTop -Caption +ToolWindow +LastFound")
MyGui.BackColor := "000000"
MyGui.MarginX   := 6
MyGui.MarginY   := 5

textControls := []
xPos := 6
for i, item in ITEMS {
    if (i > 1) {
        sep := MyGui.Add("Text", "x" xPos " y5 w8 h16 cFFFFFF", "|")
        sep.SetFont("s9 bold", "Consolas")
        xPos += 10
    }
    ctrl := MyGui.Add("Text", "x" xPos " y5 h16 c" (i = 1 ? "FFFF00" : "FFFFFF"), item)
    ctrl.SetFont("s9 bold", "Consolas")
    textControls.Push(ctrl)
    xPos += StrLen(item) * 8 + 4
}

totalW := xPos + 6
MyGui.Show("w" totalW " h26 x50 y50 NoActivate")

; Keep on top even after losing focus
WinSetAlwaysOnTop(1, MyGui.Hwnd)

; ── drag to move ──────────────────────────────────────────────────────────────
OnMessage(0x0201, WM_LBUTTONDOWN)
WM_LBUTTONDOWN(*) {
    PostMessage(0x00A1, 2)
}

; Close button hides rather than exits (use tray to fully exit)
MyGui.OnEvent("Close", (*) => MyGui.Hide())

; ── toggle visibility ─────────────────────────────────────────────────────────
ToggleWindow(*) {
    if WinExist("ahk_id " MyGui.Hwnd) && WinIsVisible("ahk_id " MyGui.Hwnd)
        MyGui.Hide()
    else
        MyGui.Show("NoActivate")
}

; ── global hotkey: X cycles highlight ────────────────────────────────────────
~x:: {
    global current
    textControls[current].Opt("cFFFFFF")
    current := (current = ITEMS.Length) ? 1 : current + 1
    textControls[current].Opt("cFFFF00")
}

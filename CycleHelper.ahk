#Requires AutoHotkey v2.0
#SingleInstance Force

; ── config ──────────────────────────────────────────────────────────────────
ITEMS   := ["After M", "Before M", "After O", "Before O"]
current := 1   ; 1-indexed, starts highlighted on "After M"

; ── window ──────────────────────────────────────────────────────────────────
MyGui := Gui("+AlwaysOnTop -Caption +ToolWindow")
MyGui.BackColor := "000000"
MyGui.MarginX   := 10
MyGui.MarginY   := 8

textControls := []
for i, item in ITEMS {
    ctrl := MyGui.Add("Text", "w110 h18 c" (i = 1 ? "FFFF00" : "FFFFFF"), item)
    ctrl.SetFont("s10 bold", "Consolas")
    textControls.Push(ctrl)
}

MyGui.Show("w130 h" (ITEMS.Length * 24 + 16) " x50 y50 NoActivate")

; thin border via WS_EX_CLIENTEDGE — skip, keep it flat and clean

; ── drag to move ────────────────────────────────────────────────────────────
MyGui.OnEvent("Size", GuiClose)
OnMessage(0x0201, WM_LBUTTONDOWN)   ; WM_LBUTTONDOWN → drag

WM_LBUTTONDOWN(*) {
    PostMessage(0x00A1, 2)           ; WM_NCLBUTTONDOWN HTCAPTION
}

; right-click closes
OnMessage(0x0204, WM_RBUTTONDOWN)
WM_RBUTTONDOWN(*) {
    ExitApp
}

GuiClose(*) {
    ExitApp
}

; ── global hotkey: X cycles highlight ───────────────────────────────────────
~x:: {
    global current
    textControls[current].Opt("cFFFFFF")     ; deselect old
    current := (current = ITEMS.Length) ? 1 : current + 1
    textControls[current].Opt("cFFFF00")     ; highlight new
}

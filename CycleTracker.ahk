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

; ── window (resizable via +Resize, keep borderless) ───────────────────────────
MyGui := Gui("+AlwaysOnTop -Caption +ToolWindow +Resize")
MyGui.BackColor := "000000"
MyGui.MarginX   := 0
MyGui.MarginY   := 0

textControls := []
xPos := 8
for i, item in ITEMS {
    if (i > 1) {
        sep := MyGui.Add("Text", "x" xPos " y6 w10 h16 cFFFFFF", "|")
        sep.SetFont("s9 bold", "Consolas")
        xPos += 12
    }
    w := StrLen(item) * 9 + 2
    ctrl := MyGui.Add("Text", "x" xPos " y6 w" w " h16 c" (i = 1 ? "FFFF00" : "FFFFFF"), item)
    ctrl.SetFont("s9 bold", "Consolas")
    textControls.Push(ctrl)
    xPos += w
}

MyGui.Show("w" (xPos + 8) " h28 x50 y50 NoActivate")

; ── resize: scale all labels proportionally ───────────────────────────────────
MyGui.OnEvent("Size", OnResize)

OnResize(thisGui, minMax, newW, newH) {
    if minMax = -1  ; minimized
        return
    ; recalculate font size from window height
    fontSize := Max(6, Round(newH * 0.55))
    charW    := Round(fontSize * 0.72)
    xPos     := 8
    sepIdx   := 0
    ctrlIdx  := 0
    for i, item in ITEMS {
        if (i > 1) {
            sepIdx++
            ; separators are interleaved — find them by re-querying
        }
    }
    ; simpler: just reflow text controls with new font
    ctrlIdx := 1
    xPos    := 8
    for i, item in ITEMS {
        if (i > 1) {
            xPos += Round(charW * 1.4)   ; separator gap
        }
        w := StrLen(item) * charW + 4
        yOff := Max(2, Round((newH - fontSize * 1.4) / 2))
        textControls[ctrlIdx].Move(xPos, yOff, w, Round(fontSize * 1.4))
        textControls[ctrlIdx].SetFont("s" fontSize " bold", "Consolas")
        xPos += w
        ctrlIdx++
    }
}

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

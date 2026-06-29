import tkinter as tk
import keyboard
import threading

TEXTS = ["After M", "Before M", "After O", "Before O"]
current = [0]
labels = []
root = None


def cycle(_=None):
    current[0] = (current[0] + 1) % len(TEXTS)
    root.after(0, update_display)


def update_display():
    for i, lbl in enumerate(labels):
        lbl.config(fg="yellow" if i == current[0] else "white")


def start_drag(event):
    root._dx = event.x
    root._dy = event.y


def do_drag(event):
    x = root.winfo_x() + event.x - root._dx
    y = root.winfo_y() + event.y - root._dy
    root.geometry(f"+{x}+{y}")


def main():
    global root
    root = tk.Tk()
    root.title("Cycle Helper")
    root.configure(bg="black")
    root.attributes("-topmost", True)
    root.overrideredirect(True)
    root.geometry("130x90+50+50")
    root.resizable(False, False)

    # Thin border frame so it's visible against game backgrounds
    frame = tk.Frame(root, bg="#333333", bd=1, relief="flat")
    frame.pack(fill="both", expand=True, padx=1, pady=1)

    inner = tk.Frame(frame, bg="black")
    inner.pack(fill="both", expand=True, padx=1, pady=1)

    for text in TEXTS:
        lbl = tk.Label(inner, text=text, bg="black", fg="white",
                       font=("Consolas", 10, "bold"), anchor="w", padx=8)
        lbl.pack(fill="x", pady=1)
        labels.append(lbl)

    # Highlight first item
    labels[0].config(fg="yellow")

    # Drag to move
    for widget in (root, frame, inner, *labels):
        widget.bind("<ButtonPress-1>", start_drag)
        widget.bind("<B1-Motion>", do_drag)

    # Right-click to close
    root.bind("<ButtonPress-3>", lambda e: root.destroy())

    # Global hotkey — works even when another window is focused
    keyboard.add_hotkey("x", cycle, suppress=False)

    root.mainloop()


if __name__ == "__main__":
    main()

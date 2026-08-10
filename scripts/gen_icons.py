"""One-off script to generate PaperFlip toolbar icons. Not shipped/used at runtime."""
from PIL import Image, ImageDraw

BG = (13, 17, 23, 255)       # near-black terminal bg
GREEN = (46, 213, 115, 255)  # bullish green
GREEN_DARK = (30, 150, 80, 255)
WHITE = (230, 237, 243, 255)

def make_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = size * 0.5
    d.ellipse([0, 0, size - 1, size - 1], fill=BG)

    pad = size * 0.16
    inner = size - 2 * pad

    # simple upward candlestick chart motif: 3 bars of rising height
    bar_w = inner * 0.16
    gap = inner * 0.12
    heights = [0.35, 0.6, 0.9]
    x = pad + inner * 0.05
    for h in heights:
        bar_h = inner * h
        y0 = pad + inner - bar_h
        y1 = pad + inner
        color = GREEN if h == heights[-1] else GREEN_DARK
        d.rounded_rectangle([x, y0, x + bar_w, y1], radius=max(1, bar_w * 0.25), fill=color)
        x += bar_w + gap

    # little upward arrow accent top-right
    ax = pad + inner * 0.72
    ay = pad + inner * 0.02
    aw = inner * 0.22
    d.polygon(
        [(ax, ay + aw * 0.6), (ax + aw * 0.5, ay), (ax + aw, ay + aw * 0.6),
         (ax + aw * 0.68, ay + aw * 0.6), (ax + aw * 0.68, ay + aw),
         (ax + aw * 0.32, ay + aw), (ax + aw * 0.32, ay + aw * 0.6)],
        fill=WHITE,
    )
    return img

for size in (16, 48, 128):
    make_icon(size).save(f"/home/user/test-thing/icons/icon{size}.png")

print("done")

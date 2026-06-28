from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "icons" / "cobb" / "icons" / "system" / "key_favicon.png"
COBB_DIR = ROOT / "public" / "icons" / "cobb"
PUBLIC_DIR = ROOT / "public"


def edge_background_mask(image: Image.Image, threshold: int = 8) -> Image.Image:
    rgb = image.convert("RGB")
    width, height = rgb.size
    pixels = rgb.load()
    seen = bytearray(width * height)
    mask = Image.new("L", (width, height), 0)
    mask_pixels = mask.load()
    queue: deque[tuple[int, int]] = deque()

    def is_bg(x: int, y: int) -> bool:
        r, g, b = pixels[x, y]
        return r <= threshold and g <= threshold and b <= threshold

    for x in range(width):
        for y in (0, height - 1):
            if is_bg(x, y):
                queue.append((x, y))
    for y in range(height):
        for x in (0, width - 1):
            if is_bg(x, y):
                queue.append((x, y))

    while queue:
        x, y = queue.popleft()
        index = y * width + x
        if seen[index] or not is_bg(x, y):
            continue
        seen[index] = 1
        mask_pixels[x, y] = 255
        if x > 0:
            queue.append((x - 1, y))
        if x < width - 1:
            queue.append((x + 1, y))
        if y > 0:
            queue.append((x, y - 1))
        if y < height - 1:
            queue.append((x, y + 1))

    return mask


def transparent_source() -> Image.Image:
    image = Image.open(SOURCE).convert("RGBA")
    alpha = image.getchannel("A")
    bg_mask = edge_background_mask(image)
    alpha = Image.eval(alpha, lambda px: px)
    alpha.paste(0, mask=bg_mask)
    image.putalpha(alpha)
    bbox = alpha.getbbox()
    return image.crop(bbox) if bbox else image


def square_canvas(image: Image.Image, size: int, *, flatten: bool = False) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 255 if flatten else 0))
    working = image.copy()
    working.thumbnail((size, size), Image.Resampling.LANCZOS)
    x = (size - working.width) // 2
    y = (size - working.height) // 2
    if flatten:
        canvas.alpha_composite(working, (x, y))
        return canvas.convert("RGB")
    canvas.alpha_composite(working, (x, y))
    return canvas


def save_pngs(master: Image.Image) -> None:
    favicon_sizes = [16, 32, 48, 96, 180, 192, 512]
    pwa_sizes = [192, 384, 512, 1024]

    for size in favicon_sizes:
        square_canvas(master, size).save(COBB_DIR / f"favicon-{size}.png")

    square_canvas(master, 512).save(COBB_DIR / "favicon.png")

    for size in pwa_sizes:
        square_canvas(master, size, flatten=True).save(COBB_DIR / f"pwa-{size}.png")

    square_canvas(master, 180, flatten=True).save(COBB_DIR / "pwa-apple-180.png")

    # Common root-level fallbacks used by older browsers and static analyzers.
    square_canvas(master, 16).save(PUBLIC_DIR / "favicon-16x16.png")
    square_canvas(master, 32).save(PUBLIC_DIR / "favicon-32x32.png")
    square_canvas(master, 180, flatten=True).save(PUBLIC_DIR / "apple-touch-icon.png")
    square_canvas(master, 192, flatten=True).save(PUBLIC_DIR / "android-chrome-192x192.png")
    square_canvas(master, 512, flatten=True).save(PUBLIC_DIR / "android-chrome-512x512.png")


def save_ico(master: Image.Image) -> None:
    ico_sizes = [16, 24, 32, 48, 64]
    base = square_canvas(master, 64)
    base.save(PUBLIC_DIR / "favicon.ico", sizes=[(size, size) for size in ico_sizes])


def main() -> None:
    master = transparent_source()
    save_pngs(master)
    save_ico(master)
    print(f"Source: {SOURCE}")
    print("Generated favicon and PWA assets.")


if __name__ == "__main__":
    main()

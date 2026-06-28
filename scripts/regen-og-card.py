from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
COBB_DIR = ROOT / "public" / "icons" / "cobb"
OUT = ROOT / "public" / "og-card.png"

WIDTH = 1200
HEIGHT = 630


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


FONT_BOLD = r"C:\Windows\Fonts\arialbd.ttf"
FONT_REGULAR = r"C:\Windows\Fonts\arial.ttf"
FONT_CONDENSED = r"C:\Windows\Fonts\bahnschrift.ttf"


def cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    src = image.convert("RGBA")
    scale = max(size[0] / src.width, size[1] / src.height)
    resized = src.resize((int(src.width * scale), int(src.height * scale)), Image.Resampling.LANCZOS)
    left = (resized.width - size[0]) // 2
    top = (resized.height - size[1]) // 2
    return resized.crop((left, top, left + size[0], top + size[1]))


def rounded_rect_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255)
    return mask


def shadowed_paste(base: Image.Image, image: Image.Image, xy: tuple[int, int], blur: int = 22, offset: int = 16) -> None:
    shadow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    shadow.putalpha(image.getchannel("A").filter(ImageFilter.GaussianBlur(blur)))
    dark = Image.new("RGBA", image.size, (0, 0, 0, 150))
    dark.putalpha(shadow.getchannel("A"))
    base.alpha_composite(dark, (xy[0] + offset, xy[1] + offset))
    base.alpha_composite(image, xy)


def draw_text_with_shadow(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    text_font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int],
    shadow_fill: tuple[int, int, int, int] = (0, 0, 0, 170),
    shadow_offset: tuple[int, int] = (3, 4),
) -> None:
    sx, sy = shadow_offset
    draw.text((xy[0] + sx, xy[1] + sy), text, font=text_font, fill=shadow_fill)
    draw.text(xy, text, font=text_font, fill=fill)


def main() -> None:
    banner = cover(Image.open(COBB_DIR / "bigbanner.png"), (WIDTH, HEIGHT)).filter(ImageFilter.GaussianBlur(3))
    canvas = Image.new("RGBA", (WIDTH, HEIGHT), (5, 9, 14, 255))
    canvas.alpha_composite(banner)

    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rectangle((0, 0, WIDTH, HEIGHT), fill=(2, 8, 15, 164))
    for x in range(WIDTH):
        alpha = int(175 * (x / WIDTH))
        od.line((x, 0, x, HEIGHT), fill=(0, 0, 0, alpha))
    canvas.alpha_composite(overlay)

    draw = ImageDraw.Draw(canvas)

    # Thin blue frame, matching the new app icon.
    draw.rounded_rectangle((22, 22, WIDTH - 22, HEIGHT - 22), radius=36, outline=(64, 133, 209), width=3)
    draw.rounded_rectangle((30, 30, WIDTH - 30, HEIGHT - 30), radius=30, outline=(14, 45, 85), width=2)

    icon = Image.open(COBB_DIR / "fav2.png").convert("RGBA")
    icon = cover(icon, (430, 430))
    icon_mask = rounded_rect_mask(icon.size, 72)
    icon.putalpha(icon_mask)
    shadowed_paste(canvas, icon, (710, 98), blur=28, offset=18)

    title_font = font(FONT_CONDENSED, 78)
    title_font_2 = font(FONT_CONDENSED, 72)
    tagline_font = font(FONT_BOLD, 35)
    small_font = font(FONT_REGULAR, 25)

    draw_text_with_shadow(draw, (70, 132), "COBB", title_font, (226, 237, 246))
    draw_text_with_shadow(draw, (70, 208), "FAMILY VAULT", title_font_2, (226, 237, 246))

    draw.line((73, 315, 522, 315), fill=(189, 150, 62), width=4)
    draw_text_with_shadow(draw, (72, 344), "Family Life ... Secretly Kept", tagline_font, (232, 191, 91))

    draw.rounded_rectangle((72, 448, 548, 512), radius=14, fill=(5, 16, 27, 188), outline=(65, 112, 150), width=1)
    draw.text((98, 465), "documents  |  passwords  |  plans", font=small_font, fill=(190, 213, 224))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(OUT, quality=94, optimize=True)
    print(f"Saved {OUT}")


if __name__ == "__main__":
    main()

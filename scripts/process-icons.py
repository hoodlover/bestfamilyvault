from __future__ import annotations

import argparse
from collections import deque
import fnmatch
import json
from pathlib import Path
import re
import subprocess
import tempfile
from typing import Iterable

from PIL import Image, ImageChops, ImageFilter, ImageOps


def border_background_mask(image: Image.Image, threshold: int) -> Image.Image:
    """Return an L mask for near-background pixels connected to the image edge."""
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
        idx = y * width + x
        if seen[idx] or not is_bg(x, y):
            continue
        seen[idx] = 1
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


def rounded_alpha(size: tuple[int, int], radius: int, feather: float) -> Image.Image:
    scale = 4
    w, h = size
    mask = Image.new("L", (w * scale, h * scale), 0)
    rounded = Image.new("L", mask.size, 0)
    from PIL import ImageDraw

    draw = ImageDraw.Draw(rounded)
    draw.rounded_rectangle(
        (0, 0, w * scale - 1, h * scale - 1),
        radius=radius * scale,
        fill=255,
    )
    mask = rounded.resize(size, Image.Resampling.LANCZOS)
    if feather > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(feather))
    return mask


def trim_alpha(image: Image.Image) -> Image.Image:
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    return image.crop(bbox) if bbox else image


def process_icon(
    source: Image.Image,
    size: int,
    padding: int,
    bg_threshold: int,
    radius: int,
    feather: float,
    force_square: bool = False,
) -> Image.Image:
    image = source.convert("RGBA")

    if bg_threshold >= 0:
        bg_mask = border_background_mask(image, bg_threshold)
        alpha = image.getchannel("A")
        alpha = ImageChops.subtract(alpha, bg_mask)
        image.putalpha(alpha)

    image = trim_alpha(image)
    content_size = size - padding * 2
    if force_square:
        image = image.resize((content_size, content_size), Image.Resampling.LANCZOS)
    else:
        image.thumbnail((content_size, content_size), Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    x = (size - image.width) // 2
    y = (size - image.height) // 2
    canvas.alpha_composite(image, (x, y))

    if radius > 0:
        alpha = ImageChops.multiply(canvas.getchannel("A"), rounded_alpha(canvas.size, radius, feather))
        canvas.putalpha(alpha)

    return canvas


def iter_pngs(path: Path) -> Iterable[Path]:
    return sorted(p for p in path.iterdir() if p.suffix.lower() == ".png" and p.is_file())


def iter_images(path: Path, pattern: str = "*") -> Iterable[Path]:
    allowed = {".png", ".jpg", ".jpeg", ".webp"}
    return sorted(
        p
        for p in path.iterdir()
        if p.suffix.lower() in allowed and p.is_file() and fnmatch.fnmatch(p.name, pattern)
    )


def safe_name(value: str) -> str:
    name = value.lower().replace("&", " and ")
    name = re.sub(r"[^a-z0-9]+", "_", name).strip("_")
    return name or "sheet"


def unique_name(base: str, used: dict[str, int]) -> str:
    count = used.get(base, 0) + 1
    used[base] = count
    return base if count == 1 else f"{base}_{count}"


def split_sheet(sheet: Path, out: Path, cols: int, rows: int, cell: int, gap_x: int, gap_y: int, x: int, y: int) -> None:
    image = Image.open(sheet).convert("RGBA")
    out.mkdir(parents=True, exist_ok=True)
    index = 1
    for row in range(rows):
        for col in range(cols):
            left = x + col * (cell + gap_x)
            top = y + row * (cell + gap_y)
            crop = image.crop((left, top, left + cell, top + cell))
            crop.save(out / f"icon-{index:03}.png")
            index += 1


def detected_icon_boxes(
    sheet: Image.Image,
    threshold: int,
    min_size: int,
    max_size: int,
    min_area: int,
    crop_padding: int,
) -> list[tuple[int, int, int, int]]:
    rgb = sheet.convert("RGB")
    width, height = rgb.size
    pixels = rgb.load()
    seen = bytearray(width * height)
    boxes: list[tuple[int, int, int, int]] = []

    def is_foreground(x: int, y: int) -> bool:
        r, g, b = pixels[x, y]
        return max(r, g, b) >= threshold

    for start_y in range(height):
        for start_x in range(width):
            start_idx = start_y * width + start_x
            if seen[start_idx] or not is_foreground(start_x, start_y):
                continue

            queue: deque[tuple[int, int]] = deque([(start_x, start_y)])
            seen[start_idx] = 1
            left = right = start_x
            top = bottom = start_y
            area = 0

            while queue:
                x, y = queue.popleft()
                area += 1
                left = min(left, x)
                right = max(right, x)
                top = min(top, y)
                bottom = max(bottom, y)

                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if nx < 0 or nx >= width or ny < 0 or ny >= height:
                        continue
                    idx = ny * width + nx
                    if seen[idx] or not is_foreground(nx, ny):
                        continue
                    seen[idx] = 1
                    queue.append((nx, ny))

            box_width = right - left + 1
            box_height = bottom - top + 1
            if (
                min_size <= box_width <= max_size
                and min_size <= box_height <= max_size
                and area >= min_area
            ):
                boxes.append(
                    (
                        max(0, left - crop_padding),
                        max(0, top - crop_padding),
                        min(width, right + 1 + crop_padding),
                        min(height, bottom + 1 + crop_padding),
                    )
                )

    return sorted(boxes, key=lambda box: (box[1] // max(1, min_size // 2), box[0]))


def split_sheet_auto(
    sheet: Path,
    out: Path,
    threshold: int,
    min_size: int,
    max_size: int,
    min_area: int,
    crop_padding: int,
) -> None:
    image = Image.open(sheet).convert("RGBA")
    out.mkdir(parents=True, exist_ok=True)
    for index, box in enumerate(
        detected_icon_boxes(image, threshold, min_size, max_size, min_area, crop_padding),
        start=1,
    ):
        image.crop(box).save(out / f"icon-{index:03}.png")


def slice_sheet_to_output(
    sheet: Path,
    out: Path,
    threshold: int,
    min_size: int,
    max_size: int,
    min_area: int,
    crop_padding: int,
    size: int,
    padding: int,
    bg_threshold: int,
    radius: int,
    feather: float,
    force_square: bool,
    use_label_names: bool,
    label_height: int,
    label_gap: int,
    used_names: dict[str, int] | None = None,
    prefix: str | None = None,
) -> int:
    image = Image.open(sheet).convert("RGBA")
    boxes = detected_icon_boxes(image, threshold, min_size, max_size, min_area, crop_padding)
    out.mkdir(parents=True, exist_ok=True)
    file_prefix = safe_name(prefix or sheet.stem)
    used_names = used_names if used_names is not None else {}
    labels = ocr_labels(sheet, boxes, label_height, label_gap) if use_label_names else []

    for index, box in enumerate(boxes, start=1):
        crop = image.crop(box)
        processed = process_icon(crop, size, padding, bg_threshold, radius, feather, force_square)
        if use_label_names and index <= len(labels) and labels[index - 1]:
            name = unique_name(safe_name(labels[index - 1]), used_names)
            processed.save(out / f"{name}.png")
        else:
            processed.save(out / f"{file_prefix}-{index:03}.png")

    return len(boxes)


def ocr_labels(sheet: Path, boxes: list[tuple[int, int, int, int]], label_height: int, label_gap: int) -> list[str]:
    script = Path(__file__).with_name("ocr-icon-labels.js")
    with tempfile.TemporaryDirectory() as temp_dir:
        boxes_path = Path(temp_dir) / "boxes.json"
        labels_path = Path(temp_dir) / "labels.json"
        boxes_path.write_text(json.dumps(boxes), encoding="utf-8")
        subprocess.run(
            [
                "node",
                str(script),
                "--sheet",
                str(sheet),
                "--boxes",
                str(boxes_path),
                "--output",
                str(labels_path),
                "--label-height",
                str(label_height),
                "--label-gap",
                str(label_gap),
            ],
            check=True,
        )
        return json.loads(labels_path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Batch crop, resize, and soften PNG icon edges.")
    parser.add_argument("--input", type=Path, help="Folder of source PNG icons.")
    parser.add_argument("--sheets", type=Path, help="Folder of contact-sheet images to auto-slice.")
    parser.add_argument("--pattern", default="*", help="Filename pattern for --sheets, for example sheet[1-8].png.")
    parser.add_argument("--output", type=Path, required=True, help="Output folder.")
    parser.add_argument("--size", type=int, default=128, help="Final square icon size.")
    parser.add_argument("--padding", type=int, default=8, help="Transparent padding around each icon.")
    parser.add_argument("--bg-threshold", type=int, default=8, help="Make near-black edge-connected background transparent. Use -1 to disable.")
    parser.add_argument("--radius", type=int, default=18, help="Rounded transparent corner radius. Use 0 to disable.")
    parser.add_argument("--feather", type=float, default=1.2, help="Softness of transparent edge.")
    parser.add_argument("--force-square", action="store_true", help="Gently normalize each icon crop to square before saving.")
    parser.add_argument("--use-label-names", action="store_true", help="OCR the label under each icon and use it as the output filename.")
    parser.add_argument("--label-height", type=int, default=105, help="Pixel height of the label area under each detected icon.")
    parser.add_argument("--label-gap", type=int, default=4, help="Pixels between each icon tile and its label text.")

    parser.add_argument("--sheet", type=Path, help="Optional contact-sheet image to split first.")
    parser.add_argument("--auto", action="store_true", help="Auto-detect icon tiles in a sheet instead of using fixed grid spacing.")
    parser.add_argument("--cols", type=int, default=10)
    parser.add_argument("--rows", type=int, default=1)
    parser.add_argument("--cell", type=int, default=140)
    parser.add_argument("--gap-x", type=int, default=16)
    parser.add_argument("--gap-y", type=int, default=24)
    parser.add_argument("--x", type=int, default=0)
    parser.add_argument("--y", type=int, default=0)
    parser.add_argument("--detect-threshold", type=int, default=18, help="Brightness needed for auto sheet detection.")
    parser.add_argument("--detect-min-size", type=int, default=70, help="Smallest icon tile width/height to keep.")
    parser.add_argument("--detect-max-size", type=int, default=220, help="Largest icon tile width/height to keep.")
    parser.add_argument("--detect-min-area", type=int, default=1800, help="Smallest detected colored area to keep.")
    parser.add_argument("--crop-padding", type=int, default=6, help="Extra pixels around each auto-detected tile.")

    args = parser.parse_args()

    if args.sheets:
        total = 0
        used_names: dict[str, int] = {}
        for sheet in iter_images(args.sheets, args.pattern):
            count = slice_sheet_to_output(
                sheet,
                args.output,
                args.detect_threshold,
                args.detect_min_size,
                args.detect_max_size,
                args.detect_min_area,
                args.crop_padding,
                args.size,
                args.padding,
                args.bg_threshold,
                args.radius,
                args.feather,
                args.force_square,
                args.use_label_names,
                args.label_height,
                args.label_gap,
                used_names,
            )
            total += count
            print(f"{sheet.name}: {count} icons")
        print(f"Done: {total} icons")
        return

    source_dir = args.input
    if args.sheet:
        if args.auto:
            count = slice_sheet_to_output(
                args.sheet,
                args.output,
                args.detect_threshold,
                args.detect_min_size,
                args.detect_max_size,
                args.detect_min_area,
                args.crop_padding,
                args.size,
                args.padding,
                args.bg_threshold,
                args.radius,
                args.feather,
                args.force_square,
                args.use_label_names,
                args.label_height,
                args.label_gap,
                prefix="icon",
            )
            print(f"{args.sheet.name}: {count} icons")
            return

        source_dir = args.output / "_split"
        split_sheet(args.sheet, source_dir, args.cols, args.rows, args.cell, args.gap_x, args.gap_y, args.x, args.y)

    if not source_dir:
        parser.error("Provide --input for a folder, or --sheet to split a contact sheet.")

    args.output.mkdir(parents=True, exist_ok=True)
    for png in iter_pngs(source_dir):
        with Image.open(png) as image:
            processed = process_icon(image, args.size, args.padding, args.bg_threshold, args.radius, args.feather, args.force_square)
        processed.save(args.output / png.name)


if __name__ == "__main__":
    main()

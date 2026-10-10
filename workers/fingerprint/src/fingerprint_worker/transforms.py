"""The eight edits a reposter typically makes (docs/PRD.md#detection-approach). Used by the
phase 1 check and, in phase 3, to build the labelled evaluation set."""

import io
from typing import Callable

from PIL import Image, ImageDraw, ImageEnhance, ImageFont, ImageOps

JPEG_LOW_QUALITY = 40
CROP_FRACTION = 0.20
ROTATION_DEGREES = 10
STATUS_BAR_COLOUR = (18, 18, 18)


def _encode_jpeg(rgb_image: Image.Image, quality: int = 92) -> bytes:
    output_buffer = io.BytesIO()
    rgb_image.save(output_buffer, format="JPEG", quality=quality)
    return output_buffer.getvalue()


def resize_half(rgb_image: Image.Image) -> Image.Image:
    return rgb_image.resize((rgb_image.width // 2, rgb_image.height // 2))


def jpeg_low_quality(rgb_image: Image.Image) -> Image.Image:
    return Image.open(io.BytesIO(_encode_jpeg(rgb_image, JPEG_LOW_QUALITY))).convert("RGB")


def crop_corner(rgb_image: Image.Image) -> Image.Image:
    crop_width = int(rgb_image.width * CROP_FRACTION)
    crop_height = int(rgb_image.height * CROP_FRACTION)
    return rgb_image.crop((crop_width, crop_height, rgb_image.width, rgb_image.height))


def flip_horizontal(rgb_image: Image.Image) -> Image.Image:
    return ImageOps.mirror(rgb_image)


def warm_filter(rgb_image: Image.Image) -> Image.Image:
    contrasted_image = ImageEnhance.Contrast(rgb_image).enhance(1.3)
    red_channel, green_channel, blue_channel = contrasted_image.split()
    red_channel = red_channel.point(lambda value: min(255, int(value * 1.12)))
    blue_channel = blue_channel.point(lambda value: int(value * 0.88))
    return Image.merge("RGB", (red_channel, green_channel, blue_channel))


def phone_screenshot(rgb_image: Image.Image) -> Image.Image:
    bar_height = max(24, rgb_image.height // 12)
    framed_image = Image.new("RGB", (rgb_image.width, rgb_image.height + 2 * bar_height), STATUS_BAR_COLOUR)
    framed_image.paste(rgb_image, (0, bar_height))
    return framed_image.resize((int(framed_image.width * 0.75), int(framed_image.height * 0.75)))


def meme_caption(rgb_image: Image.Image) -> Image.Image:
    captioned_image = rgb_image.copy()
    draw = ImageDraw.Draw(captioned_image)
    font = ImageFont.load_default(size=max(18, rgb_image.height // 10))
    for caption_text, vertical_anchor in (("WHEN YOU SEE IT", "ma"), ("NOBODY ASKED", "md")):
        caption_y = int(rgb_image.height * 0.04) if vertical_anchor == "ma" else int(rgb_image.height * 0.96)
        draw.text((rgb_image.width // 2, caption_y), caption_text, font=font, fill="white",
                  stroke_width=3, stroke_fill="black", anchor=vertical_anchor)
    return captioned_image


def rotate_slightly(rgb_image: Image.Image) -> Image.Image:
    return rgb_image.rotate(ROTATION_DEGREES, expand=False, fillcolor=(0, 0, 0))


TRANSFORM_BY_NAME: dict[str, Callable[[Image.Image], Image.Image]] = {
    "resize_50": resize_half,
    "jpeg_q40": jpeg_low_quality,
    "crop_20": crop_corner,
    "flip_h": flip_horizontal,
    "filter_warm": warm_filter,
    "screenshot": phone_screenshot,
    "meme_caption": meme_caption,
    "rotate_10": rotate_slightly,
}


def apply_transform(transform_name: str, rgb_image: Image.Image) -> bytes:
    return _encode_jpeg(TRANSFORM_BY_NAME[transform_name](rgb_image))

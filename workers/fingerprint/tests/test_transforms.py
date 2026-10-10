import io

import pytest
from PIL import Image

from fingerprint_worker.fingerprinting import normalise_image
from fingerprint_worker.transforms import TRANSFORM_BY_NAME, apply_transform


@pytest.fixture
def sample_image() -> Image.Image:
    gradient_image = Image.new("RGB", (400, 300))
    gradient_image.putdata([(x % 256, y % 256, (x + y) % 256) for y in range(300) for x in range(400)])
    return gradient_image


def test_there_are_exactly_eight_transforms():
    assert len(TRANSFORM_BY_NAME) == 8


@pytest.mark.parametrize("transform_name", sorted(TRANSFORM_BY_NAME))
def test_every_transform_returns_a_decodable_jpeg(sample_image, transform_name):
    transformed_bytes = apply_transform(transform_name, sample_image)
    with Image.open(io.BytesIO(transformed_bytes)) as decoded_image:
        assert decoded_image.format == "JPEG"
        assert decoded_image.width > 0 and decoded_image.height > 0


def test_crop_removes_twenty_percent_from_each_axis(sample_image):
    assert TRANSFORM_BY_NAME["crop_20"](sample_image).size == (320, 240)


def test_normalise_caps_the_long_edge_and_converts_to_rgb():
    large_image = Image.new("RGBA", (3000, 1500))
    output_buffer = io.BytesIO()
    large_image.save(output_buffer, format="PNG")
    normalised_image = normalise_image(output_buffer.getvalue())
    assert normalised_image.mode == "RGB"
    assert max(normalised_image.size) == 1024

"""Computes the three fingerprints for one image. The ML stack is imported lazily so the
rest of the package (scoring, config, transforms) stays testable without torch."""

import io
from dataclasses import dataclass

from PIL import Image, ImageOps

from fingerprint_worker.scoring import bits_to_string

MAX_LONG_EDGE_PX = 1024
CLIP_MODEL_NAME = "ViT-B-32"
CLIP_PRETRAINED_TAG = "laion2b_s34b_b79k"


@dataclass(frozen=True)
class FingerprintDetails:
    phash_bits: str
    pdq_bits: str
    pdq_quality: int
    embedding: list[float]
    width: int
    height: int


def normalise_image(image_bytes: bytes) -> Image.Image:
    with Image.open(io.BytesIO(image_bytes)) as source_image:
        upright_image = ImageOps.exif_transpose(source_image).convert("RGB")
    upright_image.thumbnail((MAX_LONG_EDGE_PX, MAX_LONG_EDGE_PX))
    return upright_image


class Fingerprinter:
    """Holds the CLIP model; build once per process, call fingerprint() per image."""

    def __init__(self) -> None:
        import open_clip
        import torch

        self._torch = torch
        model, _, preprocess = open_clip.create_model_and_transforms(CLIP_MODEL_NAME, pretrained=CLIP_PRETRAINED_TAG)
        self._clip_model = model.eval()
        self._clip_preprocess = preprocess

    def _embed(self, rgb_image: Image.Image) -> list[float]:
        with self._torch.no_grad():
            image_tensor = self._clip_preprocess(rgb_image).unsqueeze(0)
            embedding_tensor = self._clip_model.encode_image(image_tensor)
            embedding_tensor = embedding_tensor / embedding_tensor.norm(dim=-1, keepdim=True)
        return [round(float(value), 6) for value in embedding_tensor[0].tolist()]

    def fingerprint(self, image_bytes: bytes) -> FingerprintDetails:
        import imagehash
        import numpy
        import pdqhash

        rgb_image = normalise_image(image_bytes)
        pdq_vector, pdq_quality = pdqhash.compute(numpy.asarray(rgb_image))
        return FingerprintDetails(
            phash_bits=bits_to_string(imagehash.phash(rgb_image).hash.flatten()),
            pdq_bits=bits_to_string(pdq_vector),
            pdq_quality=int(pdq_quality),
            embedding=self._embed(rgb_image),
            width=rgb_image.width,
            height=rgb_image.height,
        )

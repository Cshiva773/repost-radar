# Build context is the repo root (see docker-compose.yml)
FROM python:3.11-slim

# build-essential: pdqhash compiles a C++ extension when no wheel matches
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.7.3 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/opt/venv \
    HF_HOME=/opt/hf-cache PATH="/opt/venv/bin:$PATH"

WORKDIR /app
COPY workers/fingerprint/pyproject.toml workers/fingerprint/uv.lock ./
RUN uv sync --frozen --no-dev --extra ml --no-install-project

# Bake the CLIP weights (~600 MB) into the image so workers start without a network download
RUN python -c "import open_clip; open_clip.create_model_and_transforms('ViT-B-32', pretrained='laion2b_s34b_b79k')"
# Use only the baked weights at runtime; never call the Hugging Face Hub from a running worker
ENV HF_HUB_OFFLINE=1

COPY workers/fingerprint/src ./src
RUN uv sync --frozen --no-dev --extra ml

CMD ["python", "-m", "fingerprint_worker.main"]

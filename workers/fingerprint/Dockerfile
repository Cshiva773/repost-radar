# Build context is the repo root (see docker-compose.yml)
FROM python:3.11-slim

# build-essential: pdqhash compiles a C++ extension when no wheel matches
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.7.3 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/opt/venv

WORKDIR /app
COPY workers/fingerprint/pyproject.toml workers/fingerprint/uv.lock ./
RUN uv sync --frozen --no-dev --extra ml --no-install-project

COPY workers/fingerprint/src ./src
RUN uv sync --frozen --no-dev --extra ml

ENV PATH="/opt/venv/bin:$PATH"
CMD ["python", "-m", "fingerprint_worker.main"]

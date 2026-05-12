FROM mcr.microsoft.com/devcontainers/python:1-3.12-bookworm

# System packages: shell tooling + Playwright/Chromium runtime deps.
# The base image preconfigures a Yarn apt source whose signing key periodically
# expires, making `apt-get update` fail with NO_PUBKEY → exit 100. The Node
# devcontainer feature installs Node/npm itself, so we drop the Yarn list.
RUN rm -f /etc/apt/sources.list.d/yarn.list \
    && apt-get update && apt-get install -y --no-install-recommends \
        zsh \
        fzf \
        ripgrep \
        bat \
        curl \
        wget \
        jq \
        git \
        git-lfs \
        htop \
        libnss3 \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libcups2 \
        libdrm2 \
        libxkbcommon0 \
        libxcomposite1 \
        libxdamage1 \
        libxfixes3 \
        libxrandr2 \
        libgbm1 \
        libasound2 \
    && rm -rf /var/lib/apt/lists/*

USER vscode

# Stage the user-writable npm prefix directory. We intentionally do NOT write
# a `prefix=` line into ~/.npmrc — the Node devcontainer feature installs Node
# via nvm, and nvm refuses to set up if .npmrc carries a `prefix`/`globalconfig`.
# Instead, postCreateCommand passes `--prefix` to each `npm install -g` so the
# binaries land in this volume-backed directory.
RUN mkdir -p /home/vscode/.npm-global /home/vscode/.local/bin

ENV PATH=/home/vscode/.npm-global/bin:/home/vscode/.local/bin:${PATH} \
    PYTHONUNBUFFERED=1

# Python developer tooling, installed into the vscode user's site-packages.
RUN pip install --no-cache-dir --user \
        uv \
        pipx \
        ruff \
        black \
        mypy \
        pytest \
        ipython

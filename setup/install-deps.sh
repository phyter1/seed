#!/bin/bash
# Seed — Install missing dependencies
# Run after detect.sh identifies what's missing.
set -e

SEED_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$SEED_DIR/seed.config.json"

if [ ! -f "$CONFIG" ]; then
  echo "Run detect.sh first: bash setup/detect.sh"
  exit 1
fi

OS=$(uname -s)
ARCH=$(uname -m)

echo ""
echo "  🌱 Seed — Installing Dependencies"
echo ""

# --- Homebrew (macOS) ---
if [ "$OS" = "Darwin" ] && ! command -v brew &>/dev/null; then
  echo "[1] Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)"
fi

# --- Essential tools ---
install_if_missing() {
  if ! command -v "$1" &>/dev/null; then
    echo "Installing $1..."
    $2
  else
    echo "✓ $1 already installed"
  fi
}

# Git
install_if_missing git "
  if [ '$OS' = 'Darwin' ]; then
    xcode-select --install 2>/dev/null || true
  else
    sudo apt-get install -y git 2>/dev/null || sudo dnf install -y git 2>/dev/null
  fi
"

# Node.js via NVM
if ! command -v node &>/dev/null; then
  echo "Installing NVM + Node.js..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  nvm install 24
  nvm alias default 24
fi

# Bun
install_if_missing bun "curl -fsSL https://bun.sh/install | bash && export PATH=\$HOME/.bun/bin:\$PATH"

# Python
install_if_missing python3 "
  if [ '$OS' = 'Darwin' ]; then
    brew install python@3.11
  else
    sudo apt-get install -y python3 python3-pip 2>/dev/null || sudo dnf install -y python3 python3-pip 2>/dev/null
  fi
"

# --- Host runtimes ---
# Seed can run through any supported host runtime. Claude and Codex install cleanly via npm.
install_if_missing claude "npm install -g @anthropic-ai/claude-code"
install_if_missing codex "npm install -g @openai/codex 2>/dev/null || echo 'Codex CLI install failed (optional)'"

# Ollama
install_if_missing ollama "
  if [ '$OS' = 'Darwin' ]; then
    brew install ollama
  else
    curl -fsSL https://ollama.com/install.sh | sh
  fi
"

# Gitleaks — required for the pre-push hook to block credential leaks.
install_if_missing gitleaks "
  if [ '$OS' = 'Darwin' ]; then
    brew install gitleaks
  else
    # Download latest release binary for Linux
    GL_VER=\$(curl -sfL https://api.github.com/repos/gitleaks/gitleaks/releases/latest | grep -o '\"tag_name\": *\"[^\"]*' | cut -d'\"' -f4)
    curl -sfL \"https://github.com/gitleaks/gitleaks/releases/download/\${GL_VER}/gitleaks_\${GL_VER#v}_linux_x64.tar.gz\" | tar -xzC /tmp
    install -m 0755 /tmp/gitleaks \"\$HOME/.local/bin/gitleaks\" 2>/dev/null || sudo install -m 0755 /tmp/gitleaks /usr/local/bin/gitleaks
  fi
"

# --- MLX (Apple Silicon only) ---
if [ "$ARCH" = "arm64" ] && [ "$OS" = "Darwin" ]; then
  if ! python3 -c "import mlx_lm" 2>/dev/null; then
    echo "Installing MLX stack (Apple Silicon detected)..."
    pip3 install --break-system-packages mlx mlx-lm mlx-vlm huggingface_hub
  else
    echo "✓ MLX already installed"
  fi
fi

# Gemini packaging is not yet normalized across platforms in this script.
# Prefer installing it separately if you want Gemini as the default host.
if ! command -v gemini &>/dev/null; then
  brew install gemini-cli 2>/dev/null || echo "Gemini CLI not available via brew (optional)"
fi

# --- Oh My Zsh + Spaceship (optional, nice to have) ---
if [ ! -d "$HOME/.oh-my-zsh" ]; then
  read -p "Install Oh My Zsh + Spaceship prompt? [y/N] " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Powerline fonts
    git clone https://github.com/powerline/fonts.git /tmp/powerline-fonts --depth=1
    cd /tmp/powerline-fonts && ./install.sh && cd - >/dev/null
    rm -rf /tmp/powerline-fonts

    # Oh My Zsh
    RUNZSH=no KEEP_ZSHRC=yes sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"

    # Spaceship
    ZSH_CUSTOM="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}"
    git clone https://github.com/spaceship-prompt/spaceship-prompt.git "$ZSH_CUSTOM/themes/spaceship-prompt" --depth=1
    ln -sf "$ZSH_CUSTOM/themes/spaceship-prompt/spaceship.zsh-theme" "$ZSH_CUSTOM/themes/spaceship.zsh-theme"
  fi
fi

# --- Git hooks ---
# Point git at the repo's checked-in hooks so pre-commit / pre-push scanners
# are active for this clone. Idempotent — safe to re-run.
if [ -d "$SEED_DIR/.githooks" ] && [ -d "$SEED_DIR/.git" ]; then
  current=$(git -C "$SEED_DIR" config --get core.hooksPath || echo "")
  if [ "$current" != ".githooks" ]; then
    git -C "$SEED_DIR" config core.hooksPath .githooks
    echo "✓ git hooks enabled (core.hooksPath = .githooks)"
  else
    echo "✓ git hooks already enabled"
  fi
fi

# --- Re-run detection ---
echo ""
echo "Re-detecting environment..."
bash "$SEED_DIR/setup/detect.sh"

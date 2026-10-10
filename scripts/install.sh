#!/usr/bin/env bash
# Installs the `sdlc` command into a folder on your PATH.
#
#   ./scripts/install.sh              # standalone binary (builds it with Bun if needed)
#   ./scripts/install.sh --wrapper    # small launcher script that runs the source with Node
#   ./scripts/install.sh --uninstall  # remove the command and the PATH line
#
# Install folder: $SDLC_INSTALL_DIR, default ~/.local/bin (no sudo needed).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="${SDLC_INSTALL_DIR:-$HOME/.local/bin}"
TARGET="$INSTALL_DIR/sdlc"
MARKER="# added by sdlc-rig installer"
MODE="binary"

case "${1:-}" in
  --wrapper) MODE="wrapper" ;;
  --uninstall) MODE="uninstall" ;;
  "" ) ;;
  -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
  *) echo "Unknown option: $1 (use --wrapper, --uninstall or --help)" >&2; exit 1 ;;
esac

say() { printf '\033[1;32m[sdlc]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[sdlc]\033[0m %s\n' "$*" >&2; }

# Pick the startup file of the user's login shell.
shell_rc() {
  case "$(basename "${SHELL:-bash}")" in
    zsh) echo "$HOME/.zshrc" ;;
    bash) [ "$(uname)" = "Darwin" ] && echo "$HOME/.bash_profile" || echo "$HOME/.bashrc" ;;
    fish) echo "$HOME/.config/fish/config.fish" ;;
    *) echo "$HOME/.profile" ;;
  esac
}

path_line() {
  if [ "$(basename "${SHELL:-bash}")" = "fish" ]; then
    echo "fish_add_path $INSTALL_DIR $MARKER"
  else
    echo "export PATH=\"$INSTALL_DIR:\$PATH\" $MARKER"
  fi
}

if [ "$MODE" = "uninstall" ]; then
  rm -f "$TARGET" && say "removed $TARGET"
  RC="$(shell_rc)"
  if [ -f "$RC" ] && grep -qF "$MARKER" "$RC"; then
    grep -vF "$MARKER" "$RC" > "$RC.sdlc-tmp" && mv "$RC.sdlc-tmp" "$RC"
    say "removed the PATH line from $RC"
  fi
  exit 0
fi

mkdir -p "$INSTALL_DIR"

if [ "$MODE" = "binary" ]; then
  BIN="$ROOT/dist/sdlc"
  if [ ! -x "$BIN" ]; then
    if command -v bun >/dev/null 2>&1; then
      [ -d "$ROOT/node_modules" ] || (cd "$ROOT" && bun install)
      say "building the standalone binary with Bun..."
      (cd "$ROOT" && bun scripts/build-binary.ts)
    else
      warn "Bun is not installed, so the binary can't be built."
      warn "Install Bun (curl -fsSL https://bun.sh/install | bash) or rerun with --wrapper."
      exit 1
    fi
  fi
  cp "$BIN" "$TARGET"
  chmod +x "$TARGET"
  say "installed the binary at $TARGET"
else
  command -v node >/dev/null 2>&1 || { warn "Node.js 20+ is required for --wrapper"; exit 1; }
  [ -d "$ROOT/node_modules" ] || (cd "$ROOT" && npm install)
  cat > "$TARGET" <<EOF
#!/usr/bin/env sh
# sdlc launcher, created by sdlc-rig/scripts/install.sh
exec node "$ROOT/bin/sdlc.mjs" "\$@"
EOF
  chmod +x "$TARGET"
  say "installed a launcher at $TARGET (runs $ROOT with Node; keep that folder in place)"
fi

# Add the install folder to PATH, once.
case ":$PATH:" in
  *":$INSTALL_DIR:"*) say "$INSTALL_DIR is already on your PATH" ;;
  *)
    RC="$(shell_rc)"
    mkdir -p "$(dirname "$RC")"
    if [ -f "$RC" ] && grep -qF "$MARKER" "$RC"; then
      say "PATH line already in $RC"
    else
      printf '\n%s\n' "$(path_line)" >> "$RC"
      say "added $INSTALL_DIR to PATH in $RC"
    fi
    warn "open a new terminal, or run: source $RC"
    ;;
esac

say "check it with: sdlc --help"

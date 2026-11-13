#!/bin/bash
# Sets up a WSL Ubuntu distro to develop GaitDesk from WSL's own filesystem.
#
# Why: a checkout on a Windows drive (C:\...) reaches Docker's Linux VM through
# a slow file-sharing layer that also delivers no file events, so `next dev`
# spends most of its time reading files and the watchers have to poll. Inside
# WSL's filesystem the bind mounts are native, events work, and the frontend
# can run Turbopack, which has no polling mode. See README, "Faster on
# Windows: work inside WSL".
#
# Before running it, from Windows:
#   1. wsl --install -d Ubuntu      (then create your Linux user when asked)
#   2. Docker Desktop -> Settings -> Resources -> WSL integration -> Ubuntu on
#
# Then, inside Ubuntu, as your own user (it asks for sudo when it needs it):
#   bash /mnt/c/Users/<you>/projects/horse-show-results-app/scripts/setup-wsl.sh
#
# Safe to run again: every step checks before it acts. Override where things
# come from or go with WIN_REPO=... and DEST=...

set -euo pipefail

NODE_VERSION=24.22.1   # frontend/Dockerfile and CI pin the same Node
NVM_VERSION=v0.40.3

WIN_REPO="${WIN_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DEST="${DEST:-$HOME/projects/horse-show-results-app}"

step() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }
note() { printf '\033[0;33m   %s\033[0m\n' "$*"; }

if ! grep -qi microsoft /proc/version 2>/dev/null; then
  echo "This is for a WSL distro; /proc/version says this is not one." >&2
  exit 1
fi
# A distro whose first-launch user prompt was skipped logs in as root: the
# clone, nvm and git identity would all land in /root, and VS Code and Claude
# Code would run as root. Make the user first.
if [ "$(id -u)" -eq 0 ]; then
  cat >&2 <<'EOF'
This is running as root, so Ubuntu has no user of your own yet. As root, run:
  adduser <name> && usermod -aG sudo <name>
  printf '\n[user]\ndefault=<name>\n' >> /etc/wsl.conf
then `wsl --terminate Ubuntu` from Windows, reopen Ubuntu, and rerun this.
EOF
  exit 1
fi
if [ ! -f "$WIN_REPO/docker-compose.yml" ]; then
  echo "No GaitDesk checkout at $WIN_REPO. Set WIN_REPO=/mnt/c/... and rerun." >&2
  exit 1
fi

# Reads the Windows checkout's git config as a file: running git *in* a /mnt/c
# repo trips "dubious ownership" because the files belong to Windows.
win_git_config() { git config --file "$WIN_REPO/.git/config" "$@" 2>/dev/null || true; }

# A freshly booted distro runs Ubuntu's own apt-daily / unattended-upgrades,
# which hold the apt lock for a minute or more; apt-get then fails at once with
# "Could not get lock /var/lib/apt/lists/lock". Wait those out, and let apt
# itself wait on the dpkg lock for anything that starts in between.
apt_get() {
  local waited=0
  while pgrep -f '/usr/lib/apt/apt.systemd.daily' >/dev/null \
     || pgrep -f '/usr/bin/unattended-upgrade$' >/dev/null \
     || pgrep -x apt-get >/dev/null || pgrep -x dpkg >/dev/null; do
    [ "$waited" -eq 0 ] && note "waiting for Ubuntu's own package update to finish..."
    sleep 5; waited=$((waited + 5))
    if [ "$waited" -ge 600 ]; then
      echo "apt is still busy after 10 minutes; rerun this when it's done." >&2
      exit 1
    fi
  done
  sudo apt-get -o DPkg::Lock::Timeout=300 "$@"
}

step "Packages: git, curl"
apt_get update -qq
apt_get install -y -qq git curl ca-certificates gnupg >/dev/null

step "PowerShell (the pre-commit docs guard, migrate.ps1, release.ps1)"
# Microsoft's apt repo, where it has a package for this Ubuntu; otherwise the
# release tarball from GitHub. A new Ubuntu gets its repo months before the
# repo gets PowerShell (26.04 "resolute" had the repo and no package).
install_pwsh_tarball() {
  local ver arch icu dir=/opt/microsoft/powershell/7
  ver="$(curl -fsSL https://api.github.com/repos/PowerShell/PowerShell/releases/latest \
    | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p' | head -1)"
  case "$(dpkg --print-architecture)" in
    amd64) arch=x64 ;;
    arm64) arch=arm64 ;;
    *) echo "No PowerShell build for $(dpkg --print-architecture)." >&2; return 1 ;;
  esac
  # pwsh needs ICU, and the package is named for its version (libicu76, ...).
  icu="$(apt-cache search --names-only '^libicu[0-9]+$' | awk '{print $1}' | sort -V | tail -1)"
  if [ -n "$icu" ]; then apt_get install -y -qq "$icu" >/dev/null; fi
  sudo mkdir -p "$dir"
  curl -fsSL "https://github.com/PowerShell/PowerShell/releases/download/v${ver}/powershell-${ver}-linux-${arch}.tar.gz" \
    | sudo tar -xz -C "$dir"
  sudo chmod +x "$dir/pwsh"
  sudo ln -sf "$dir/pwsh" /usr/local/bin/pwsh
}
if command -v pwsh >/dev/null; then
  note "already installed"
else
  . /etc/os-release
  if [ ! -f /etc/apt/sources.list.d/microsoft-prod.list ] \
     && curl -fsSL "https://packages.microsoft.com/config/ubuntu/${VERSION_ID}/packages-microsoft-prod.deb" \
          -o /tmp/packages-microsoft-prod.deb 2>/dev/null; then
    sudo dpkg -i /tmp/packages-microsoft-prod.deb >/dev/null
    rm -f /tmp/packages-microsoft-prod.deb
    apt_get update -qq
  fi
  if apt-cache policy powershell 2>/dev/null | grep -q 'Candidate: [0-9]'; then
    apt_get install -y -qq powershell >/dev/null
  else
    note "no apt package for Ubuntu ${VERSION_ID}; installing the GitHub release"
    install_pwsh_tarball
  fi
fi
note "$(pwsh -NoProfile -Command '"PowerShell " + $PSVersionTable.PSVersion.ToString()')"

step "GitHub CLI"
if command -v gh >/dev/null; then
  note "already installed"
else
  sudo mkdir -p -m 755 /etc/apt/keyrings
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
  sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
  apt_get update -qq
  apt_get install -y -qq gh >/dev/null
fi

step "Node $NODE_VERSION via nvm (type-check, lint and jest run on the host)"
export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  # Without Windows' PATH: WSL appends it, and the installer then finds
  # C:\Program Files\nodejs\npm, asks it for global modules and prints an npm
  # ENOENT error about %APPDATA%\npm that is harmless but reads like a failure.
  curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VERSION/install.sh" \
    | PATH="$(printf %s "$PATH" | tr : '\n' | grep -v '^/mnt/' | paste -sd: -)" bash >/dev/null
fi
set +u  # nvm.sh is not written for nounset
. "$NVM_DIR/nvm.sh"
nvm install "$NODE_VERSION" >/dev/null
nvm alias default "$NODE_VERSION" >/dev/null
set -u
note "node $(node --version), npm $(npm --version)"

step "Git identity and credentials"
if [ -z "$(git config --global user.name || true)" ]; then
  name="$(win_git_config user.name)"; email="$(win_git_config user.email)"
  if [ -n "$name" ]; then git config --global user.name "$name"; fi
  if [ -n "$email" ]; then git config --global user.email "$email"; fi
fi
# LF in the working tree; .gitattributes still checks *.ps1 out as CRLF.
git config --global core.autocrlf input
gcm="/mnt/c/Program Files/Git/mingw64/bin/git-credential-manager.exe"
if [ -x "$gcm" ] && [ -z "$(git config --global credential.helper || true)" ]; then
  # Windows' Git Credential Manager, so a push signs in with the same GitHub
  # login as Windows instead of asking again.
  git config --global credential.helper "/mnt/c/Program\ Files/Git/mingw64/bin/git-credential-manager.exe"
fi
note "$(git config --global user.name) <$(git config --global user.email)>"

step "Clone into $DEST"
origin="$(win_git_config remote.origin.url)"
origin="${origin:-https://github.com/dhuber24/horse-show-results-app}"
# A Windows checkout cloned over SSH has a key Ubuntu doesn't; clone over HTTPS
# instead, which the credential manager above signs in to.
case "$origin" in
  git@github.com:*)          origin="https://github.com/${origin#git@github.com:}" ;;
  ssh://git@github.com/*)    origin="https://github.com/${origin#ssh://git@github.com/}" ;;
esac
if [ -d "$DEST/.git" ]; then
  note "already cloned"
else
  mkdir -p "$(dirname "$DEST")"
  git clone "$origin" "$DEST"
fi
git -C "$DEST" config core.hooksPath .githooks

if [ -n "$(git -c safe.directory="$WIN_REPO" -C "$WIN_REPO" status --porcelain 2>/dev/null || true)" ]; then
  note "The Windows checkout has uncommitted changes. The clone is of origin,"
  note "so commit and push them there (or copy them over) to have them here."
fi

step ".env"
if [ -f "$DEST/.env" ]; then
  note "already present; not overwritten"
elif [ -f "$WIN_REPO/.env" ]; then
  cp "$WIN_REPO/.env" "$DEST/.env"
  sed -i 's/\r$//' "$DEST/.env"   # CRLF from Windows would end up in values
  note "copied from the Windows checkout"
else
  cp "$DEST/.env.example" "$DEST/.env"
  note "no .env to copy: started from .env.example; fill in DATABASE_URL and the secrets"
fi
chmod 600 "$DEST/.env"
if ! grep -q '^NEXT_DEV_FLAGS=' "$DEST/.env"; then
  printf '\n# WSL checkout: real file events, so Turbopack and no polling.\nNEXT_DEV_FLAGS=--turbopack\nWATCHPACK_POLLING=false\n' >> "$DEST/.env"
  note "turned on Turbopack and turned off polling"
fi

step "Frontend dependencies for the host"
(cd "$DEST/frontend" && npm ci --no-audit --no-fund --loglevel=error)

step "Claude Code memory and user settings"
win_home="$(wslpath "$(cmd.exe /c 'echo %USERPROFILE%' 2>/dev/null | tr -d '\r')" 2>/dev/null || true)"
if [ -n "$win_home" ] && [ -d "$win_home/.claude" ]; then
  # Claude Code keys a project's memory on its path with every non-alphanumeric
  # character made a dash, so the new path starts with no memory unless copied.
  win_key="$(wslpath -w "$WIN_REPO" | sed 's/[^A-Za-z0-9]/-/g')"
  dest_key="$(printf '%s' "$DEST" | sed 's/[^A-Za-z0-9]/-/g')"
  src_mem="$(find "$win_home/.claude/projects" -maxdepth 1 -iname "$win_key" -print -quit 2>/dev/null)/memory"
  dest_mem="$HOME/.claude/projects/$dest_key/memory"
  if [ -d "$src_mem" ] && [ ! -d "$dest_mem" ]; then
    mkdir -p "$(dirname "$dest_mem")"
    cp -r "$src_mem" "$dest_mem"
    note "project memory copied"
  else
    note "project memory: nothing to copy, or already there"
  fi
  mkdir -p "$HOME/.claude"
  [ -f "$HOME/.claude/settings.json" ] || cp "$win_home/.claude/settings.json" "$HOME/.claude/" 2>/dev/null || true
  [ -d "$HOME/.claude/skills" ] || cp -r "$win_home/.claude/skills" "$HOME/.claude/" 2>/dev/null || true
else
  note "no Windows ~/.claude found; skipped"
fi

step "Docker"
if docker info >/dev/null 2>&1; then
  note "Docker Desktop is reachable from Ubuntu"
else
  note "docker is not reachable here. Docker Desktop -> Settings -> Resources ->"
  note "WSL integration -> switch Ubuntu on -> Apply, then reopen this terminal."
fi

cat <<EOF

Done. Next:

  1. Stop the stack the Windows checkout started (same container names):
       cd $WIN_REPO && docker compose down
  2. Start it from here, with fresh node_modules:
       cd $DEST && docker compose up -d --build -V
  3. Open the code in VS Code (it installs its WSL server the first time):
       code $DEST
     and sign in to Claude Code again there; gh needs 'gh auth login' once.

Work only in $DEST from now on. Opening it from Windows
(\\\\wsl\$\\...) works, but slowly; edit through VS Code's WSL window instead.
EOF

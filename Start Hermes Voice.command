#!/bin/zsh
cd -- "$(dirname -- "$0")" || exit 1
if [[ -x .venv/bin/python ]]; then
  exec .venv/bin/python scripts/launch.py
fi
printf '%s\n' 'Install the project in a Hermes-enabled environment first. See README.md.'
exit 1

# Agent Resume shell integration — reports cwd via OSC 633/7 for embedded terminals.
_ARSI_DIR=""
if [ -n "${AGENT_RESUME_SHELL_INTEGRATION:-}" ]; then
  _ARSI_DIR="$(dirname "$AGENT_RESUME_SHELL_INTEGRATION")"
elif [ -n "${BASH_SOURCE[0]:-}" ]; then
  _ARSI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

if [ -n "${ZSH_VERSION:-}" ] && [ -f "${_ARSI_DIR}/zsh.sh" ]; then
  # shellcheck source=./zsh.sh
  . "${_ARSI_DIR}/zsh.sh"
elif [ -n "${BASH_VERSION:-}" ] && [ -f "${_ARSI_DIR}/bash.sh" ]; then
  # shellcheck source=./bash.sh
  . "${_ARSI_DIR}/bash.sh"
fi
unset _ARSI_DIR
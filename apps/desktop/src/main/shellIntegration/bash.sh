__agent_resume_emit_cwd() {
  local pwd_osc
  pwd_osc="$(pwd -P 2>/dev/null || pwd)"
  printf '\033]633;P;Cwd=%s\007' "$PWD"
  printf '\033]7;file://%s\007' "$pwd_osc"
}

if [[ ":${PROMPT_COMMAND:-}:" != *":__agent_resume_emit_cwd:"* ]]; then
  PROMPT_COMMAND="__agent_resume_emit_cwd${PROMPT_COMMAND:+;}$PROMPT_COMMAND"
fi

if [[ "${__AGENT_RESUME_CD_WRAPPED:-}" != "1" ]]; then
  __agent_resume_cd() {
    builtin cd "$@" || return $?
    __agent_resume_emit_cwd
  }
  cd() {
    __agent_resume_cd "$@"
  }
  export __AGENT_RESUME_CD_WRAPPED=1
fi

__agent_resume_emit_cwd
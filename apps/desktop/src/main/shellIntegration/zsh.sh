__agent_resume_emit_cwd() {
  local pwd_osc
  pwd_osc="$(pwd -P 2>/dev/null || pwd)"
  printf '\033]633;P;Cwd=%s\007' "$PWD"
  printf '\033]7;file://%s\007' "$pwd_osc"
}

if [[ "${precmd_functions[(Ie)__agent_resume_emit_cwd]:-}" -eq 0 ]]; then
  precmd_functions+=(__agent_resume_emit_cwd)
fi
if [[ "${chpwd_functions[(Ie)__agent_resume_emit_cwd]:-}" -eq 0 ]]; then
  chpwd_functions+=(__agent_resume_emit_cwd)
fi
__agent_resume_emit_cwd
@echo off
rem Agent Resume shell integration for cmd.exe.
rem
rem cmd has no hook that runs a script before each prompt, and `echo` cannot
rem emit an ESC byte, so cwd reporting is limited to the initial directory.
rem The prompt is still normalized to `path>` (without the extra `> ` nesting
rem caused by a custom AutoRun) and the integration marker is exported so the
rem renderer and the status sensor know this pane is app-managed.
set "AGENT_RESUME_SHELL_INTEGRATION_CMD=1"
prompt $P$G

# Agent Resume shell integration — reports the working directory for embedded terminals.
#
# PowerShell has no `precmd` hook, so the `prompt` function is the equivalent:
# it runs immediately before every prompt, after the user's own profile has
# defined its prompt. The original is preserved and called at the end.
#
# `$env:AGENT_RESUME_SHELL_INTEGRATION` is set by the app; when the script is
# dot-sourced by absolute path the directory is derived from that instead.

if (-not $global:__AgentResumePromptInstalled) {
  $global:__AgentResumePromptInstalled = $true
  $global:__AgentResumeOriginalPrompt = $function:prompt

  # UTF-8 both ways: Windows PowerShell 5.1 otherwise writes the console code
  # page, which turns CJK paths and agent output into mojibake in xterm.
  try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
  } catch {
    # Older hosts can reject the assignment; the terminal still works.
  }

  function global:prompt {
    $location = $null
    try {
      $location = (Get-Location).ProviderPath
    } catch {
      # Non-filesystem providers (Registry:, Env:) have no path to report.
    }

    if ($location) {
      $esc = [char]27
      $bel = [char]7
      [Console]::Write("$esc]633;P;Cwd=$location$bel")
      try {
        $uri = ([System.Uri]$location).AbsoluteUri
        [Console]::Write("$esc]7;$uri$bel")
      } catch {
        # A malformed URI is not worth breaking the prompt over.
      }
    }

    if ($global:__AgentResumeOriginalPrompt) {
      & $global:__AgentResumeOriginalPrompt
    } elseif ($location) {
      "PS $location> "
    } else {
      "PS> "
    }
  }

  # Report the starting directory immediately, before the first prompt.
  & $global:prompt | Out-Null
}

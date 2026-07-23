$commands = @(
  "npm run check",
  "npm run frontend:check",
  "npm run test:contract",
  "npm run test:database",
  "npm run frontend:test",
  "npm run frontend:test:e2e",
  "npm run secret:scan",
  "npm run oss:verify",
  "npm run oss:sbom",
  "npm run oss:audit",
  "git diff --check"
)

Remove-Item -Path verify.log -ErrorAction SilentlyContinue

$results = @()

foreach ($cmd in $commands) {
  Write-Output ">>> RUNNING: $cmd" | Tee-Object -FilePath verify.log -Append
  
  if ($cmd.StartsWith("git ")) {
      # Use basic invocation for git
      $process = Start-Process -FilePath "git" -ArgumentList $cmd.Substring(4).Split(" ") -NoNewWindow -Wait -PassThru -RedirectStandardOutput git_out.txt -RedirectStandardError git_err.txt
      $exitCode = $process.ExitCode
      Get-Content git_out.txt, git_err.txt -ErrorAction SilentlyContinue | Tee-Object -FilePath verify.log -Append
  } else {
      # Use cmd /c for npm
      $process = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $cmd -NoNewWindow -Wait -PassThru -RedirectStandardOutput npm_out.txt -RedirectStandardError npm_err.txt
      $exitCode = $process.ExitCode
      Get-Content npm_out.txt, npm_err.txt -ErrorAction SilentlyContinue | Tee-Object -FilePath verify.log -Append
  }

  Write-Output "<<< EXIT_CODE: $exitCode" | Tee-Object -FilePath verify.log -Append
  $results += [PSCustomObject]@{ Command = $cmd; ExitCode = $exitCode }
}

Write-Output "--- SUMMARY ---" | Tee-Object -FilePath verify.log -Append
$results | Format-Table -AutoSize | Out-String | Tee-Object -FilePath verify.log -Append

$anyFailed = ($results | Where-Object { $_.ExitCode -ne 0 }).Count -gt 0
if ($anyFailed) { exit 1 } else { exit 0 }

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

$tempDir = [System.IO.Path]::GetTempPath()
$gitOut = [System.IO.Path]::Combine($tempDir, "shotgun_git_out.txt")
$gitErr = [System.IO.Path]::Combine($tempDir, "shotgun_git_err.txt")
$npmOut = [System.IO.Path]::Combine($tempDir, "shotgun_npm_out.txt")
$npmErr = [System.IO.Path]::Combine($tempDir, "shotgun_npm_err.txt")
$verifyLog = [System.IO.Path]::Combine($tempDir, "shotgun_verify.log")

Remove-Item -Path $verifyLog -ErrorAction SilentlyContinue

$results = @()

foreach ($cmd in $commands) {
  Write-Output ">>> RUNNING: $cmd" | Tee-Object -FilePath $verifyLog -Append
  
  if ($cmd.StartsWith("git ")) {
      $process = Start-Process -FilePath "git" -ArgumentList $cmd.Substring(4).Split(" ") -NoNewWindow -Wait -PassThru -RedirectStandardOutput $gitOut -RedirectStandardError $gitErr
      $exitCode = $process.ExitCode
      Get-Content $gitOut, $gitErr -ErrorAction SilentlyContinue | Tee-Object -FilePath $verifyLog -Append
  } else {
      $process = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $cmd -NoNewWindow -Wait -PassThru -RedirectStandardOutput $npmOut -RedirectStandardError $npmErr
      $exitCode = $process.ExitCode
      Get-Content $npmOut, $npmErr -ErrorAction SilentlyContinue | Tee-Object -FilePath $verifyLog -Append
  }

  Write-Output "<<< EXIT_CODE: $exitCode" | Tee-Object -FilePath $verifyLog -Append
  $results += [PSCustomObject]@{ Command = $cmd; ExitCode = $exitCode }
}

Write-Output "--- SUMMARY ---" | Tee-Object -FilePath $verifyLog -Append
$results | Format-Table -AutoSize | Out-String | Tee-Object -FilePath $verifyLog -Append

$anyFailed = ($results | Where-Object { $_.ExitCode -ne 0 }).Count -gt 0
if ($anyFailed) { exit 1 } else { exit 0 }

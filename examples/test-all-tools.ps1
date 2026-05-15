param(
    [string]$BaseUrl = "http://localhost:3000",
    [string]$Model   = "gpt-5.4-mini",
    # テスト対象ツール名を絞り込む（省略時は全ツール）
    [string[]]$Only  = @()
)

$raw = Get-Content "$PSScriptRoot\..\tools.json" -Raw
$allTools = ("{$raw}" | ConvertFrom-Json).tools

# ── ツールごとのテストプロンプト ───────────────────────────────────
# required フィールドをすべて含むよう設計
$prompts = @{
    Agent            = "Launch a subagent to summarize the word 'hello'. Use description='summary task' and prompt='summarize hello'."
    AskUserQuestion  = "Ask the user which programming language they prefer. Use a single question with options 'Python', 'TypeScript', 'Go'."
    Bash             = "Run the shell command: echo 'ant2chat tool test'"
    CronCreate       = "Schedule a cron job with cron='0 * * * *' and prompt='hourly health check'."
    CronDelete       = "Delete the cron job with id 'cron-001'."
    CronList         = "List all scheduled cron jobs."
    Edit             = "Edit the file 'test.txt', replacing old_string='hello' with new_string='world'."
    EnterPlanMode    = "Enter plan mode to begin planning."
    EnterWorktree    = "Enter a worktree named 'feature-branch'."
    ExitPlanMode     = "Exit plan mode."
    ExitWorktree     = "Exit the current worktree with action='keep'."
    Glob             = "Find all files matching pattern='src/**/*.ts'."
    Grep             = "Search for the pattern 'TODO' in TypeScript files."
    Monitor          = "Monitor the command 'npm run build'. Description='watch build', timeout_ms=30000, persistent=false."
    NotebookEdit     = "Edit the notebook at notebook_path='analysis.ipynb', adding new_source='print(42)'."
    PowerShell       = "Run the PowerShell command: Get-Date"
    PushNotification = "Send a push notification with message='Build complete' and status='success'."
    Read             = "Read the file at file_path='src/index.ts'."
    ScheduleWakeup   = "Schedule a wakeup with delaySeconds=60, reason='check build status', prompt='check build'."
    Skill            = "Invoke the skill named 'git-commit'."
    TaskCreate       = "Create a task with subject='implement login' and description='Add OAuth login flow'."
    TaskGet          = "Get the task with taskId='task-001'."
    TaskList         = "List all running background tasks."
    TaskOutput       = "Get output of task with task_id='task-001', block=false, timeout=5000."
    TaskStop         = "Stop the task with task_id='task-001'."
    TaskUpdate       = "Update the task with taskId='task-001'."
    WebFetch         = "Fetch the URL 'https://example.com' with prompt='get the page title'."
    WebSearch        = "Search the web for the query 'PowerShell REST API examples'."
    Write            = "Write content='Hello, World!' to file_path='output.txt'."
}
# ──────────────────────────────────────────────────────────────────

$targets = if ($Only.Count -gt 0) {
    $allTools | Where-Object { $_.name -in $Only }
} else {
    $allTools
}

$results = [System.Collections.Generic.List[PSCustomObject]]::new()

# モデルがネイティブ機能で処理するため tool_use ブロックが返らないことが多いツール
# (例: gpt-5.4-mini の google:search 内部実行)
$nativeTools = @("WebSearch", "WebFetch")

$passColor = "Green"
$warnColor = "Yellow"
$failColor = "Red"
$skipColor = "DarkGray"

Write-Host "`n==== ant2chat ツール全テスト ====" -ForegroundColor Cyan
Write-Host "対象: $($targets.Count) ツール  モデル: $Model  URL: $BaseUrl`n"

foreach ($tool in $targets) {
    $name   = $tool.name
    $prompt = if ($prompts.ContainsKey($name)) { $prompts[$name] } else { "Use the $name tool." }

    $body = @{
        model       = $Model
        max_tokens  = 256
        tools       = @($tool)
        tool_choice = @{ type = "tool"; name = $name }
        messages    = @(@{ role = "user"; content = $prompt })
    } | ConvertTo-Json -Depth 20

    $status   = ""
    $detail   = ""
    $toolName = ""
    $input    = ""

    try {
        $resp = Invoke-RestMethod `
            -Uri "$BaseUrl/v1/messages" `
            -Method POST `
            -Headers @{
                "Content-Type"      = "application/json"
                "x-api-key"         = "dummy"
                "anthropic-version" = "2023-06-01"
            } `
            -Body $body `
            -ErrorAction Stop

        $tu = @($resp.content | Where-Object { $_.type -eq "tool_use" })

        if ($tu.Count -gt 0) {
            $status   = "PASS"
            $toolName = $tu[0].name
            $input    = ($tu[0].input | ConvertTo-Json -Compress -Depth 5)
            if ($input.Length -gt 80) { $input = $input.Substring(0, 77) + "..." }
        } elseif ($name -in $nativeTools) {
            $status = "SKIP"
            $detail = "モデルがネイティブ機能で処理 (stop_reason=$($resp.stop_reason))"
        } else {
            $status = "WARN"
            $detail = "tool_use なし (stop_reason=$($resp.stop_reason))"
        }
    } catch {
        $status = "FAIL"
        $detail = $_.Exception.Message
        if ($detail.Length -gt 80) { $detail = $detail.Substring(0, 77) + "..." }
    }

    $color = switch ($status) {
        "PASS" { $passColor }
        "SKIP" { $skipColor }
        "WARN" { $warnColor }
        default { $failColor }
    }
    $line  = "[{0,-4}] {1,-20}" -f $status, $name
    Write-Host $line -ForegroundColor $color -NoNewline
    if ($status -eq "PASS") {
        Write-Host "  input: $input" -ForegroundColor DarkGray
    } else {
        Write-Host "  $detail" -ForegroundColor DarkGray
    }

    $results.Add([PSCustomObject]@{
        Tool   = $name
        Status = $status
        Detail = if ($status -eq "PASS") { $input } else { $detail }
    })
}

# ── サマリー ────────────────────────────────────────────────────
$pass = @($results | Where-Object { $_.Status -eq "PASS" }).Count
$warn = @($results | Where-Object { $_.Status -eq "WARN" }).Count
$skip = @($results | Where-Object { $_.Status -eq "SKIP" }).Count
$fail = @($results | Where-Object { $_.Status -eq "FAIL" }).Count

Write-Host "`n==== サマリー ====" -ForegroundColor Cyan
Write-Host "PASS: $pass  WARN: $warn  SKIP: $skip  FAIL: $fail  計: $($results.Count)" -ForegroundColor White

if ($skip -gt 0) {
    Write-Host "`n[SKIP] モデルがネイティブ機能で処理したため tool_use ブロックなし (正常)" -ForegroundColor DarkGray
}
if ($warn -gt 0) {
    Write-Host "`n[WARN] tool_use ブロックなし — モデルがツールを呼ばなかった可能性があります" -ForegroundColor Yellow
}
if ($fail -gt 0) {
    Write-Host "`n[FAIL] 詳細:" -ForegroundColor Red
    $results | Where-Object { $_.Status -eq "FAIL" } | ForEach-Object {
        Write-Host "  $($_.Tool): $($_.Detail)" -ForegroundColor Red
    }
}

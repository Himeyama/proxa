param(
    [string]$BaseUrl  = "http://localhost:3000",
    [string]$Model    = "gpt-5.4-mini",
    [string[]]$ToolNames = @("Bash", "Read")
)

$raw = Get-Content -Path "$PSScriptRoot\..\tools.json" -Raw
$tools = @(("{$raw}" | ConvertFrom-Json).tools | Where-Object { $_.name -in $ToolNames })

$commonHeaders = @{
    "Content-Type"      = "application/json"
    "x-api-key"         = "dummy"
    "anthropic-version" = "2023-06-01"
}

function Invoke-Messages([hashtable]$Body) {
    Invoke-RestMethod `
        -Uri "$BaseUrl/v1/messages" `
        -Method POST `
        -Headers $commonHeaders `
        -Body ($Body | ConvertTo-Json -Depth 20)
}

# ────────────────────────────
# ターン 1: ツール呼び出しを要求
# ────────────────────────────
Write-Host "=== ターン 1: ツール呼び出し ===" -ForegroundColor Cyan

$userMessage = @{ role = "user"; content = 'Use the Bash tool to run: echo "Hello from proxa tool flow"' }

$turn1 = Invoke-Messages @{
    model       = $Model
    max_tokens  = 512
    tools       = $tools
    tool_choice = @{ type = "any" }
    messages    = @($userMessage)
}

Write-Host "stop_reason: $($turn1.stop_reason)"

$toolUseBlocks = @($turn1.content | Where-Object { $_.type -eq "tool_use" })
if (-not $toolUseBlocks) {
    Write-Host "tool_use ブロックが返されませんでした。終了します。" -ForegroundColor Red
    exit 1
}

foreach ($b in $toolUseBlocks) {
    Write-Host "  tool : $($b.name)" -ForegroundColor Magenta
    Write-Host "  id   : $($b.id)"
    Write-Host "  input: $($b.input | ConvertTo-Json -Compress)"
}

# ────────────────────────────
# ターン 2: tool_result を返却して最終回答を取得
# ────────────────────────────
Write-Host "`n=== ターン 2: tool_result 返却 ===" -ForegroundColor Cyan

$toolResults = $toolUseBlocks | ForEach-Object {
    @{
        type        = "tool_result"
        tool_use_id = $_.id
        content     = "Hello from proxa tool flow"
    }
}

$turn2 = Invoke-Messages @{
    model      = $Model
    max_tokens = 512
    tools      = $tools
    messages   = @(
        $userMessage
        @{ role = "assistant"; content = $turn1.content }
        @{ role = "user";      content = @($toolResults) }
    )
}

Write-Host "stop_reason: $($turn2.stop_reason)"

$textBlocks = @($turn2.content | Where-Object { $_.type -eq "text" })
if ($textBlocks) {
    Write-Host "`n=== 最終レスポンス ===" -ForegroundColor Green
    foreach ($b in $textBlocks) {
        Write-Host $b.text
    }
}

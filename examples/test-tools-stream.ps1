param(
    [string]$BaseUrl  = "http://localhost:3000",
    [string]$Model    = "gpt-5.4-mini",
    [string[]]$ToolNames = @("Bash")
)

$raw = Get-Content -Path "$PSScriptRoot\..\tools.json" -Raw
$tools = @(("{$raw}" | ConvertFrom-Json).tools | Where-Object { $_.name -in $ToolNames })

Write-Host "=== ツール付きリクエスト (ストリーム) ===" -ForegroundColor Cyan
Write-Host "使用ツール: $($tools.name -join ', ')" -ForegroundColor Yellow

$body = @{
    model       = $Model
    max_tokens  = 512
    stream      = $true
    tools       = $tools
    tool_choice = @{ type = "any" }
    messages    = @(
        @{
            role    = "user"
            content = 'Use the Bash tool to run: echo "Streaming tool use test"'
        }
    )
} | ConvertTo-Json -Depth 20

$tmpFile = [System.IO.Path]::GetTempFileName()
try {
    curl.exe -s -N -X POST "$BaseUrl/v1/messages" `
        -H "Content-Type: application/json" `
        -H "x-api-key: dummy" `
        -H "anthropic-version: 2023-06-01" `
        -d $body `
        -o $tmpFile

    Write-Host "`n=== SSE イベント ===" -ForegroundColor Green

    $currentToolInput = ""
    $currentToolName  = ""

    foreach ($line in (Get-Content -Path $tmpFile)) {
        if ($line -match "^event: (.+)$") {
            $eventType = $Matches[1]
        } elseif ($line -match "^data: (.+)$") {
            $data = $Matches[1]
            try {
                $ev = $data | ConvertFrom-Json
                switch ($ev.type) {
                    "message_start" {
                        Write-Host "[message_start] id=$($ev.message.id) model=$($ev.message.model)" -ForegroundColor DarkCyan
                    }
                    "content_block_start" {
                        if ($ev.content_block.type -eq "tool_use") {
                            $currentToolName = $ev.content_block.name
                            Write-Host "[tool_use start] index=$($ev.index) name=$currentToolName id=$($ev.content_block.id)" -ForegroundColor Magenta
                            $currentToolInput = ""
                        } elseif ($ev.content_block.type -eq "text") {
                            Write-Host "[text start] index=$($ev.index)" -ForegroundColor DarkGray
                        }
                    }
                    "content_block_delta" {
                        if ($ev.delta.type -eq "input_json_delta") {
                            $currentToolInput += $ev.delta.partial_json
                            Write-Host -NoNewline $ev.delta.partial_json
                        } elseif ($ev.delta.type -eq "text_delta") {
                            Write-Host -NoNewline $ev.delta.text
                        }
                    }
                    "content_block_stop" {
                        Write-Host ""
                        if ($currentToolInput) {
                            Write-Host "[tool_use input] $currentToolInput" -ForegroundColor Yellow
                            $currentToolInput = ""
                        }
                    }
                    "message_delta" {
                        Write-Host "[message_delta] stop_reason=$($ev.delta.stop_reason) output_tokens=$($ev.usage.output_tokens)" -ForegroundColor DarkCyan
                    }
                    "message_stop" {
                        Write-Host "[message_stop]" -ForegroundColor DarkCyan
                    }
                    "ping" {
                        Write-Host "[ping]" -ForegroundColor DarkGray
                    }
                    default {
                        Write-Host "[$($ev.type)] $data" -ForegroundColor Gray
                    }
                }
            } catch {
                Write-Host "data: $data" -ForegroundColor Gray
            }
        }
    }
} finally {
    Remove-Item -Path $tmpFile -ErrorAction SilentlyContinue
}

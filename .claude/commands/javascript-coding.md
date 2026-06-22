---
name: javascript-coding
description: Node.js アプリケーションの設計原則。エラー処理・引数解析・ログ・シグナル処理など。
---

# JavaScript (Node.js) Design Guide

堅牢で保守性の高い JavaScript (Node.js) アプリケーションの設計原則。

## 基本的な安全性

### Strict Mode

ファイルの先頭に `'use strict';` を配置する：

```javascript
'use strict';

// コード...
```

- 予期しない動作を防ぐ
- グローバル変数の自動作成を禁止
- 関数呼び出しの `this` を undefined に設定

### エラーハンドリング

未処理の Promise rejection と例外をキャッチする：

```javascript
process.on('unhandledRejection', (reason, promise) => {
  log_error(`Unhandled Rejection at ${promise}: ${reason}`);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  log_error(`Uncaught Exception: ${error.message}`);
  process.exit(1);
});
```

## カラー出力の制御

ターミナル判定して、カラーを条件付きで有効にする：

```javascript
const supportsColor = process.stdout.isTTY && !process.env.NO_COLOR;

const COLORS = supportsColor ? {
  RED: '\x1b[0;31m',
  YELLOW: '\x1b[0;33m',
  GREEN: '\x1b[1;32m',
  CYAN: '\x1b[0;36m',
  CYAN_DIM: '\x1b[36m',
  GRAY: '\x1b[0;90m',
  NC: '\x1b[0m',
} : {
  RED: '',
  YELLOW: '',
  GREEN: '',
  CYAN: '',
  CYAN_DIM: '',
  GRAY: '',
  NC: '',
};
```

- `process.stdout.isTTY`: 標準出力がターミナルかどうか判定
- `process.env.NO_COLOR`: 環境変数で強制的にカラーを無効化
- パイプ経由の場合は、カラーコードが空文字列に設定される

## バージョン・ヘルプ表示

### バージョン表示

```javascript
function showVersion() {
  const pkg = require('./package.json');
  console.log(`${pkg.name} ${pkg.version}`);
}

if (process.argv[2] === '-V' || process.argv[2] === '--version') {
  showVersion();
  process.exit(0);
}
```

### ヘルプ表示

```javascript
function showHelp() {
  console.log('Command');
  console.log();
  console.log(`${COLORS.GREEN}Usage:${COLORS.NC} command [OPTIONS] <COMMAND>\n`);
  console.log(`${COLORS.GREEN}Options:${COLORS.NC}`);
  console.log(`  ${COLORS.CYAN}-v${COLORS.NC}, ${COLORS.CYAN}--verbose${COLORS.NC}          Enable verbose output`);
  console.log(`  ${COLORS.CYAN}-o${COLORS.NC}, ${COLORS.CYAN}--output${COLORS.NC} ${COLORS.CYAN_DIM}FILE${COLORS.NC}      Write output to FILE`);
  console.log(`  ${COLORS.CYAN}-h${COLORS.NC}, ${COLORS.CYAN}--help${COLORS.NC}             Show this help message`);
  console.log(`  ${COLORS.CYAN}-V${COLORS.NC}, ${COLORS.CYAN}--version${COLORS.NC}          Show version\n`);
  console.log(`${COLORS.GREEN}Commands:${COLORS.NC}`);
  console.log(`  ${COLORS.CYAN}run${COLORS.NC}                     Run a command or script`);
  console.log(`  ${COLORS.CYAN}version${COLORS.NC}                 Read or update the project's version`);
}

if (process.argv[2] === '-h' || process.argv[2] === '--help') {
  showHelp();
  process.exit(0);
}
```

### カラー分類

- **強調緑**: Options:、Commands:、Usage: などのセクション名
- **強調シアン**: オプション名（`-v`, `--verbose`）、サブコマンド
- **通常シアン**: パラメーター値（FILE など）

## エラーハンドリングとログ

### ログ設計

タイムスタンプ、ログレベル、メッセージを統一フォーマットで出力する：

```
YYYY-MM-DD HH:mm:ss [LEVEL] message
```

### ログレベル

| レベル | 用途 | 色 |
|--------|------|-----|
| ERROR  | エラー、致命的な問題 | 赤 |
| WARN   | 警告、注意が必要な状態 | 黄 |
| INFO   | 情報、重要なイベント | シアン |
| DEBUG  | デバッグ情報、詳細トレース | グレー |

### ログ出力例

```
2026-06-09 18:18:30 [INFO]  Application started
2026-06-09 18:18:31 [WARN]  Configuration validation failed
2026-06-09 18:18:32 [ERROR] Database connection timeout
2026-06-09 18:18:33 [DEBUG] Processing request id=12345
```

### ログ関数の実装

```javascript
function getTimestamp() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function log_error(message) {
  const timestamp = getTimestamp();
  console.error(`${timestamp} ${COLORS.RED}[ERROR]${COLORS.NC} ${message}`);
}

function log_warn(message) {
  const timestamp = getTimestamp();
  console.error(`${timestamp} ${COLORS.YELLOW}[WARN]${COLORS.NC}  ${message}`);
}

function log_info(message) {
  const timestamp = getTimestamp();
  console.log(`${timestamp} ${COLORS.CYAN}[INFO]${COLORS.NC}  ${message}`);
}

function log_debug(message) {
  if (!VERBOSE) return;
  const timestamp = getTimestamp();
  console.log(`${timestamp} ${COLORS.GRAY}[DEBUG]${COLORS.NC} ${message}`);
}
```

### 実装のポイント

- **タイムスタンプ**: 無色（ISO 8601形式: `YYYY-MM-DD HH:mm:ss`）
- **ログレベル部分**: `[ERROR]` など括弧内が色付き
- **固定幅**: 最長のログレベル（ERROR）を基準に位置揃え
- **出力先**: エラーメッセージは標準エラー出力（`console.error()`）、その他は標準出力（`console.log()`）

### 色付けの制御

#### 自動判定（デフォルト）

- ターミナル出力: 色付けあり
- パイプ/リダイレクト: 色付けなし（TTY 判定で自動制御）

#### 強制無効化

`NO_COLOR` 環境変数で色付けを無効化：

```bash
$ NO_COLOR=1 node script.js
```

この場合、ターミナル出力でも色が付きません。

### グレースフルシャットダウン

```javascript
let isShuttingDown = false;

async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log_info('Shutting down gracefully...');
  
  try {
    // クリーンアップ処理
    // データベース接続の切断、ファイルのフラッシュなど
    process.exit(0);
  } catch (error) {
    log_error(`Shutdown error: ${error.message}`);
    process.exit(1);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```

## 関数設計

### 関数名の命名規則

- 動詞で始める: `getValue()`, `parseConfig()`, `validateInput()`
- 実装の詳細を隠す: `fetchData()` より詳細な実装を内包
- 単一責任原則: 1 つの機能に 1 つの関数

```javascript
async function processFile(filePath) {
  const content = await readFile(filePath);
  const parsed = parseContent(content);
  const result = validateData(parsed);
  return result;
}
```

### エラー処理と戻り値

エラーは例外 throw で処理する（戻り値でエラーを返さない）：

```javascript
// 悪い
function parseConfig(path) {
  try {
    const data = readFileSync(path);
    return { success: true, data };
  } catch (error) {
    return { success: false, error };
  }
}

// 良い
function parseConfig(path) {
  try {
    const data = readFileSync(path);
    return data;
  } catch (error) {
    throw new Error(`Failed to parse config: ${error.message}`);
  }
}
```

## 引数解析

専用の関数で引数を解析し、グローバル変数に設定する：

```javascript
let VERBOSE = false;
let OUTPUT = '';
let COMMAND = '';
let ARGS = [];

function parseArguments(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    
    if (arg === '-h' || arg === '--help') {
      showHelp();
      process.exit(0);
    } else if (arg === '-V' || arg === '--version') {
      showVersion();
      process.exit(0);
    } else if (arg === '-v' || arg === '--verbose') {
      VERBOSE = true;
    } else if (arg === '-o' || arg === '--output') {
      if (i + 1 >= argv.length) {
        log_error(`Option ${arg} requires a value`);
        showHelp();
        process.exit(2);
      }
      OUTPUT = argv[++i];
    } else if (arg === '--') {
      ARGS = argv.slice(i + 1);
      break;
    } else if (arg.startsWith('-')) {
      log_error(`Unknown option: ${arg}`);
      showHelp();
      process.exit(2);
    } else {
      COMMAND = arg;
      ARGS = argv.slice(i + 1);
      break;
    }
  }
}
```

### 設計のポイント

- **グローバル変数を直接更新**: VERBOSE、OUTPUT、COMMAND をグローバル変数として定義し、parseArguments で直接更新
- **値を取るオプション**: `-o FILE` 形式で、次の引数を値として取得
- **-- の処理**: `--` 以降をすべて位置パラメーターとして扱う
- **エラー処理**: 不正なオプションや欠落した値を検出
- **短・長形式**: `-v` と `--verbose` の両方をサポート

## モジュール化

関連する機能をモジュールに分割する：

```javascript
// lib/logger.js
'use strict';

function getTimestamp() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function log_error(message) {
  const timestamp = getTimestamp();
  console.error(`${timestamp} [ERROR] ${message}`);
}

module.exports = {
  log_error,
  log_info,
  log_warn,
  log_debug,
};
```

```javascript
// index.js
'use strict';

const logger = require('./lib/logger');

logger.log_info('Application started');
```

## テンプレート

```javascript
#!/usr/bin/env node

'use strict';

// ====================
// Global Variables
// ====================

const pkg = require('./package.json');
const path = require('path');
const fs = require('fs').promises;

let VERBOSE = false;
let OUTPUT = '';
let COMMAND = '';
let ARGS = [];

// ====================
// Color codes
// ====================

const supportsColor = process.stdout.isTTY && !process.env.NO_COLOR;

const COLORS = supportsColor ? {
  RED: '\x1b[0;31m',
  YELLOW: '\x1b[0;33m',
  GREEN: '\x1b[1;32m',
  CYAN: '\x1b[0;36m',
  CYAN_DIM: '\x1b[36m',
  GRAY: '\x1b[0;90m',
  NC: '\x1b[0m',
} : {
  RED: '',
  YELLOW: '',
  GREEN: '',
  CYAN: '',
  CYAN_DIM: '',
  GRAY: '',
  NC: '',
};

// ====================
// Logging Functions
// ====================

function getTimestamp() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function log_error(message) {
  const timestamp = getTimestamp();
  console.error(`${timestamp} ${COLORS.RED}[ERROR]${COLORS.NC} ${message}`);
}

function log_warn(message) {
  const timestamp = getTimestamp();
  console.error(`${timestamp} ${COLORS.YELLOW}[WARN]${COLORS.NC}  ${message}`);
}

function log_info(message) {
  const timestamp = getTimestamp();
  console.log(`${timestamp} ${COLORS.CYAN}[INFO]${COLORS.NC}  ${message}`);
}

function log_debug(message) {
  if (!VERBOSE) return;
  const timestamp = getTimestamp();
  console.log(`${timestamp} ${COLORS.GRAY}[DEBUG]${COLORS.NC} ${message}`);
}

// ====================
// Help and Version
// ====================

function showHelp() {
  console.log('Command');
  console.log();
  console.log(`${COLORS.GREEN}Usage:${COLORS.NC} command [OPTIONS] <COMMAND>\n`);
  console.log(`${COLORS.GREEN}Options:${COLORS.NC}`);
  console.log(`  ${COLORS.CYAN}-v${COLORS.NC}, ${COLORS.CYAN}--verbose${COLORS.NC}                  Enable verbose output`);
  console.log(`  ${COLORS.CYAN}-o${COLORS.NC}, ${COLORS.CYAN}--output${COLORS.NC} ${COLORS.CYAN_DIM}FILE${COLORS.NC}            Write output to FILE`);
  console.log(`  ${COLORS.CYAN}-h${COLORS.NC}, ${COLORS.CYAN}--help${COLORS.NC}                    Show this help message`);
  console.log(`  ${COLORS.CYAN}-V${COLORS.NC}, ${COLORS.CYAN}--version${COLORS.NC}                 Show version\n`);
  console.log(`${COLORS.GREEN}Commands:${COLORS.NC}`);
  console.log(`  ${COLORS.CYAN}run${COLORS.NC}                        Run a command or script`);
  console.log(`  ${COLORS.CYAN}version${COLORS.NC}                    Read or update the project's version`);
}

function showVersion() {
  console.log(`${pkg.name} ${pkg.version}`);
}

// ====================
// Argument Parsing
// ====================

function parseArguments(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      showHelp();
      process.exit(0);
    } else if (arg === '-V' || arg === '--version') {
      showVersion();
      process.exit(0);
    } else if (arg === '-v' || arg === '--verbose') {
      VERBOSE = true;
    } else if (arg === '-o' || arg === '--output') {
      if (i + 1 >= argv.length) {
        log_error(`Option ${arg} requires a value`);
        showHelp();
        process.exit(2);
      }
      OUTPUT = argv[++i];
    } else if (arg === '--') {
      ARGS = argv.slice(i + 1);
      break;
    } else if (arg.startsWith('-')) {
      log_error(`Unknown option: ${arg}`);
      showHelp();
      process.exit(2);
    } else {
      COMMAND = arg;
      ARGS = argv.slice(i + 1);
      break;
    }
  }
}

// ====================
// Graceful Shutdown
// ====================

let isShuttingDown = false;

async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log_info('Shutting down gracefully...');

  try {
    // クリーンアップ処理
    process.exit(0);
  } catch (error) {
    log_error(`Shutdown error: ${error.message}`);
    process.exit(1);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ====================
// Error Handlers
// ====================

process.on('unhandledRejection', (reason, promise) => {
  log_error(`Unhandled Rejection: ${reason}`);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  log_error(`Uncaught Exception: ${error.message}`);
  process.exit(1);
});

// ====================
// Main
// ====================

async function main() {
  try {
    parseArguments(process.argv.slice(2));

    log_debug(`VERBOSE=${VERBOSE}, OUTPUT=${OUTPUT}, COMMAND=${COMMAND}`);

    if (!COMMAND) {
      log_error('No command specified');
      showHelp();
      process.exit(2);
    }

    switch (COMMAND) {
      case 'run':
        log_info('Running...');
        log_debug('Verbose mode enabled');
        if (OUTPUT) {
          log_debug(`Output file: ${OUTPUT}`);
        }
        break;

      case 'version':
        showVersion();
        break;

      default:
        log_error(`Unknown command: ${COMMAND}`);
        showHelp();
        process.exit(2);
    }
  } catch (error) {
    log_error(`Failed: ${error.message}`);
    process.exit(1);
  }
}

main();
```

## package.json の設定

```json
{
  "name": "command",
  "version": "1.0.0",
  "description": "A command-line tool",
  "type": "module",
  "main": "index.js",
  "bin": {
    "command": "./index.js"
  },
  "scripts": {
    "test": "node --test",
    "lint": "eslint ."
  },
  "engines": {
    "node": ">=16.0.0"
  }
}
```

## 終了コードの規約

- `0`: 成功
- `1`: 一般的なエラー（予期しない例外など）
- `2`: コマンドラインの使用法エラー（不正なオプション、欠落した値など）

```javascript
if (!COMMAND) {
  log_error('No command specified');
  showHelp();
  process.exit(2);
}
```

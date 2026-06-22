#!/usr/bin/env node

'use strict';

// ====================
// Global Variables
// ====================

const fs = require('fs');
const path = require('path');

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
  console.log('File Analyzer Tool');
  console.log();
  console.log(`${COLORS.GREEN}Usage:${COLORS.NC} example.js [OPTIONS] <COMMAND> [ARGS]\n`);
  console.log(`${COLORS.GREEN}Options:${COLORS.NC}`);
  console.log(`  ${COLORS.CYAN}-v${COLORS.NC}, ${COLORS.CYAN}--verbose${COLORS.NC}                  Enable verbose output`);
  console.log(`  ${COLORS.CYAN}-o${COLORS.NC}, ${COLORS.CYAN}--output${COLORS.NC} ${COLORS.CYAN_DIM}FILE${COLORS.NC}            Write output to FILE`);
  console.log(`  ${COLORS.CYAN}-h${COLORS.NC}, ${COLORS.CYAN}--help${COLORS.NC}                    Show this help message`);
  console.log(`  ${COLORS.CYAN}-V${COLORS.NC}, ${COLORS.CYAN}--version${COLORS.NC}                 Show version\n`);
  console.log(`${COLORS.GREEN}Commands:${COLORS.NC}`);
  console.log(`  ${COLORS.CYAN}stat${COLORS.NC} ${COLORS.CYAN_DIM}FILE${COLORS.NC}                   Display file statistics`);
  console.log(`  ${COLORS.CYAN}count${COLORS.NC} ${COLORS.CYAN_DIM}DIR${COLORS.NC}                    Count files in directory`);
  console.log(`  ${COLORS.CYAN}size${COLORS.NC} ${COLORS.CYAN_DIM}FILE${COLORS.NC}                    Calculate file size in human-readable format`);
}

function showVersion() {
  console.log('File Analyzer Tool 1.0.0');
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
// Helper Functions
// ====================

function formatFileSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

function getFileStats(filePath) {
  const stats = fs.statSync(filePath);
  return {
    path: filePath,
    size: stats.size,
    created: new Date(stats.birthtime).toISOString().slice(0, 19).replace('T', ' '),
    modified: new Date(stats.mtime).toISOString().slice(0, 19).replace('T', ' '),
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
  };
}

function countFilesInDirectory(dirPath) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const stats = {
      files: 0,
      directories: 0,
      total: entries.length,
    };

    entries.forEach((entry) => {
      if (entry.isDirectory()) {
        stats.directories++;
      } else if (entry.isFile()) {
        stats.files++;
      }
    });

    return stats;
  } catch (error) {
    throw new Error(`Failed to read directory: ${error.message}`);
  }
}

// ====================
// Commands
// ====================

function commandStat(targetPath) {
  try {
    if (!targetPath) {
      throw new Error('File path is required');
    }

    const stats = getFileStats(targetPath);
    log_info(`File: ${stats.path}`);
    console.log(`  Type: ${stats.isDirectory ? 'Directory' : 'File'}`);
    console.log(`  Size: ${formatFileSize(stats.size)} (${stats.size} bytes)`);
    console.log(`  Created: ${stats.created}`);
    console.log(`  Modified: ${stats.modified}`);

    log_debug(`Full path: ${path.resolve(targetPath)}`);

    if (OUTPUT) {
      const output = `File: ${stats.path}\nSize: ${formatFileSize(stats.size)}\nModified: ${stats.modified}\n`;
      fs.writeFileSync(OUTPUT, output);
      log_info(`Output written to ${OUTPUT}`);
    }
  } catch (error) {
    throw new Error(`stat command failed: ${error.message}`);
  }
}

function commandCount(dirPath) {
  try {
    if (!dirPath) {
      dirPath = '.';
    }

    const stats = countFilesInDirectory(dirPath);
    log_info(`Directory: ${dirPath}`);
    console.log(`  Files: ${stats.files}`);
    console.log(`  Directories: ${stats.directories}`);
    console.log(`  Total: ${stats.total}`);

    log_debug(`Directory contents scanned successfully`);

    if (OUTPUT) {
      const output = `Directory: ${dirPath}\nFiles: ${stats.files}\nDirectories: ${stats.directories}\nTotal: ${stats.total}\n`;
      fs.writeFileSync(OUTPUT, output);
      log_info(`Output written to ${OUTPUT}`);
    }
  } catch (error) {
    throw new Error(`count command failed: ${error.message}`);
  }
}

function commandSize(targetPath) {
  try {
    if (!targetPath) {
      throw new Error('File path is required');
    }

    const stats = fs.statSync(targetPath);
    const humanReadable = formatFileSize(stats.size);

    log_info(`File: ${targetPath}`);
    console.log(`  Size: ${humanReadable}`);
    console.log(`  Bytes: ${stats.size}`);

    log_debug(`Size calculation completed`);

    if (OUTPUT) {
      const output = `File: ${targetPath}\nSize: ${humanReadable} (${stats.size} bytes)\n`;
      fs.writeFileSync(OUTPUT, output);
      log_info(`Output written to ${OUTPUT}`);
    }
  } catch (error) {
    throw new Error(`size command failed: ${error.message}`);
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
      case 'stat':
        commandStat(ARGS[0]);
        break;

      case 'count':
        commandCount(ARGS[0]);
        break;

      case 'size':
        commandSize(ARGS[0]);
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

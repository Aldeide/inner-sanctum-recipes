#!/usr/bin/env node
/**
 * Guild Recipe Book SavedVariables File Watcher.
 * Monitors World of Warcraft SavedVariables/GuildRecipeBook.lua for atomic save/rename events,
 * debounces writes, checks SHA-256 payload changes, and runs unattended sync-daily.mjs in the background.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.join(ROOT, 'logs');
const LOG_FILE = path.join(LOGS_DIR, 'watcher.log');
const PID_FILE = path.join(LOGS_DIR, 'watcher.pid');

/**
 * Parses CLI arguments.
 */
function parseArgs(args) {
  const options = {
    accountRoot: 'C:\\Program Files (x86)\\World of Warcraft\\_forever_\\WTF\\Account',
    debounceMs: 3000,
    onceOnChange: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--account-root' && i + 1 < args.length) {
      options.accountRoot = path.resolve(args[++i]);
    } else if (arg.startsWith('--account-root=')) {
      options.accountRoot = path.resolve(arg.slice('--account-root='.length));
    } else if (arg === '--debounce-ms' && i + 1 < args.length) {
      options.debounceMs = parseInt(args[++i], 10) || 3000;
    } else if (arg.startsWith('--debounce-ms=')) {
      options.debounceMs = parseInt(arg.slice('--debounce-ms='.length), 10) || 3000;
    } else if (arg === '--once-on-change') {
      options.onceOnChange = true;
    }
  }

  return options;
}

const options = parseArgs(process.argv.slice(2));

/**
 * Rotating logger: keeps max 512KB, truncating to last 256KB if exceeded.
 */
function rotateLogIfNeeded() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const stats = fs.statSync(LOG_FILE);
    const MAX_SIZE = 512 * 1024;
    const KEEP_SIZE = 256 * 1024;

    if (stats.size > MAX_SIZE) {
      const fd = fs.openSync(LOG_FILE, 'r');
      const buf = Buffer.alloc(KEEP_SIZE);
      fs.readSync(fd, buf, 0, KEEP_SIZE, stats.size - KEEP_SIZE);
      fs.closeSync(fd);

      const firstNewline = buf.indexOf(10); // \n
      const trimmed = firstNewline !== -1 ? buf.subarray(firstNewline + 1) : buf;
      fs.writeFileSync(LOG_FILE, trimmed);
    }
  } catch (err) {
    console.error(`Log rotation failed: ${err.message}`);
  }
}

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const formatted = `[${ts}] ${msg}`;
  console.log(formatted);

  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    rotateLogIfNeeded();
    fs.appendFileSync(LOG_FILE, formatted + '\n', 'utf8');
  } catch (err) {
    console.error(`Failed to write to log file: ${err.message}`);
  }
}

/**
 * Single-Instance Lock via PID file.
 */
function acquireLock() {
  fs.mkdirSync(LOGS_DIR, { recursive: true });

  if (fs.existsSync(PID_FILE)) {
    try {
      const content = fs.readFileSync(PID_FILE, 'utf8').trim();
      const existingPid = parseInt(content, 10);
      if (!isNaN(existingPid)) {
        try {
          process.kill(existingPid, 0);
          log(`Watcher already running (PID ${existingPid}), exiting.`);
          process.exit(0);
        } catch {
          log(`Found stale PID file (PID ${existingPid}), overwriting.`);
        }
      }
    } catch (err) {
      log(`Warning checking PID file: ${err.message}`);
    }
  }

  fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
}

function cleanupPid() {
  try {
    if (fs.existsSync(PID_FILE)) {
      const content = fs.readFileSync(PID_FILE, 'utf8').trim();
      if (content === String(process.pid)) {
        fs.unlinkSync(PID_FILE);
      }
    }
  } catch {}
}

process.on('SIGINT', () => {
  log('Received SIGINT. Shutting down watcher.');
  cleanupPid();
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('Received SIGTERM. Shutting down watcher.');
  cleanupPid();
  process.exit(0);
});

process.on('exit', () => {
  cleanupPid();
});

/**
 * Discovers SavedVariables directories under accountRoot.
 */
function discoverSavedVariablesDirs(accountRoot) {
  const dirs = [];
  if (!fs.existsSync(accountRoot)) {
    return dirs;
  }

  // <accountRoot>/SavedVariables
  const directSV = path.join(accountRoot, 'SavedVariables');
  if (fs.existsSync(directSV)) {
    try {
      if (fs.statSync(directSV).isDirectory()) dirs.push(directSV);
    } catch {}
  }

  // <accountRoot>/*/SavedVariables
  try {
    const entries = fs.readdirSync(accountRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== 'SavedVariables') {
        const subSV = path.join(accountRoot, entry.name, 'SavedVariables');
        if (fs.existsSync(subSV)) {
          try {
            if (fs.statSync(subSV).isDirectory()) dirs.push(subSV);
          } catch {}
        }
      }
    }
  } catch (err) {
    log(`Warning discovering SavedVariables in ${accountRoot}: ${err.message}`);
  }

  return dirs;
}

/**
 * Finds all valid GuildRecipeBook.lua files across directories (size > 10).
 */
function findLuaFiles(dirs) {
  const files = [];
  for (const dir of dirs) {
    const luaPath = path.join(dir, 'GuildRecipeBook.lua');
    if (fs.existsSync(luaPath)) {
      try {
        const st = fs.statSync(luaPath);
        if (st.size > 10) {
          files.push({ path: luaPath, size: st.size, mtimeMs: st.mtimeMs });
        }
      } catch {}
    }
  }
  return files;
}

/**
 * Computes combined SHA-256 hash of all discovered GuildRecipeBook.lua contents.
 */
function computeCombinedHash(files) {
  if (!files || files.length === 0) return null;
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const hash = crypto.createHash('sha256');

  for (const item of sorted) {
    try {
      const data = fs.readFileSync(item.path);
      hash.update(item.path);
      hash.update(data);
    } catch (err) {
      log(`Error reading ${item.path} for SHA-256 hash: ${err.message}`);
      return null;
    }
  }

  return hash.digest('hex');
}

// Watcher state
const watchers = new Map(); // dir -> FSWatcher
const lastFileStats = new Map(); // filePath -> { mtimeMs, size }
let lastSyncedHash = null;
let isSyncing = false;
let resyncPending = false;
let retryTimeout = null;
let debounceTimer = null;
let activeDirs = [];

/**
 * Triggers debounced change verification.
 */
function triggerDebouncedCheck(reason) {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    handleDebouncedEvent(reason);
  }, options.debounceMs);
}

/**
 * Runs sync-daily.mjs in single-flight mode with windowsHide: true.
 */
function runSync(triggerReason, expectedHash, isChangeTriggered = false) {
  if (isSyncing) {
    resyncPending = true;
    log(`Sync currently running (${triggerReason}). Queued pending resync.`);
    return;
  }

  if (retryTimeout) {
    clearTimeout(retryTimeout);
    retryTimeout = null;
  }

  isSyncing = true;
  log(`Executing sync [reason: ${triggerReason}]...`);

  const syncScript = path.join(ROOT, 'sync-daily.mjs');
  const child = spawn(process.execPath, [syncScript], {
    cwd: ROOT,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdoutData = '';
  let stderrData = '';

  child.stdout.on('data', chunk => {
    stdoutData += chunk.toString();
  });

  child.stderr.on('data', chunk => {
    stderrData += chunk.toString();
  });

  child.on('close', code => {
    isSyncing = false;
    const combined = (stdoutData + '\n' + stderrData).trim();
    if (combined) {
      for (const line of combined.split(/\r?\n/)) {
        if (line.trim()) log(`[sync] ${line.trim()}`);
      }
    }

    if (code === 0) {
      log(`Sync finished successfully (exit code 0).`);
      if (expectedHash) {
        lastSyncedHash = expectedHash;
      } else {
        const currentFiles = findLuaFiles(activeDirs);
        lastSyncedHash = computeCombinedHash(currentFiles);
      }

      if (isChangeTriggered && options.onceOnChange) {
        log('Option --once-on-change was specified. Exiting watcher with code 0.');
        process.exit(0);
      }
    } else {
      log(`Sync exited with non-zero code ${code}. Scheduling retry in 60s...`);
      if (!retryTimeout) {
        retryTimeout = setTimeout(() => {
          retryTimeout = null;
          log('Executing 60s scheduled retry sync...');
          triggerDebouncedCheck('60s-retry');
        }, 60000);
      }
    }

    if (resyncPending) {
      resyncPending = false;
      log('Executing queued resync...');
      triggerDebouncedCheck('queued-resync');
    }
  });

  child.on('error', err => {
    isSyncing = false;
    log(`Failed to spawn sync script: ${err.message}`);
    if (!retryTimeout) {
      retryTimeout = setTimeout(() => {
        retryTimeout = null;
        triggerDebouncedCheck('retry-after-spawn-error');
      }, 60000);
    }
  });
}

/**
 * Handles debounced event: verifies files exist & size > 10, compares SHA-256.
 */
function handleDebouncedEvent(reason) {
  const files = findLuaFiles(activeDirs);
  if (files.length === 0) {
    log(`Debounce check (${reason}): No valid GuildRecipeBook.lua files found (size > 10).`);
    return;
  }

  const currentHash = computeCombinedHash(files);
  if (!currentHash) {
    log(`Debounce check (${reason}): Unable to compute hash.`);
    return;
  }

  // Update known stats
  for (const f of files) {
    lastFileStats.set(f.path, { mtimeMs: f.mtimeMs, size: f.size });
  }

  if (lastSyncedHash && currentHash === lastSyncedHash) {
    log('Save detected on GuildRecipeBook.lua (content unchanged since last sync — skipping).');
    return;
  }

  const prevShort = lastSyncedHash ? lastSyncedHash.slice(0, 8) : 'none';
  const currShort = currentHash.slice(0, 8);
  log(`Save detected on GuildRecipeBook.lua (hash changed: ${prevShort} -> ${currShort}). Triggering sync...`);
  runSync(reason, currentHash, true);
}

/**
 * Updates directory watchers.
 */
function updateWatchers(accountRoot) {
  const currentDirs = discoverSavedVariablesDirs(accountRoot);
  const currentDirSet = new Set(currentDirs);

  // Close watchers for removed dirs
  for (const [dir, watcher] of watchers) {
    if (!currentDirSet.has(dir)) {
      try { watcher.close(); } catch {}
      watchers.delete(dir);
      log(`Stopped watching removed directory: ${dir}`);
    }
  }

  // Add watchers for new dirs
  for (const dir of currentDirs) {
    if (!watchers.has(dir)) {
      try {
        const watcher = fs.watch(dir, (eventType, filename) => {
          // WoW writes GuildRecipeBook.lua.new and renames it to GuildRecipeBook.lua!
          if (!filename || /^GuildRecipeBook\.lua/i.test(filename)) {
            triggerDebouncedCheck(`fs.watch ${eventType} on ${filename || 'SavedVariables'}`);
          }
        });
        watcher.on('error', err => {
          log(`Watcher error on ${dir}: ${err.message}`);
        });
        watchers.set(dir, watcher);
        log(`Watching SavedVariables directory: ${dir}`);
      } catch (err) {
        log(`Failed to watch directory ${dir}: ${err.message}`);
      }
    }
  }

  return currentDirs;
}

/**
 * 15-second polling fallback to detect changes if Windows drops an fs.watch event.
 */
function checkStatsFallback(dirs) {
  for (const dir of dirs) {
    const luaPath = path.join(dir, 'GuildRecipeBook.lua');
    try {
      if (fs.existsSync(luaPath)) {
        const st = fs.statSync(luaPath);
        if (st.size > 10) {
          const prev = lastFileStats.get(luaPath);
          if (!prev || prev.mtimeMs !== st.mtimeMs || prev.size !== st.size) {
            lastFileStats.set(luaPath, { mtimeMs: st.mtimeMs, size: st.size });
            if (prev) {
              triggerDebouncedCheck(`stat fallback detected change on ${luaPath}`);
            }
          }
        }
      }
    } catch {}
  }
}

/**
 * Main entry point.
 */
function main() {
  acquireLock();

  log(`GuildRecipeBook watcher started (PID: ${process.pid})`);
  log(`Account root: "${options.accountRoot}"`);
  log(`Debounce duration: ${options.debounceMs}ms`);

  activeDirs = updateWatchers(options.accountRoot);
  if (activeDirs.length === 0) {
    log(`Notice: No SavedVariables directories discovered yet under "${options.accountRoot}". Will re-scan every 60s.`);
  }

  // Periodic directory discovery (every 60s)
  setInterval(() => {
    activeDirs = updateWatchers(options.accountRoot);
  }, 60000);

  // Periodic stat fallback check (every 15s)
  setInterval(() => {
    checkStatsFallback(activeDirs);
  }, 15000);

  // Initial sync check on startup (4000ms delay, or 200ms if --once-on-change)
  const startupDelay = options.onceOnChange ? 200 : 4000;
  log(`Scheduling initial startup sync check in ${startupDelay}ms...`);

  setTimeout(() => {
    log('Performing initial startup sync check...');
    const files = findLuaFiles(activeDirs);
    for (const f of files) {
      lastFileStats.set(f.path, { mtimeMs: f.mtimeMs, size: f.size });
    }
    const currentHash = computeCombinedHash(files);
    runSync('startup-initial-sync', currentHash, false);
  }, startupDelay);
}

main();

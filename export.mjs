#!/usr/bin/env node
/**
 * Guild Recipe Book Web Exporter & Server.
 * Parses WoW SavedVariables/GuildRecipeBook.lua, merges multiple databases,
 * enriches recipes via WarcraftDB API & cache, and produces dist/recipes.json and dist/index.html.
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { parseLuaSavedVariables, mergeRawDatabases, transformGuildRecipeBook, createBrowserParserBundle, isProfessionExcluded } from './src/lua-parser.mjs';
import { enrichRecipes } from './src/enrich.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MIME types for built-in HTTP server
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

/**
 * Parses CLI arguments.
 */
function parseArgs(args) {
  const options = {
    inputs: [],
    outDir: path.resolve(__dirname, 'dist'),
    cachePath: path.resolve(__dirname, 'cache', 'warcraftdb.json'),
    templatePath: path.resolve(__dirname, 'src', 'template.html'),
    offline: false,
    refreshCache: false,
    watch: false,
    serve: false,
    port: 8080,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--input' || arg === '-i') {
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        options.inputs.push(path.resolve(process.cwd(), args[++i]));
      }
    } else if (arg === '--out' || arg === '-o') {
      if (i + 1 < args.length) {
        options.outDir = path.resolve(process.cwd(), args[++i]);
      }
    } else if (arg === '--cache') {
      if (i + 1 < args.length) {
        options.cachePath = path.resolve(process.cwd(), args[++i]);
      }
    } else if (arg === '--template') {
      if (i + 1 < args.length) {
        options.templatePath = path.resolve(process.cwd(), args[++i]);
      }
    } else if (arg === '--offline') {
      options.offline = true;
    } else if (arg === '--refresh-cache') {
      options.refreshCache = true;
    } else if (arg === '--watch' || arg === '-w') {
      options.watch = true;
    } else if (arg === '--serve' || arg === '-s') {
      options.serve = true;
    } else if (arg === '--port' || arg === '-p') {
      if (i + 1 < args.length) {
        options.port = parseInt(args[++i], 10) || 8080;
      }
    } else if (!arg.startsWith('-')) {
      // Positional argument treated as input file
      options.inputs.push(path.resolve(process.cwd(), arg));
    }
  }

  return options;
}

/**
 * Displays help message.
 */
function showHelp() {
  console.log(`
Guild Recipe Book Web Exporter & Server

Usage:
  node export.mjs [options] [lua-files...]

Options:
  -i, --input <file>     Path to GuildRecipeBook.lua (repeatable for multiple accounts)
  -o, --out <dir>        Output directory for build artifacts (default: ./dist)
  --offline              Skip external WarcraftDB API calls, use local cache only
  --refresh-cache        Force re-fetching metadata for all recipes from WarcraftDB
  -w, --watch            Watch SavedVariables files and auto-re-export on change /reload
  -s, --serve            Start local static HTTP server for dist/
  -p, --port <number>    Port for HTTP server (default: 8080)
  -h, --help             Show this help message

Examples:
  node export.mjs
  node export.mjs --watch
  node export.mjs --serve
  node export.mjs --input "C:/World of Warcraft/WTF/Account/.../GuildRecipeBook.lua"
`);
}

/**
 * Auto-discovers GuildRecipeBook.lua files across standard WoW installation paths.
 */
export function discoverLuaFiles() {
  const discovered = [];
  const baseDirs = [
    'C:\\Program Files (x86)\\World of Warcraft\\_forever_\\WTF\\Account',
    'C:\\World of Warcraft\\_forever_\\WTF\\Account',
    'D:\\World of Warcraft\\_forever_\\WTF\\Account',
    path.resolve(__dirname, 'SavedVariables'),
    path.resolve(process.cwd(), 'SavedVariables'),
    __dirname,
    process.cwd()
  ];

  for (const base of baseDirs) {
    if (!fs.existsSync(base)) continue;

    try {
      if (base.endsWith('Account')) {
        const entries = fs.readdirSync(base, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name !== 'SavedVariables') {
            const luaPath = path.join(base, entry.name, 'SavedVariables', 'GuildRecipeBook.lua');
            if (fs.existsSync(luaPath)) {
              discovered.push(luaPath);
            }
          }
        }
      } else {
        const directFile = path.join(base, 'GuildRecipeBook.lua');
        if (fs.existsSync(directFile)) {
          discovered.push(directFile);
        }
      }
    } catch {
      // Ignore read permission errors
    }
  }

  return [...new Set(discovered)];
}

/**
 * Core export workflow: reads Lua files, parses, enriches, writes dist/recipes.json and dist/index.html.
 */
export async function runExport(options) {
  const startTime = Date.now();
  console.log('[Export] Starting Guild Recipe Book Web export...');

  // Ensure output directory exists
  if (!fs.existsSync(options.outDir)) {
    fs.mkdirSync(options.outDir, { recursive: true });
  }

  // 1. Resolve input files
  let inputFiles = [...options.inputs];
  if (inputFiles.length === 0) {
    inputFiles = discoverLuaFiles();
  }

  if (inputFiles.length === 0) {
    console.error('[Export] Error: No GuildRecipeBook.lua file found!');
    console.error('  Please pass file path with --input <path> or place GuildRecipeBook.lua in current directory.');
    return { success: false, reason: 'NO_INPUT_FILES' };
  }

  console.log(`[Export] Discovered ${inputFiles.length} SavedVariables file(s):`);
  for (const f of inputFiles) {
    console.log(`  - ${f}`);
  }

  // 2. Parse Lua files
  const rawDbs = [];
  for (const filePath of inputFiles) {
    if (!fs.existsSync(filePath)) {
      console.warn(`[Export] Warning: file does not exist: ${filePath}`);
      continue;
    }
    try {
      const luaSource = fs.readFileSync(filePath, 'utf8');
      const parsed = parseLuaSavedVariables(luaSource);
      if (parsed.GuildRecipeBookDB) {
        rawDbs.push(parsed.GuildRecipeBookDB);
      } else if (parsed.guilds || parsed.recipes) {
        rawDbs.push(parsed);
      } else {
        console.warn(`[Export] Warning: ${filePath} did not contain GuildRecipeBookDB`);
      }
    } catch (err) {
      console.error(`[Export] Error parsing ${filePath}: ${err.message}`);
    }
  }

  if (rawDbs.length === 0) {
    console.error('[Export] Error: No valid GuildRecipeBook databases could be parsed.');
    return { success: false, reason: 'PARSE_FAILED' };
  }

  // 3. Merge databases if multiple
  const mergedDb = rawDbs.length === 1 ? rawDbs[0] : mergeRawDatabases(rawDbs);

  // 4. Transform into normalized structure
  const transformed = transformGuildRecipeBook(mergedDb);

  // Collect all unique recipes across all guilds for enrichment
  const allRecipesMap = new Map();
  for (const guild of transformed.guilds) {
    for (const rec of guild.recipes) {
      if (!allRecipesMap.has(rec.spellId)) {
        allRecipesMap.set(rec.spellId, rec);
      }
    }
  }

  // Also include recipes present in rawDb.recipes even if not currently known by active crafter
  if (mergedDb.recipes) {
    for (const [spellIdStr, recInfo] of Object.entries(mergedDb.recipes)) {
      const spellId = Number(spellIdStr);
      const profId = Number(recInfo.prof || 0);
      const profName = recInfo.profName || '';
      if (isProfessionExcluded(profId, profName)) {
        continue;
      }
      if (!allRecipesMap.has(spellId)) {
        allRecipesMap.set(spellId, {
          spellId,
          name: recInfo.name || `Recipe #${spellId}`,
          itemId: recInfo.item != null ? Number(recInfo.item) : null,
          profId
        });
      }
    }
  }

  const recipeList = Array.from(allRecipesMap.values());
  console.log(`[Export] Parsed ${transformed.guilds.length} guild(s) and ${recipeList.length} unique recipe(s).`);

  // 5. Enrich recipes via WarcraftDB
  const meta = await enrichRecipes(recipeList, {
    cachePath: options.cachePath,
    offline: options.offline,
    refreshCache: options.refreshCache
  });

  // Ensure all tooltipHtml links point to Wowhead Classic
  if (meta) {
    for (const key of Object.keys(meta)) {
      if (meta[key] && meta[key].tooltipHtml) {
        meta[key].tooltipHtml = meta[key].tooltipHtml
          .replace(/href="https:\/\/forever\.warcraftdb\.com\/data\/items?\/(\d+)[^"]*"/gi, 'href="https://www.wowhead.com/classic/item=$1"')
          .replace(/href="https:\/\/forever\.warcraftdb\.com\/data\/spells?\/(\d+)[^"]*"/gi, 'href="https://www.wowhead.com/classic/spell=$1"')
          .replace(/href="\/data\/items?\/(\d+)[^"]*"/gi, 'href="https://www.wowhead.com/classic/item=$1"')
          .replace(/href="\/data\/spells?\/(\d+)[^"]*"/gi, 'href="https://www.wowhead.com/classic/spell=$1"')
          .replace(/https:\/\/forever\.warcraftdb\.com\/data\/items?\/(\d+)/gi, 'https://www.wowhead.com/classic/item=$1')
          .replace(/https:\/\/forever\.warcraftdb\.com\/data\/spells?\/(\d+)/gi, 'https://www.wowhead.com/classic/spell=$1');
      }
    }
  }

  // 6. Build final payload
  const payload = {
    exportedAt: new Date().toISOString(),
    schema: 1,
    guilds: transformed.guilds,
    meta
  };

  // 7. Write dist/recipes.json
  const recipesJsonPath = path.join(options.outDir, 'recipes.json');
  fs.writeFileSync(recipesJsonPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`[Export] Written: ${recipesJsonPath} (${(fs.statSync(recipesJsonPath).size / 1024).toFixed(1)} KB)`);

  // 8. Handle template and dist/index.html
  const templatePath = options.templatePath;
  const indexHtmlPath = path.join(options.outDir, 'index.html');

  if (fs.existsSync(templatePath)) {
    try {
      const templateContent = fs.readFileSync(templatePath, 'utf8');
      const browserParserBundle = createBrowserParserBundle();
      const safeJson = JSON.stringify(payload).replace(/<\//g, '<\\/');

      // Use function replacers to prevent '$' character corruption in template strings
      const htmlOutput = templateContent
        .replaceAll('/*__GRB_PARSER_SCRIPT__*/', () => browserParserBundle)
        .replace('/*__GRB_DATA_JSON__*/null', () => safeJson);

      fs.writeFileSync(indexHtmlPath, htmlOutput, 'utf8');
      console.log(`[Export] Written: ${indexHtmlPath} (${(fs.statSync(indexHtmlPath).size / 1024).toFixed(1)} KB)`);
    } catch (err) {
      console.error(`[Export] Error assembling index.html from ${templatePath}: ${err.message}`);
    }
  } else {
    console.log(`[Export] Notice: ${templatePath} not found yet. dist/recipes.json generated successfully.`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`[Export] Export completed successfully in ${elapsed}s!`);

  return {
    success: true,
    guildCount: transformed.guilds.length,
    recipeCount: recipeList.length,
    inputFiles,
    payload
  };
}

/**
 * Starts a static HTTP server to serve the dist directory.
 */
export function startServer(distDir, requestedPort = 8080) {
  let port = requestedPort;
  const normalizedDist = path.resolve(distDir);

  const server = http.createServer((req, res) => {
    // Parse URL path and normalize
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname = decodeURIComponent(parsedUrl.pathname);

    if (pathname === '/' || pathname === '') {
      pathname = '/index.html';
    }

    const safePath = pathname.replace(/^([/\\])+/, '');
    const filePath = path.resolve(normalizedDist, safePath);

    // Prevent directory traversal
    if (!filePath.startsWith(normalizedDist)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`404 Not Found: ${pathname}`);
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stats.size,
        'Cache-Control': 'no-cache'
      });

      const readStream = fs.createReadStream(filePath);
      readStream.pipe(res);
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[Server] Port ${port} is in use, trying port ${port + 1}...`);
      port++;
      server.listen(port);
    } else {
      console.error(`[Server] Server error: ${err.message}`);
    }
  });

  server.listen(port, () => {
    console.log(`\n======================================================`);
    console.log(`  Guild Recipe Book Web Server running!`);
    console.log(`  Local URL: http://localhost:${port}`);
    console.log(`======================================================\n`);
  });

  return server;
}

/**
 * Sets up file watchers for SavedVariables and template files with 500ms debounce.
 */
export function startWatcher(options, filesToWatch) {
  console.log('[Watch] Watching files for changes (auto-export on /reload or logout)...');
  for (const f of filesToWatch) {
    console.log(`  Watching: ${f}`);
  }

  let debounceTimer = null;
  let isExporting = false;

  const triggerExport = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      if (isExporting) return;
      isExporting = true;
      try {
        console.log('\n[Watch] Change detected! Re-exporting...');
        await runExport(options);
      } catch (err) {
        console.error(`[Watch] Export error: ${err.message}`);
      } finally {
        isExporting = false;
      }
    }, 500);
  };

  // Watch directories containing input files (handles atomic replace by WoW)
  const watchedDirs = new Set();
  for (const f of filesToWatch) {
    if (fs.existsSync(f)) {
      const dir = path.dirname(f);
      if (!watchedDirs.has(dir)) {
        watchedDirs.add(dir);
        try {
          fs.watch(dir, (eventType, filename) => {
            if (!filename || filename.toLowerCase().includes('guildrecipebook') || filename.toLowerCase().endsWith('.lua')) {
              triggerExport();
            }
          });
        } catch {
          // Fallback to polling watchFile
          fs.watchFile(f, { interval: 1000 }, triggerExport);
        }
      }
    }
  }

  // Also watch template.html if it exists or when created
  const templateDir = path.dirname(options.templatePath);
  if (fs.existsSync(templateDir)) {
    try {
      fs.watch(templateDir, (eventType, filename) => {
        if (filename && filename.toLowerCase().includes('template')) {
          triggerExport();
        }
      });
    } catch {}
  }
}

/**
 * Main CLI entry point.
 */
async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    showHelp();
    return;
  }

  const result = await runExport(options);

  if (!result.success) {
    process.exitCode = 1;
    return;
  }

  if (options.serve) {
    startServer(options.outDir, options.port);
  }

  if (options.watch) {
    const filesToWatch = result.inputFiles && result.inputFiles.length > 0 ? result.inputFiles : discoverLuaFiles();
    startWatcher(options, filesToWatch);
  }
}

// Execute if run directly from CLI
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch((err) => {
    console.error(`[Export] Fatal error: ${err.stack || err.message}`);
    process.exitCode = 1;
  });
}

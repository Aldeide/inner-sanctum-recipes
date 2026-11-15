# Inner Sanctum — Guild Recipe Book 📖⚔️

[![GitHub Pages Deployment](https://img.shields.io/badge/Live%20Book-Inner%20Sanctum-ffd100?style=for-the-badge&logo=github)](https://aldeide.github.io/inner-sanctum-recipes/)

- **Live URL**: [https://aldeide.github.io/inner-sanctum-recipes/](https://aldeide.github.io/inner-sanctum-recipes/)
- **Repository**: [https://github.com/Aldeide/inner-sanctum-recipes](https://github.com/Aldeide/inner-sanctum-recipes)

A fast, lightweight, standalone web viewer and exporter for the World of Warcraft **GuildRecipeBook** addon. View all guild crafters, professions, recipes, reagents, and item tooltips in a modern searchable web interface.

- **Zero NPM Dependencies**: Pure modern JavaScript ES modules using Node built-ins (`fs`, `path`, `http`, `fetch`).
- **Instant Auto-Discovery**: Automatically finds your `GuildRecipeBook.lua` from your WoW installation.
- **WarcraftDB Enrichment**: Enriches recipes with official tooltips, qualities, equipment slots, icons, and reagents.
- **Persistent Cache**: Recipes are cached locally in `cache/warcraftdb.json` so exports finish in 0.02s!
- **Dual Runtime**: The Lua parser runs identically in Node.js and directly inside the web browser for drag-and-drop `.lua` file loading!

---

## ⚡ Quick Start

### Option A: 1-Click Batch (Windows)
Double-click **`Export-Recipes.bat`**.  
It will automatically:
1. Locate your WoW `GuildRecipeBook.lua` SavedVariables file.
2. Parse and enrich all recipes.
3. Generate `dist/recipes.json` and `dist/index.html`.
4. Open the recipe book in your default browser.

### Option B: Command Line
```bash
# Basic export (auto-discovers your WoW SavedVariables)
node export.mjs

# Or specify a custom input file
node export.mjs --input "path/to/GuildRecipeBook.lua"

# Or use npm scripts
npm run export
```

---

## 🔄 Live Watch Mode (While Playing WoW)

Double-click **`Watch-Recipes.bat`** or run:
```bash
node export.mjs --watch
```
Leave the terminal open while you play World of Warcraft. Whenever you type `/reload` or log out, WoW writes your updated `GuildRecipeBook.lua` to disk, and the exporter will **automatically re-export** in under 0.05 seconds!

---

## 🌐 Local Web Server

To preview the exported site over HTTP (useful for testing on local network or mobile):
```bash
node export.mjs --serve
# Or combine with watch mode:
node export.mjs --watch --serve
```
Access the web viewer at `http://localhost:8080`.

---

## 🖱️ In-Browser Drag-and-Drop (.lua Upload)

No Node.js or backend required!
1. Open `dist/index.html` in any modern web browser.
2. Drag and drop any `GuildRecipeBook.lua` file directly onto the browser window.
3. The built-in client-side parser parses the file instantly in memory and renders all recipes, crafters, and professions.

---

## ☁️ Free Hosting Guides

Share your guild's recipe book with all guild members using any of these free static web hosting services:

### 1. GitHub Pages (Automated CI/CD Included)
A pre-configured GitHub Actions workflow is included at `.github/workflows/deploy-pages.yml`:
1. Push this repository to GitHub.
2. In your GitHub repository, go to **Settings > Pages**.
3. Under **Build and deployment > Source**, select **GitHub Actions**.
4. Whenever you push changes or commit your updated `GuildRecipeBook.lua`, your recipe book deploys automatically!

### 2. Cloudflare Pages (100% Free, Instant)
1. Go to [Cloudflare Dashboard > Pages](https://dash.cloudflare.com/).
2. Click **Create a project > Direct Upload**.
3. Drag and drop the `dist/` folder.
4. Your guild recipe book is live on a custom `*.pages.dev` domain in seconds with global CDN and DDoS protection.

### 3. Netlify Drop
1. Visit [app.netlify.com/drop](https://app.netlify.com/drop).
2. Drag and drop the `dist/` folder into the drop zone.
3. Get an instant live URL to share with your guild on Discord.

### 4. Discord / Guild Website
Upload `dist/index.html` to any web host, Discord web server, or shared guild drive. Because `dist/index.html` is self-contained, it can be viewed offline or online anywhere!

---

## 🛠️ CLI Reference

```
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
  -h, --help             Show help message
```

---

## 📂 Project Structure

```
GuildRecipeBookWeb/
├── .github/workflows/
│   └── deploy-pages.yml    # GitHub Pages automated deployment workflow
├── cache/
│   └── warcraftdb.json     # Persistent tooltip & recipe metadata cache
├── dist/
│   ├── index.html          # Self-contained web viewer (generated)
│   └── recipes.json        # Normalized JSON database of guild recipes
├── src/
│   ├── lua-parser.mjs      # Zero-dependency Lua tokenizer & parser (Node + Browser)
│   ├── enrich.mjs          # WarcraftDB concurrency pool & metadata extractor
│   └── template.html       # Web application UI template
├── export.mjs              # CLI exporter, watcher, and static HTTP server
├── Export-Recipes.bat      # 1-click export shortcut for Windows
├── Watch-Recipes.bat       # 1-click live watch mode shortcut for Windows
├── package.json            # Project definition & scripts (zero dependencies)
├── .gitignore              # Git ignore rules
└── README.md               # Documentation
```

---

## 📜 License
MIT License. Created for the World of Warcraft guild community.

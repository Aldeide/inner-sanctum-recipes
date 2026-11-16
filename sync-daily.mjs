#!/usr/bin/env node
/**
 * Daily Unattended Recipe Sync Script.
 * Pulls latest origin/main, runs export.mjs, deep-compares recipes & metadata to detect changes,
 * discards timestamp-only churn if identical, or commits and pushes updates to origin main.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * Computes a concise human-readable diff summary between previous and next recipe data.
 */
function computeDiffSummary(prev, next, force = false) {
  if (!prev) {
    const recipeCount = new Set((next.guilds || []).flatMap(g => (g.recipes || []).map(r => r.spellId))).size;
    return `initial export (${recipeCount} recipes)`;
  }

  const prevRecipes = new Map();
  for (const g of prev.guilds || []) {
    for (const r of g.recipes || []) {
      if (!prevRecipes.has(r.spellId)) prevRecipes.set(r.spellId, r);
    }
  }

  const nextRecipes = new Map();
  for (const g of next.guilds || []) {
    for (const r of g.recipes || []) {
      if (!nextRecipes.has(r.spellId)) nextRecipes.set(r.spellId, r);
    }
  }

  const addedRecipes = [];
  for (const [id, r] of nextRecipes) {
    if (!prevRecipes.has(id)) addedRecipes.push(r.name || `Spell #${id}`);
  }

  const removedRecipes = [];
  for (const [id, r] of prevRecipes) {
    if (!nextRecipes.has(id)) removedRecipes.push(r.name || `Spell #${id}`);
  }

  const recipeDelta = nextRecipes.size - prevRecipes.size;
  const deltaStr = recipeDelta > 0 ? `+${recipeDelta}` : `${recipeDelta}`;

  const prevCrafters = new Map();
  for (const g of prev.guilds || []) {
    for (const c of g.crafters || []) {
      prevCrafters.set(c.char, c);
    }
  }

  const crafterUpdates = [];
  for (const g of next.guilds || []) {
    for (const c of g.crafters || []) {
      const prevC = prevCrafters.get(c.char);
      if (!prevC) {
        crafterUpdates.push(`new crafter: ${c.shortName || c.char}`);
      } else {
        const prevProfs = new Map((prevC.professions || []).map(p => [p.id, p]));
        for (const p of c.professions || []) {
          const prevP = prevProfs.get(p.id);
          if (!prevP) {
            crafterUpdates.push(`${c.shortName || c.char} learned ${p.name}`);
          } else if (p.skill !== prevP.skill) {
            crafterUpdates.push(`${c.shortName || c.char} (${p.name} skill ${prevP.skill} -> ${p.skill})`);
          } else if (p.recipeCount !== prevP.recipeCount) {
            const countDiff = p.recipeCount - prevP.recipeCount;
            const sign = countDiff > 0 ? '+' : '';
            crafterUpdates.push(`${c.shortName || c.char} (${p.name} ${sign}${countDiff} recipes)`);
          }
        }
      }
    }
  }

  const parts = [];
  if (recipeDelta !== 0) {
    parts.push(`${deltaStr} recipes (${nextRecipes.size} total)`);
  } else {
    parts.push(`${nextRecipes.size} recipes total`);
  }

  if (addedRecipes.length > 0) {
    const preview = addedRecipes.slice(0, 3).map(n => `"${n}"`).join(', ');
    const more = addedRecipes.length > 3 ? ` (+${addedRecipes.length - 3} more)` : '';
    parts.push(`added: ${preview}${more}`);
  }

  if (removedRecipes.length > 0) {
    const preview = removedRecipes.slice(0, 3).map(n => `"${n}"`).join(', ');
    parts.push(`removed: ${preview}`);
  }

  if (crafterUpdates.length > 0) {
    const preview = crafterUpdates.slice(0, 3).join(', ');
    const more = crafterUpdates.length > 3 ? ` (+${crafterUpdates.length - 3} more)` : '';
    parts.push(preview + more);
  }

  if (parts.length === 1 && parts[0].includes('recipes total')) {
    if (force) {
      return `forced sync (${nextRecipes.size} recipes)`;
    }
    return `metadata/cache refreshed (${nextRecipes.size} recipes)`;
  }

  return parts.join('; ');
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force') || args.includes('-f');

  console.log('[Sync] Starting daily unattended recipe sync...');
  if (force) {
    console.log('[Sync] Flag --force detected: will commit and push even if recipe data is identical.');
  }

  // 1. Pull latest origin/main
  console.log('[Sync] Step 1/5: Pulling latest changes from origin main...');
  try {
    const pullOutput = execFileSync('git', ['pull', '--rebase', 'origin', 'main'], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true
    });
    if (pullOutput.trim()) {
      console.log(`[Sync] git pull: ${pullOutput.trim()}`);
    }
  } catch (err) {
    console.error(`[Sync] Git pull failed: ${err.message}`);
    process.exit(1);
  }

  // 2. Read current dist/recipes.json before running export
  console.log('[Sync] Step 2/5: Reading existing dist/recipes.json baseline...');
  const recipesJsonPath = path.join(ROOT, 'dist', 'recipes.json');
  let prev = null;
  if (fs.existsSync(recipesJsonPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(recipesJsonPath, 'utf8'));
      prev = {
        guilds: raw.guilds || [],
        meta: raw.meta || {}
      };
    } catch (err) {
      console.warn(`[Sync] Warning: Failed to parse baseline recipes.json: ${err.message}`);
    }
  } else {
    console.log('[Sync] Notice: dist/recipes.json does not exist yet. Initial export will be created.');
  }

  // 3. Run node export.mjs
  console.log('[Sync] Step 3/5: Running export.mjs...');
  try {
    const exportOutput = execFileSync(process.execPath, [path.join(ROOT, 'export.mjs')], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true
    });
    if (exportOutput.trim()) {
      console.log(exportOutput.trim());
    }
  } catch (err) {
    console.error(`[Sync] Export execution failed: ${err.message}`);
    process.exit(1);
  }

  // 4. Read newly generated dist/recipes.json
  console.log('[Sync] Step 4/5: Inspecting newly generated dist/recipes.json...');
  if (!fs.existsSync(recipesJsonPath)) {
    console.error(`[Sync] Error: ${recipesJsonPath} was not generated by export.mjs!`);
    process.exit(1);
  }

  let nextRaw;
  try {
    nextRaw = JSON.parse(fs.readFileSync(recipesJsonPath, 'utf8'));
  } catch (err) {
    console.error(`[Sync] Error parsing generated recipes.json: ${err.message}`);
    process.exit(1);
  }

  const next = {
    guilds: nextRaw.guilds || [],
    meta: nextRaw.meta || {}
  };

  const recipeCount = new Set((next.guilds || []).flatMap(g => (g.recipes || []).map(r => r.spellId))).size;
  const profCount = new Set((next.guilds || []).flatMap(g => (g.professions || []).map(p => p.id || p.name))).size;
  const crafterCount = new Set((next.guilds || []).flatMap(g => (g.crafters || []).map(c => c.char || c.fullName))).size;

  // 5. Deep-compare recipes & metadata
  console.log('[Sync] Step 5/5: Comparing data payload...');
  const prevSerialized = prev ? JSON.stringify({ guilds: prev.guilds, meta: prev.meta }) : null;
  const nextSerialized = JSON.stringify({ guilds: next.guilds, meta: next.meta });
  const isIdentical = prevSerialized !== null && prevSerialized === nextSerialized;

  if (isIdentical && !force) {
    console.log('[Sync] Content identical. Reverting timestamp-only churn in dist/...');
    execFileSync('git', ['checkout', '--', 'dist/'], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
    console.log(`[Sync] STATUS: NO_CHANGES — All ${recipeCount} recipes across ${profCount} professions and ${crafterCount} crafters are already up to date on GitHub Pages.`);
    process.exit(0);
  }

  // Data changed or --force specified
  const diffSummary = computeDiffSummary(prev, next, force);
  console.log(`[Sync] Changes detected: ${diffSummary}`);

  const filesToStage = ['dist/'];
  const cachePath = path.join(ROOT, 'cache', 'warcraftdb.json');
  if (fs.existsSync(cachePath)) {
    filesToStage.unshift('cache/warcraftdb.json');
  }

  console.log(`[Sync] Staging files: ${filesToStage.join(', ')}...`);
  execFileSync('git', ['add', ...filesToStage], { cwd: ROOT, encoding: 'utf8', windowsHide: true });

  const stagedDiff = execFileSync('git', ['diff', '--cached', '--name-only'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true
  }).trim();

  if (!stagedDiff) {
    console.log('[Sync] No files were changed after staging. Working directory clean.');
    console.log(`[Sync] STATUS: NO_CHANGES — All ${recipeCount} recipes across ${profCount} professions and ${crafterCount} crafters are already up to date on GitHub Pages.`);
    process.exit(0);
  }

  const commitMsg = 'chore(data): daily GuildRecipeBook recipe sync';
  console.log(`[Sync] Committing changes: "${commitMsg}"...`);
  const commitOutput = execFileSync('git', ['commit', '-m', commitMsg], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true
  });
  if (commitOutput.trim()) {
    console.log(commitOutput.trim());
  }

  const commitSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true
  }).trim();

  console.log('[Sync] Pushing to origin main...');
  const pushOutput = execFileSync('git', ['push', 'origin', 'main'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true
  });
  if (pushOutput.trim()) {
    console.log(pushOutput.trim());
  }

  console.log(`[Sync] STATUS: UPDATED_AND_PUSHED — ${commitSha} — ${diffSummary}`);
  process.exit(0);
}

main().catch(err => {
  console.error(`[Sync] Fatal error: ${err.stack || err.message}`);
  process.exit(1);
});

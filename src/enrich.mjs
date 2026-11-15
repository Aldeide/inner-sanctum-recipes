/**
 * WarcraftDB Recipe Enricher & Tooltip Cache Manager.
 * Fetches recipe metadata, tooltips, icons, qualities, reagents, and item details
 * from https://forever.warcraftdb.com/api/v1/tooltip/spell/{spellId} with 10-worker pool,
 * timeout, retry on transient errors, and persistent disk caching in cache/warcraftdb.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import { CLASSIC_RECIPE_SKILLS, getClassicReqSkill } from './classic-skills.mjs';

const WCDB_BASE = 'https://forever.warcraftdb.com';
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_CONCURRENCY = 10;

/**
 * Loads the existing warcraftdb cache from disk if available.
 */
export function loadCache(cacheFilePath) {
  try {
    if (fs.existsSync(cacheFilePath)) {
      const raw = fs.readFileSync(cacheFilePath, 'utf8');
      const data = JSON.parse(raw);
      return typeof data === 'object' && data !== null ? data : {};
    }
  } catch (err) {
    console.warn(`[Enricher] Warning: could not read cache at ${cacheFilePath}: ${err.message}`);
  }
  return {};
}

/**
 * Saves cache dictionary to disk.
 */
export function saveCache(cacheFilePath, cacheData) {
  try {
    const dir = path.dirname(cacheFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(cacheFilePath, JSON.stringify(cacheData, null, 2), 'utf8');
  } catch (err) {
    console.error(`[Enricher] Error saving cache to ${cacheFilePath}: ${err.message}`);
  }
}

/**
 * Safe fetch with AbortSignal timeout and 1 retry on transient error.
 */
async function fetchWithRetry(url, timeoutMs = DEFAULT_TIMEOUT_MS, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'GuildRecipeBookWeb/1.0 (+https://github.com)'
        }
      });
      if (response.ok) {
        return await response.json();
      }
      if (response.status === 404) {
        return null;
      }
      if (response.status >= 500 && attempt < retries) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      return null;
    } catch (err) {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 600));
        continue;
      }
      return null;
    }
  }
  return null;
}

/**
 * Sanitizes and transforms WarcraftDB tooltip HTML so it works standalone offline & online.
 * 1. Rewrites href="/data/ to https://forever.warcraftdb.com/data/ with target="_blank" rel="noopener".
 * 2. Adds inline style="color:#xxxxxx" to every <tt-inline-color data-color="#xxxxxx"> tag.
 */
export function sanitizeTooltipHtml(html) {
  if (!html || typeof html !== 'string') return null;
  return html
    .replace(/href="(?:https:\/\/forever\.warcraftdb\.com)?\/data\/items?\/(\d+)[^"]*"/gi, 'href="https://www.wowhead.com/forever/item=$1" target="_blank" rel="noopener"')
    .replace(/href="(?:https:\/\/forever\.warcraftdb\.com)?\/data\/spells?\/(\d+)[^"]*"/gi, 'href="https://www.wowhead.com/forever/spell=$1" target="_blank" rel="noopener"')
    .replace(/href="\/data\/([^"]*)"/gi, 'href="https://www.wowhead.com/forever/$1" target="_blank" rel="noopener"')
    .replace(/href="https:\/\/forever\.warcraftdb\.com\/data\/([^"]*)"/gi, 'href="https://www.wowhead.com/forever/$1" target="_blank" rel="noopener"')
    .replace(/<tt-inline-color data-color="([^"]+)">/gi, '<tt-inline-color data-color="$1" style="color:$1">');
}

export const REQ_SKILL_REGEX = /Requires\s+(?:Alchemy|Blacksmithing|Cooking|Enchanting|Engineering|First Aid|Leatherworking|Mining|Poisons|Tailoring|Jewelcrafting|Inscription|Herbalism|Skinning|Fishing)\s*\(\s*(\d+)\s*\)/i;

/**
 * Authoritative required tradeskill levels for custom WoW: Forever recipes
 * without explicit (N) in tooltips.
 */
export const CUSTOM_RECIPE_SKILLS = {
  // Camping & utility
  1229737: 1,   // Basic Campfire
  1230117: 20,  // First Aid Kit
  1230161: 20,  // Lodestone
  1230171: 20,  // Sharpening Wheel
  1230643: 20,  // Enchanted Lute
  1263032: 140, // Spinning Wheel
  1263056: 140, // Arcane Salvager
  1263425: 20,  // Faction Banner

  // Potions & enchants & gear
  435841: 125,  // Invoker's Cord
  1244431: 1,   // Minor Healing Potion
  1244432: 55,  // Lesser Healing Potion
  1244433: 110, // Healing Potion
  1245287: 1,   // Copper Rod
  1245320: 1,   // Dust to Motes
  1245321: 10,  // Novice's Practice Wand
  1248500: 240, // Enchant Bracer - Greater Agility (Dream Dust tier 225-250)
  1248757: 110, // Enchant Weapon - Insight (Strange Dust / Astral Essence 75-150)
  1248760: 110, // Enchant Weapon - Recovery (Soul Dust / Astral Essence 75-150)
  1248805: 120, // Enchant Weapon - Revelation (Soul Dust / Astral Essence 75-150)
  1249057: 250, // Enchant Necklace - Spell Power (Nether Essence / Radiant Shard 250-300)
  1252229: 50,  // Gemmed Copper Boots
  1252230: 50,  // Strange Copper Boots
  1252231: 50,  // Glowing Copper Boots
  1252233: 105, // Sterling Silver Leggings
  1252352: 100, // Bronze Dory
  1257013: 45,  // Linen Reagent Bag
  1257017: 100, // Woolen Reagent Bag
  1257368: 50,  // Novice Arcanist's Sash
  1257380: 75,  // Filigreed Pearly Gown
  1257394: 100, // Filigreed Pristine Leggings
  1257430: 150, // Golden Slippers
  1257462: 235, // Ghostweave Cord
  1257463: 235, // Earthenweave Gloves
  1259342: 1,   // Simple Poultice
  1259347: 80,  // Woolen Tourniquet
  1270633: 25   // Skywall Souffle
};

/**
 * Extracts and derives the required profession tradeskill level (reqSkill, integer 1–300).
 */
export function extractReqSkill(spellId, rawHtml = '', embeddedSection = '', fallbackRecipe = {}, reagents = []) {
  const sid = Number(spellId);

  // 1. Explicit tooltip extraction (Primary: spell HTML or embedded item HTML)
  const fullHtml = `${rawHtml || ''} ${embeddedSection || ''} ${fallbackRecipe.tooltipHtml || ''}`;
  const directMatch = fullHtml.match(REQ_SKILL_REGEX);
  if (directMatch) {
    const val = parseInt(directMatch[1], 10);
    if (!isNaN(val) && val >= 1) return Math.min(300, Math.max(1, val));
  }

  // 2. Custom WoW: Forever known skills table
  if (CUSTOM_RECIPE_SKILLS[sid] !== undefined) {
    return CUSTOM_RECIPE_SKILLS[sid];
  }

  // 3. Classic standard recipe lookup table (< 100000)
  const classicVal = getClassicReqSkill(sid);
  if (classicVal !== null) {
    return classicVal;
  }

  // 4. Custom WoW: Forever recipe with Requires Level (in Classic WoW, reqSkill = reqLevel * 5)
  const lvlMatch = fullHtml.match(/Requires Level\s*(\d+)/i);
  if (lvlMatch) {
    const reqLevel = parseInt(lvlMatch[1], 10);
    if (!isNaN(reqLevel) && reqLevel > 0) {
      return Math.min(300, Math.max(1, reqLevel * 5));
    }
  }

  // 5. Tier fallback (<tt-subtitle>Tier N</tt-subtitle>)
  const tierMatch = fullHtml.match(/<tt-subtitle>[^<]*Tier\s*(\d+)[^<]*<\/tt-subtitle>/i);
  if (tierMatch) {
    const tierNum = parseInt(tierMatch[1], 10);
    if (tierNum === 1) return 1;
    if (tierNum === 2) return 140;
    if (tierNum >= 3) return 225;
  }

  // 6. Reagent-based tier fallback for new/unlisted custom recipes
  if (Array.isArray(reagents) && reagents.length > 0) {
    const reagentNames = reagents.map(r => (r.name || '').toLowerCase()).join(' ');
    if (/runecloth|thorium|arcanite|dream dust|nether essence|radiant shard/i.test(reagentNames)) return 250;
    if (/mageweave|mithril|truesilver|vision dust/i.test(reagentNames)) return 200;
    if (/silk cloth|iron ore|iron bar|gold ore|gold bar|soul dust|astral essence/i.test(reagentNames)) return 125;
    if (/woolen cloth|wool cloth|bronze|silver ore|silver bar/i.test(reagentNames)) return 75;
    if (/linen cloth|copper|strange dust/i.test(reagentNames)) return 1;
  }

  // 7. Base default fallback
  return 1;
}

/**
 * Parses raw WarcraftDB spell tooltip response (+ optional item fallback) into enriched metadata.
 */
export function parseTooltipResponse(spellId, spellData, itemData, fallbackRecipe = {}) {
  const name = (spellData && spellData.name) || fallbackRecipe.name || `Recipe #${spellId}`;
  const icon = (spellData && spellData.icon) || (itemData && itemData.icon) || null;
  const rawHtml = (spellData && spellData.html) || (itemData && itemData.html) || '';
  const itemId = fallbackRecipe.itemId != null ? Number(fallbackRecipe.itemId) : (itemData && itemData.id ? Number(itemData.id) : null);

  // 1. Quality
  let quality = null;
  if (spellData && spellData.html) {
    const embeddedMatch = spellData.html.match(/<div class="wcdb-tooltip-embedded">([\s\S]*?)<\/div>\s*<\/div>/i);
    if (embeddedMatch) {
      const qMatch = embeddedMatch[1].match(/<tt-title[^>]*data-quality="(\d+)"/i);
      if (qMatch) {
        quality = parseInt(qMatch[1], 10);
      }
    }
  }

  // If quality still not found and itemData exists, check itemData quality
  if (quality === null && itemData) {
    if (itemData.quality !== undefined && itemData.quality !== null) {
      quality = Number(itemData.quality);
    } else if (itemData.html) {
      const itemQMatch = itemData.html.match(/<tt-title[^>]*data-quality="(\d+)"/i);
      if (itemQMatch) {
        quality = parseInt(itemQMatch[1], 10);
      }
    }
  }

  // 2. Tier (e.g. <tt-subtitle>Tier 1</tt-subtitle>)
  let tier = null;
  const tierMatch = rawHtml.match(/<tt-subtitle>([^<]+)<\/tt-subtitle>/i);
  if (tierMatch) {
    tier = tierMatch[1].trim();
  }

  // 3. Slot and SubType (inside embedded tooltip or item tooltip)
  let slot = null;
  let subType = null;
  const embeddedSection = (spellData && spellData.html ? spellData.html.match(/<div class="wcdb-tooltip-embedded">([\s\S]*)/i)?.[1] : null) || (itemData && itemData.html) || '';

  if (embeddedSection) {
    // Look for <tt-double-line><span>...</span><span>...</span></tt-double-line>
    const doubleLineMatches = embeddedSection.matchAll(/<tt-double-line>\s*<span>(?:<tt-inline-color[^>]*>)?([^<]*?)(?:<\/tt-inline-color>)?<\/span>\s*<span>(?:<tt-inline-color[^>]*>)?([^<]*?)(?:<\/tt-inline-color>)?<\/span>\s*<\/tt-double-line>/gi);
    for (const match of doubleLineMatches) {
      const part1 = match[1].trim();
      const part2 = match[2].trim();
      // Skip damage, speed, cast-time lines
      if (/damage|speed|cast|sec|min/i.test(part1) || /damage|speed|cast|sec|min/i.test(part2)) continue;
      slot = part1 || null;
      subType = part2 || null;
      break;
    }

    // If slot still null, check for single slot line (e.g. Ring, Neck, Trinket, Cloak/Back, Shirt, Tabard)
    if (!slot) {
      const singleMatch = embeddedSection.match(/<tt-line[^>]*>(?:<tt-inline-color[^>]*>)?(Head|Neck|Shoulder|Shoulders|Back|Chest|Shirt|Tabard|Wrist|Hands|Waist|Legs|Feet|Finger|Trinket|One-Hand|Two-Hand|Main Hand|Off Hand|Held In Off-hand|Ranged|Relic|Shield)(?:<\/tt-inline-color>)?<\/tt-line>/i);
      if (singleMatch) {
        slot = singleMatch[1].trim();
      }
    }
  }

  // 4. Reagents and reagentsText
  const reagents = [];
  let reagentsText = null;

  if (spellData && spellData.html) {
    const reagentsMatch = spellData.html.match(/<tt-line data-line-type="spell-reagents">\s*Reagents:\s*<\/tt-line>\s*<tt-indented-line>([\s\S]*?)<\/tt-indented-line>/i);
    if (reagentsMatch) {
      const indented = reagentsMatch[1];
      reagentsText = indented.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

      const itemMatches = indented.matchAll(/<a href="\/data\/item\/(\d+)"[^>]*>([^<]+)<\/a>(?:\s*\((\d+)\))?/gi);
      for (const m of itemMatches) {
        reagents.push({
          itemId: Number(m[1]),
          name: m[2].trim(),
          count: m[3] ? Number(m[3]) : 1
        });
      }
    }
  }

  // 5. Required tradeskill level (reqSkill)
  const reqSkill = extractReqSkill(spellId, rawHtml, embeddedSection, fallbackRecipe, reagents);

  // 6. Tooltip HTML sanitized
  const tooltipHtml = sanitizeTooltipHtml(rawHtml);

  return {
    spellId: Number(spellId),
    name: String(name),
    itemId: itemId != null ? Number(itemId) : null,
    icon: icon != null ? Number(icon) : null,
    quality: quality !== undefined && quality !== null ? Number(quality) : null,
    tier: tier || null,
    slot: slot || null,
    subType: subType || null,
    reagents,
    reagentsText: reagentsText || null,
    reqSkill: Number.isInteger(reqSkill) && reqSkill >= 1 && reqSkill <= 300 ? reqSkill : 1,
    tooltipHtml
  };
}

/**
 * Enriches a list of recipes using a concurrency pool, persistent disk caching, and error retries.
 *
 * @param {Array<Object>} recipes - List of recipe objects (each with spellId, name, itemId, ...)
 * @param {Object} options
 * @param {string} options.cachePath - Absolute path to cache/warcraftdb.json
 * @param {boolean} options.offline - Skip network calls, use only local cache/fallbacks
 * @param {boolean} options.refreshCache - Ignore existing cache and re-fetch from WarcraftDB
 * @param {number} options.concurrency - Max parallel workers (default 10)
 * @param {function} options.onProgress - Optional callback (processed, total, currentItem)
 * @returns {Promise<Object>} Map of String(spellId) -> enriched metadata
 */
export async function enrichRecipes(recipes, options = {}) {
  const cachePath = options.cachePath || path.resolve(process.cwd(), 'cache', 'warcraftdb.json');
  const isOffline = Boolean(options.offline);
  const refreshCache = Boolean(options.refreshCache);
  const concurrency = options.concurrency || MAX_CONCURRENCY;

  // Load existing cache
  const cache = refreshCache ? {} : loadCache(cachePath);
  const metaResult = {};
  let cacheModified = false;

  const toFetch = [];
  for (const recipe of recipes) {
    const sid = String(recipe.spellId);
    if (!refreshCache && cache[sid]) {
      // Ensure cached entry has accurate reqSkill
      if (cache[sid].reqSkill === undefined || cache[sid].reqSkill === null) {
        cache[sid].reqSkill = extractReqSkill(recipe.spellId, cache[sid].tooltipHtml, '', recipe, cache[sid].reagents);
        cacheModified = true;
      }
      metaResult[sid] = cache[sid];
    } else if (isOffline) {
      metaResult[sid] = parseTooltipResponse(recipe.spellId, null, null, recipe);
    } else {
      toFetch.push(recipe);
    }
  }

  if (toFetch.length === 0) {
    if (cacheModified) {
      console.log(`[Enricher] Saving updated cache to ${cachePath}...`);
      saveCache(cachePath, cache);
    }
    return metaResult;
  }

  console.log(`[Enricher] Fetching metadata for ${toFetch.length} recipes from WarcraftDB (concurrency: ${concurrency})...`);

  let completed = 0;
  const total = toFetch.length;

  // Concurrency pool runner
  async function worker(recipe) {
    const sid = String(recipe.spellId);
    try {
      const spellData = await fetchWithRetry(`${WCDB_BASE}/api/v1/tooltip/spell/${recipe.spellId}`);

      let itemData = null;
      // Fallback item fetch if spell tooltip has no embedded item and recipe has itemId
      if (recipe.itemId && (!spellData || !spellData.html || !spellData.html.includes('wcdb-tooltip-embedded'))) {
        itemData = await fetchWithRetry(`${WCDB_BASE}/api/v1/tooltip/item/${recipe.itemId}`);
      }

      const enriched = parseTooltipResponse(recipe.spellId, spellData, itemData, recipe);
      metaResult[sid] = enriched;
      cache[sid] = enriched;
      cacheModified = true;
    } catch (err) {
      console.warn(`[Enricher] Warning: failed to enrich spell ${recipe.spellId}: ${err.message}`);
      const fallback = parseTooltipResponse(recipe.spellId, null, null, recipe);
      metaResult[sid] = fallback;
    } finally {
      completed++;
      if (options.onProgress) {
        options.onProgress(completed, total, recipe);
      } else if (completed % 25 === 0 || completed === total) {
        console.log(`[Enricher] Progress: ${completed}/${total} (${Math.round((completed / total) * 100)}%)`);
      }
    }
  }

  // Run with bounded concurrency
  let index = 0;
  const executing = [];
  for (const item of toFetch) {
    const p = Promise.resolve().then(() => worker(item));
    executing.push(p);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
      // Remove finished promises
      for (let i = executing.length - 1; i >= 0; i--) {
        // Check if settled
        const status = await Promise.race([executing[i].then(() => true), Promise.resolve(false)]);
        if (status) {
          executing.splice(i, 1);
        }
      }
    }
  }
  await Promise.all(executing);

  // Save cache back to disk
  if (cacheModified) {
    console.log(`[Enricher] Saving updated cache to ${cachePath}...`);
    saveCache(cachePath, cache);
  }

  return metaResult;
}

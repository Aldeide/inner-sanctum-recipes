/**
 * Pure JavaScript Lua SavedVariables parser and GuildRecipeBook transformer.
 * ZERO Node.js imports - runs identically in Node.js and in the browser!
 */

// Secondary profession IDs in WoW
export const SECONDARY_PROF_IDS = new Set([129, 185, 356, 794]); // First Aid, Cooking, Fishing, Archaeology

// Fallback profession name dictionary
export const KNOWN_PROFESSIONS = {
  129: 'First Aid',
  164: 'Blacksmithing',
  165: 'Leatherworking',
  171: 'Alchemy',
  182: 'Herbalism',
  185: 'Cooking',
  186: 'Mining',
  197: 'Tailoring',
  202: 'Engineering',
  333: 'Enchanting',
  356: 'Fishing',
  393: 'Skinning',
  755: 'Jewelcrafting',
  773: 'Inscription',
  794: 'Archaeology'
};

/**
 * Tokenize Lua source code.
 * Handles single-line comments, block comments, strings (double/single quoted & long brackets),
 * numbers (integers, floats, negative, scientific, hex), booleans, nil, and punctuation.
 */
function tokenizeLua(src) {
  const tokens = [];
  let i = 0;
  const len = src.length;

  while (i < len) {
    const ch = src[i];

    // 1. Whitespace
    if (ch <= ' ') {
      i++;
      continue;
    }

    // 2. Comments: single-line '--' or block '--[=['
    if (ch === '-' && src[i + 1] === '-') {
      i += 2;
      if (i < len && src[i] === '[') {
        // Potential block comment: --[=*[
        let eqCount = 0;
        let p = i + 1;
        while (p < len && src[p] === '=') {
          eqCount++;
          p++;
        }
        if (p < len && src[p] === '[') {
          // It's a block comment: --[===[ ... ]===]
          const closing = ']' + '='.repeat(eqCount) + ']';
          const end = src.indexOf(closing, p + 1);
          if (end === -1) {
            i = len;
          } else {
            i = end + closing.length;
          }
          continue;
        }
      }
      // Single line comment: up to newline
      while (i < len && src[i] !== '\n' && src[i] !== '\r') {
        i++;
      }
      continue;
    }

    // 3. Block strings: [=*[ ... ]=*]
    if (ch === '[') {
      let eqCount = 0;
      let p = i + 1;
      while (p < len && src[p] === '=') {
        eqCount++;
        p++;
      }
      if (p < len && src[p] === '[') {
        const closing = ']' + '='.repeat(eqCount) + ']';
        const start = p + 1;
        const end = src.indexOf(closing, start);
        if (end === -1) {
          tokens.push({ type: 'STRING', value: src.slice(start) });
          i = len;
        } else {
          tokens.push({ type: 'STRING', value: src.slice(start, end) });
          i = end + closing.length;
        }
        continue;
      }
    }

    // 4. Quoted strings ('...' or "...")
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let raw = '';
      while (i < len) {
        const c = src[i];
        if (c === '\\') {
          if (i + 1 < len) {
            raw += src[i] + src[i + 1];
            i += 2;
          } else {
            raw += c;
            i++;
          }
        } else if (c === quote) {
          i++;
          break;
        } else {
          raw += c;
          i++;
        }
      }
      tokens.push({ type: 'STRING', value: unescapeLuaString(raw) });
      continue;
    }

    // 5. Punctuation
    if (ch === '{' || ch === '}' || ch === '[' || ch === ']' || ch === '=' || ch === ',' || ch === ';') {
      tokens.push({ type: 'PUNCT', value: ch });
      i++;
      continue;
    }

    // 6. Numbers (including hex: 0x..., float, scientific notation)
    // Note: unary minus is handled at parser level or here if digit immediately follows '-'
    if (ch === '-' && i + 1 < len && (src[i + 1] >= '0' && src[i + 1] <= '9' || (src[i + 1] === '.' && i + 2 < len && src[i + 2] >= '0' && src[i + 2] <= '9'))) {
      const prevTok = tokens.length > 0 ? tokens[tokens.length - 1] : null;
      // If previous token is an operator/separator, this '-' is part of the number
      if (!prevTok || prevTok.type === 'PUNCT' && (prevTok.value === '=' || prevTok.value === ',' || prevTok.value === ';' || prevTok.value === '{' || prevTok.value === '[')) {
        let numStr = '-';
        i++;
        while (i < len && isNumberChar(src[i])) {
          numStr += src[i++];
        }
        tokens.push({ type: 'NUMBER', value: parseLuaNumber(numStr) });
        continue;
      }
    }

    if ((ch >= '0' && ch <= '9') || (ch === '.' && i + 1 < len && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      let numStr = '';
      while (i < len && isNumberChar(src[i])) {
        // Special case: don't swallow '+' or '-' unless preceded by e/E
        if ((src[i] === '+' || src[i] === '-') && !/[eE]/.test(numStr[numStr.length - 1])) {
          break;
        }
        numStr += src[i++];
      }
      tokens.push({ type: 'NUMBER', value: parseLuaNumber(numStr) });
      continue;
    }

    // Unary minus if not followed immediately by a digit
    if (ch === '-') {
      tokens.push({ type: 'PUNCT', value: '-' });
      i++;
      continue;
    }

    // 7. Identifiers / Keywords (true, false, nil)
    if (isIdentStart(ch)) {
      let id = '';
      while (i < len && isIdentPart(src[i])) {
        id += src[i++];
      }
      if (id === 'true') {
        tokens.push({ type: 'BOOL', value: true });
      } else if (id === 'false') {
        tokens.push({ type: 'BOOL', value: false });
      } else if (id === 'nil') {
        tokens.push({ type: 'NIL', value: null });
      } else {
        tokens.push({ type: 'IDENT', value: id });
      }
      continue;
    }

    // Skip unknown character
    i++;
  }

  tokens.push({ type: 'EOF', value: null });
  return tokens;
}

function isNumberChar(c) {
  return (c >= '0' && c <= '9') || c === '.' || c === 'x' || c === 'X' ||
    (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F') ||
    c === 'e' || c === 'E' || c === '+' || c === '-';
}

function isIdentStart(c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
}

function isIdentPart(c) {
  return isIdentStart(c) || (c >= '0' && c <= '9');
}

function parseLuaNumber(str) {
  str = str.trim();
  if (str.startsWith('0x') || str.startsWith('0X') || str.startsWith('-0x') || str.startsWith('-0X')) {
    const isNeg = str.startsWith('-');
    const hex = isNeg ? str.slice(3) : str.slice(2);
    const val = parseInt(hex, 16);
    return isNeg ? -val : val;
  }
  return parseFloat(str);
}

function unescapeLuaString(raw) {
  let result = '';
  let i = 0;
  const len = raw.length;

  while (i < len) {
    const ch = raw[i];
    if (ch === '\\' && i + 1 < len) {
      i++;
      const next = raw[i];
      if (next === 'a') { result += '\x07'; i++; }
      else if (next === 'b') { result += '\b'; i++; }
      else if (next === 'f') { result += '\f'; i++; }
      else if (next === 'n') { result += '\n'; i++; }
      else if (next === 'r') { result += '\r'; i++; }
      else if (next === 't') { result += '\t'; i++; }
      else if (next === 'v') { result += '\v'; i++; }
      else if (next === '\\') { result += '\\'; i++; }
      else if (next === '"') { result += '"'; i++; }
      else if (next === "'") { result += "'"; i++; }
      else if (next === '\n') { result += '\n'; i++; }
      else if (next === '\r') {
        i++;
        if (i < len && raw[i] === '\n') i++;
        result += '\n';
      }
      else if (next === 'z') {
        i++;
        while (i < len && raw[i] <= ' ') i++;
      }
      else if (next === 'x' && i + 2 < len && /[0-9a-fA-F]{2}/.test(raw.slice(i + 1, i + 3))) {
        result += String.fromCharCode(parseInt(raw.slice(i + 1, i + 3), 16));
        i += 3;
      }
      else if (next >= '0' && next <= '9') {
        let digits = next;
        i++;
        if (i < len && raw[i] >= '0' && raw[i] <= '9') {
          digits += raw[i];
          i++;
          if (i < len && raw[i] >= '0' && raw[i] <= '9') {
            digits += raw[i];
            i++;
          }
        }
        result += String.fromCharCode(parseInt(digits, 10));
      }
      else {
        result += next;
        i++;
      }
    } else {
      result += ch;
      i++;
    }
  }
  return result;
}

/**
 * Recursive-descent parser for Lua SavedVariables.
 * Returns an object mapping global variable names to parsed JS values.
 */
export function parseLuaSavedVariables(luaSource) {
  if (typeof luaSource !== 'string') {
    throw new TypeError('Expected string for luaSource');
  }

  const tokens = tokenizeLua(luaSource);
  let pos = 0;

  function peek() {
    return tokens[pos];
  }

  function consume(expectedType, expectedValue) {
    const tok = tokens[pos];
    if (!tok || tok.type === 'EOF') {
      throw new Error(`Unexpected end of input, expected ${expectedType || expectedValue}`);
    }
    if (expectedType && tok.type !== expectedType) {
      throw new Error(`Expected token type ${expectedType}, found ${tok.type} (${tok.value}) at token ${pos}`);
    }
    if (expectedValue !== undefined && tok.value !== expectedValue) {
      throw new Error(`Expected token value '${expectedValue}', found '${tok.value}' at token ${pos}`);
    }
    pos++;
    return tok;
  }

  function parseExpression() {
    const tok = peek();
    if (!tok || tok.type === 'EOF') {
      throw new Error('Unexpected end of input while parsing expression');
    }

    if (tok.type === 'PUNCT' && tok.value === '-') {
      consume('PUNCT', '-');
      const val = parseExpression();
      return typeof val === 'number' ? -val : NaN;
    }

    if (tok.type === 'NUMBER' || tok.type === 'STRING' || tok.type === 'BOOL') {
      pos++;
      return tok.value;
    }

    if (tok.type === 'NIL') {
      pos++;
      return null;
    }

    if (tok.type === 'PUNCT' && tok.value === '{') {
      return parseTable();
    }

    if (tok.type === 'IDENT') {
      pos++;
      return tok.value;
    }

    throw new Error(`Unexpected token in expression: ${tok.type} (${tok.value}) at token ${pos}`);
  }

  function parseTable() {
    consume('PUNCT', '{');

    const obj = {};
    const arrayItems = [];
    let hasArrayItems = false;
    let hasKeyValues = false;

    while (true) {
      const tok = peek();
      if (!tok || tok.type === 'EOF') {
        throw new Error('Unterminated table, expected "}"');
      }

      if (tok.type === 'PUNCT' && tok.value === '}') {
        consume('PUNCT', '}');
        break;
      }

      // Trailing or extra separators
      if (tok.type === 'PUNCT' && (tok.value === ',' || tok.value === ';')) {
        pos++;
        continue;
      }

      // Case 1: [expr] = value
      if (tok.type === 'PUNCT' && tok.value === '[') {
        consume('PUNCT', '[');
        const key = parseExpression();
        consume('PUNCT', ']');
        consume('PUNCT', '=');
        const val = parseExpression();
        obj[key] = val;
        hasKeyValues = true;
      }
      // Case 2: ident = value
      else if (tok.type === 'IDENT' && tokens[pos + 1] && tokens[pos + 1].type === 'PUNCT' && tokens[pos + 1].value === '=') {
        const key = consume('IDENT').value;
        consume('PUNCT', '=');
        const val = parseExpression();
        obj[key] = val;
        hasKeyValues = true;
      }
      // Case 3: implicit positional value (array item)
      else {
        const val = parseExpression();
        arrayItems.push(val);
        hasArrayItems = true;
      }

      // Optional separator after field
      const sep = peek();
      if (sep && sep.type === 'PUNCT' && (sep.value === ',' || sep.value === ';')) {
        pos++;
      }
    }

    // Determine whether to return Array or Object
    // If it only has positional array items and no explicit keys, return Array
    if (hasArrayItems && !hasKeyValues) {
      return arrayItems;
    }

    // If it had both (rare in SavedVariables, but possible in Lua), assign array items at 1-based index
    if (hasArrayItems && hasKeyValues) {
      for (let idx = 0; idx < arrayItems.length; idx++) {
        obj[idx + 1] = arrayItems[idx];
      }
    }

    return obj;
  }

  // Parse top-level assignments: ident = expr [;]
  const root = {};
  while (pos < tokens.length) {
    const tok = peek();
    if (!tok || tok.type === 'EOF') break;

    // Optional stray semicolons/commas
    if (tok.type === 'PUNCT' && (tok.value === ';' || tok.value === ',')) {
      pos++;
      continue;
    }

    if (tok.type === 'IDENT') {
      const varName = consume('IDENT').value;
      consume('PUNCT', '=');
      const val = parseExpression();
      root[varName] = val;

      // Optional semicolon after statement
      const next = peek();
      if (next && next.type === 'PUNCT' && next.value === ';') {
        pos++;
      }
      continue;
    }

    // Unknown top-level token, advance
    pos++;
  }

  return root;
}

/**
 * Merges multiple GuildRecipeBookDB raw databases (e.g. from multiple accounts or .lua files).
 * Merges `recipes` dictionaries and `guilds[guildKey].entries[entryKey]` using last-write-wins (ts).
 */
export function mergeRawDatabases(dbs) {
  if (!Array.isArray(dbs) || dbs.length === 0) {
    return { schema: 1, guilds: {}, recipes: {} };
  }

  const merged = {
    schema: 1,
    settings: {},
    guilds: {},
    recipes: {}
  };

  for (const raw of dbs) {
    if (!raw) continue;
    const db = raw.GuildRecipeBookDB || raw;

    if (db.schema && !merged.schema) {
      merged.schema = db.schema;
    }

    if (db.settings && typeof db.settings === 'object') {
      Object.assign(merged.settings, db.settings);
    }

    // Merge recipes dictionary
    if (db.recipes && typeof db.recipes === 'object') {
      for (const [spellId, recInfo] of Object.entries(db.recipes)) {
        if (!merged.recipes[spellId]) {
          merged.recipes[spellId] = { ...recInfo };
        } else {
          // If existing recipe lacks properties, fill them in
          merged.recipes[spellId] = Object.assign({}, merged.recipes[spellId], recInfo);
        }
      }
    }

    // Merge guilds and character entries (last-write-wins by ts)
    if (db.guilds && typeof db.guilds === 'object') {
      for (const [guildKey, guildData] of Object.entries(db.guilds)) {
        if (!merged.guilds[guildKey]) {
          merged.guilds[guildKey] = { entries: {} };
        }

        const targetEntries = merged.guilds[guildKey].entries;
        const sourceEntries = guildData && guildData.entries ? guildData.entries : {};

        for (const [entryKey, entry] of Object.entries(sourceEntries)) {
          if (!entry) continue;
          const existing = targetEntries[entryKey];
          const newTs = Number(entry.ts || 0);
          const oldTs = existing ? Number(existing.ts || 0) : -1;

          if (!existing || newTs >= oldTs) {
            targetEntries[entryKey] = JSON.parse(JSON.stringify(entry));
          }
        }
      }
    }
  }

  return merged;
}

/**
 * Transforms raw GuildRecipeBookDB into clean normalized JSON suitable for web frontend.
 * Schema:
 * {
 *   exportedAt: string (ISO),
 *   schema: 1,
 *   guilds: [
 *     {
 *       guildKey, name, realm,
 *       professions: [ { id, name, isSecondary, recipeCount, crafters } ],
 *       crafters: [ { char, fullName, firstName, shortName, lastName, realm, lastUpdated, totalRecipes, professions } ],
 *       recipes: [ { spellId, name, profId, profName, itemId, isCustom, crafters } ]
 *     }
 *   ]
 * }
 */
export function transformGuildRecipeBook(rawDb) {
  if (!rawDb) {
    return { exportedAt: new Date().toISOString(), schema: 1, guilds: [] };
  }

  const db = rawDb.GuildRecipeBookDB || rawDb;
  const rawGuilds = db.guilds || {};
  const rawRecipes = db.recipes || {};

  // Build a global profession name map
  const profNameMap = new Map();
  for (const [id, name] of Object.entries(KNOWN_PROFESSIONS)) {
    profNameMap.set(Number(id), name);
  }

  // Also collect profession names directly from entries in the raw database
  for (const guildData of Object.values(rawGuilds)) {
    if (!guildData || !guildData.entries) continue;
    for (const entry of Object.values(guildData.entries)) {
      if (entry && entry.prof && entry.name) {
        profNameMap.set(Number(entry.prof), String(entry.name));
      }
    }
  }

  const transformedGuilds = [];

  for (const [guildKey, guildData] of Object.entries(rawGuilds)) {
    if (!guildData || !guildData.entries) continue;

    // Parse guild name and realm (split on first "-")
    const guildDashIdx = guildKey.indexOf('-');
    const guildName = guildDashIdx !== -1 ? guildKey.slice(0, guildDashIdx) : guildKey;
    const guildRealm = guildDashIdx !== -1 ? guildKey.slice(guildDashIdx + 1) : '';

    // Collect active entries (skip entry.del === true)
    const activeEntries = [];
    for (const entry of Object.values(guildData.entries)) {
      if (!entry || entry.del === true) continue;
      activeEntries.push(entry);
    }

    // 1. Group by crafter (char)
    const crafterMap = new Map(); // char -> { char, fullName, firstName, shortName, lastName, realm, professions: [], totalRecipesSet: Set, lastUpdated: 0 }

    for (const entry of activeEntries) {
      const fullChar = String(entry.char || '');
      const dashIdx = fullChar.indexOf('-');
      const firstName = dashIdx !== -1 ? fullChar.slice(0, dashIdx) : fullChar;
      const lastName = dashIdx !== -1 ? fullChar.slice(dashIdx + 1) : '';
      const fullName = lastName ? `${firstName} ${lastName}` : firstName;
      const shortName = firstName;
      const realm = lastName;

      if (!crafterMap.has(fullChar)) {
        crafterMap.set(fullChar, {
          char: fullChar,
          fullName,
          firstName,
          shortName,
          lastName,
          realm,
          professions: [],
          totalRecipesSet: new Set(),
          lastUpdated: 0
        });
      }

      const cObj = crafterMap.get(fullChar);
      const profId = Number(entry.prof || 0);
      const profName = String(entry.name || profNameMap.get(profId) || 'Unknown');
      const isSecondary = SECONDARY_PROF_IDS.has(profId);
      const skill = Number(entry.skill || 0);
      const max = Number(entry.max || 0);
      const ts = Number(entry.ts || 0);

      // Collect known spellIds for this entry
      const entryRecipes = entry.recipes || {};
      let recipeCount = 0;
      for (const [spellIdStr, known] of Object.entries(entryRecipes)) {
        if (known) {
          recipeCount++;
          cObj.totalRecipesSet.add(Number(spellIdStr));
        }
      }

      if (ts > cObj.lastUpdated) {
        cObj.lastUpdated = ts;
      }

      cObj.professions.push({
        id: profId,
        name: profName,
        isSecondary,
        skill,
        max,
        recipeCount,
        ts
      });
    }

    // Sort professions within each crafter alphabetically
    const craftersList = [];
    for (const cObj of crafterMap.values()) {
      cObj.professions.sort((a, b) => a.name.localeCompare(b.name));
      craftersList.push({
        char: cObj.char,
        fullName: cObj.fullName,
        firstName: cObj.firstName,
        shortName: cObj.shortName,
        lastName: cObj.lastName,
        realm: cObj.realm,
        lastUpdated: cObj.lastUpdated,
        totalRecipes: cObj.totalRecipesSet.size,
        professions: cObj.professions
      });
    }
    // Sort crafters alphabetically by fullName
    craftersList.sort((a, b) => a.fullName.localeCompare(b.fullName));

    // 2. Group by profession
    const profMap = new Map(); // profId -> { id, name, isSecondary, crafters: [], recipeSet: Set }

    for (const entry of activeEntries) {
      const profId = Number(entry.prof || 0);
      const profName = String(entry.name || profNameMap.get(profId) || 'Unknown');
      const isSecondary = SECONDARY_PROF_IDS.has(profId);

      if (!profMap.has(profId)) {
        profMap.set(profId, {
          id: profId,
          name: profName,
          isSecondary,
          crafters: [],
          recipeSet: new Set()
        });
      }

      const pObj = profMap.get(profId);
      const fullChar = String(entry.char || '');
      const dashIdx = fullChar.indexOf('-');
      const firstName = dashIdx !== -1 ? fullChar.slice(0, dashIdx) : fullChar;
      const lastName = dashIdx !== -1 ? fullChar.slice(dashIdx + 1) : '';
      const fullName = lastName ? `${firstName} ${lastName}` : firstName;
      const shortName = firstName;
      const realm = lastName;
      const skill = Number(entry.skill || 0);
      const max = Number(entry.max || 0);
      const ts = Number(entry.ts || 0);

      const entryRecipes = entry.recipes || {};
      let recipeCount = 0;
      for (const [spellIdStr, known] of Object.entries(entryRecipes)) {
        if (known) {
          recipeCount++;
          pObj.recipeSet.add(Number(spellIdStr));
        }
      }

      pObj.crafters.push({
        char: fullChar,
        fullName,
        firstName,
        shortName,
        lastName,
        realm,
        skill,
        max,
        recipeCount,
        ts
      });
    }

    const professionsList = [];
    for (const pObj of profMap.values()) {
      // Sort crafters by skill desc, then fullName asc
      pObj.crafters.sort((a, b) => {
        if (b.skill !== a.skill) return b.skill - a.skill;
        return a.fullName.localeCompare(b.fullName);
      });

      professionsList.push({
        id: pObj.id,
        name: pObj.name,
        isSecondary: pObj.isSecondary,
        recipeCount: pObj.recipeSet.size,
        crafters: pObj.crafters
      });
    }
    // Sort professions alphabetically by name
    professionsList.sort((a, b) => a.name.localeCompare(b.name));

    // 3. Recipes known by at least 1 active crafter in this guild
    const guildRecipeCrafters = new Map(); // spellId -> [ { char, fullName, firstName, shortName, lastName, realm, skill, max, ts } ]
    const spellProfFallback = new Map(); // spellId -> profId

    for (const entry of activeEntries) {
      const fullChar = String(entry.char || '');
      const dashIdx = fullChar.indexOf('-');
      const firstName = dashIdx !== -1 ? fullChar.slice(0, dashIdx) : fullChar;
      const lastName = dashIdx !== -1 ? fullChar.slice(dashIdx + 1) : '';
      const fullName = lastName ? `${firstName} ${lastName}` : firstName;
      const shortName = firstName;
      const realm = lastName;
      const skill = Number(entry.skill || 0);
      const max = Number(entry.max || 0);
      const ts = Number(entry.ts || 0);
      const profId = Number(entry.prof || 0);

      const entryRecipes = entry.recipes || {};
      for (const [spellIdStr, known] of Object.entries(entryRecipes)) {
        if (!known) continue;
        const spellId = Number(spellIdStr);
        if (!guildRecipeCrafters.has(spellId)) {
          guildRecipeCrafters.set(spellId, []);
        }
        guildRecipeCrafters.get(spellId).push({
          char: fullChar,
          fullName,
          firstName,
          shortName,
          lastName,
          realm,
          skill,
          max,
          ts
        });
        if (!spellProfFallback.has(spellId) && profId) {
          spellProfFallback.set(spellId, profId);
        }
      }
    }

    const recipesList = [];
    for (const [spellId, crafters] of guildRecipeCrafters.entries()) {
      // Sort crafters by skill desc, then fullName asc
      crafters.sort((a, b) => {
        if (b.skill !== a.skill) return b.skill - a.skill;
        return a.fullName.localeCompare(b.fullName);
      });

      const recInfo = rawRecipes[spellId] || {};
      const fallbackProf = spellProfFallback.get(spellId) || 0;
      const profId = Number(recInfo.prof || fallbackProf);
      const profName = String(profNameMap.get(profId) || recInfo.profName || 'Unknown');
      const itemId = recInfo.item != null ? Number(recInfo.item) : null;
      const isCustom = Boolean(spellId >= 400000 || (itemId != null && itemId >= 200000));

      recipesList.push({
        spellId: Number(spellId),
        name: String(recInfo.name || `Recipe #${spellId}`),
        profId,
        profName,
        itemId,
        isCustom,
        crafters
      });
    }

    // Sort recipes by profName asc, then name asc
    recipesList.sort((a, b) => {
      const pCmp = a.profName.localeCompare(b.profName);
      if (pCmp !== 0) return pCmp;
      return a.name.localeCompare(b.name);
    });

    transformedGuilds.push({
      guildKey,
      name: guildName,
      realm: guildRealm,
      professions: professionsList,
      crafters: craftersList,
      recipes: recipesList
    });
  }

  // Sort guilds by recipes.length desc
  transformedGuilds.sort((a, b) => b.recipes.length - a.recipes.length);

  return {
    exportedAt: new Date().toISOString(),
    schema: 1,
    guilds: transformedGuilds
  };
}

/**
 * Creates browser-compatible standalone IIFE string exposing window.GRBParser.
 */
export function createBrowserParserBundle() {
  return `(function(global){
  const SECONDARY_PROF_IDS = new Set([129, 185, 356, 794]);
  const KNOWN_PROFESSIONS = ${JSON.stringify(KNOWN_PROFESSIONS)};
  ${tokenizeLua.toString()}
  ${isNumberChar.toString()}
  ${isIdentStart.toString()}
  ${isIdentPart.toString()}
  ${parseLuaNumber.toString()}
  ${unescapeLuaString.toString()}
  ${parseLuaSavedVariables.toString()}
  ${mergeRawDatabases.toString()}
  ${transformGuildRecipeBook.toString()}

  global.GRBParser = {
    SECONDARY_PROF_IDS,
    KNOWN_PROFESSIONS,
    parseLuaSavedVariables,
    mergeRawDatabases,
    transformGuildRecipeBook
  };
})(typeof window !== 'undefined' ? window : globalThis);`;
}

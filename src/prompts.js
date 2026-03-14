/**
 * Prompts Module
 * Manages default + custom prompt pools
 */

const fs = require('fs');
const path = require('path');

const CUSTOM_PROMPTS_FILE = path.join(__dirname, '../data/prompts.json');

// Default prompts from Hot Take mode
function getDefaultPrompts() {
  return require('./modes/hot-take').PROMPTS;
}

/**
 * Load custom prompts from file
 */
function loadCustomPrompts() {
  try {
    if (fs.existsSync(CUSTOM_PROMPTS_FILE)) {
      const data = fs.readFileSync(CUSTOM_PROMPTS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error loading custom prompts:', err.message);
  }
  return [];
}

/**
 * Save custom prompts to file
 */
function saveCustomPrompts(customPrompts) {
  try {
    const dir = path.dirname(CUSTOM_PROMPTS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CUSTOM_PROMPTS_FILE, JSON.stringify(customPrompts, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving custom prompts:', err.message);
    return false;
  }
}

/**
 * Validate a prompt text
 */
function validatePrompt(text) {
  const cleaned = String(text).trim();
  if (cleaned.length < 5) return null; // Minimum 5 chars
  if (cleaned.length > 200) return cleaned.slice(0, 200); // Max 200 chars
  return cleaned;
}

/**
 * Add a custom prompt
 */
function addCustomPrompt(customPrompts, text) {
  const validated = validatePrompt(text);
  if (!validated) return null;

  // Prevent duplicates (case-insensitive)
  const allPrompts = [...getDefaultPrompts(), ...customPrompts];
  const isDuplicate = allPrompts.some(p => p.toLowerCase() === validated.toLowerCase());
  if (isDuplicate) return null;

  // Max 50 custom prompts
  if (customPrompts.length >= 50) return null;

  customPrompts.push(validated);
  return validated;
}

/**
 * Remove a custom prompt by index
 */
function removeCustomPrompt(customPrompts, index) {
  if (index < 0 || index >= customPrompts.length) return false;
  customPrompts.splice(index, 1);
  return true;
}

/**
 * Get merged pool of default + custom prompts
 */
function getMergedPrompts(customPrompts = []) {
  return [...getDefaultPrompts(), ...customPrompts];
}

/**
 * Pick a prompt from merged pool, avoiding recently used
 */
function pickPrompt(game, customPrompts = []) {
  const allPrompts = getMergedPrompts(customPrompts);
  const available = allPrompts.filter(p => !game.usedPrompts.includes(p));

  // Cycle if all used
  if (available.length === 0) {
    game.usedPrompts = [];
  }

  const pool = available.length > 0 ? available : allPrompts;
  const prompt = pool[Math.floor(Math.random() * pool.length)];
  game.usedPrompts.push(prompt);
  return prompt;
}

module.exports = {
  loadCustomPrompts,
  saveCustomPrompts,
  validatePrompt,
  addCustomPrompt,
  removeCustomPrompt,
  getMergedPrompts,
  pickPrompt,
  getDefaultPrompts,
};

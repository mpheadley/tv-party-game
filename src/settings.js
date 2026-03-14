/**
 * Settings Module
 * Validates and manages game customization settings
 */

// Defaults
const DEFAULT_SETTINGS = {
  roundTime: 60,      // seconds
  voteTime: 20,       // seconds
  totalRounds: 10,
  useCustomPrompts: false,
  customPromptList: [],
};

// Validation ranges
const RANGES = {
  roundTime: { min: 20, max: 180 },   // 20 sec - 3 min
  voteTime: { min: 10, max: 60 },     // 10 sec - 1 min
  totalRounds: { min: 3, max: 20 },   // 3-20 rounds
};

/**
 * Validate a setting value
 */
function validateSetting(key, value) {
  if (!(key in RANGES)) return null;

  const num = parseInt(value, 10);
  if (isNaN(num)) return null;

  const { min, max } = RANGES[key];
  if (num < min || num > max) return null;

  return num;
}

/**
 * Validate and update settings object
 */
function updateSettings(currentSettings, updates) {
  const validated = { ...currentSettings };
  let changed = false;

  for (const [key, value] of Object.entries(updates)) {
    const result = validateSetting(key, value);
    if (result !== null && result !== currentSettings[key]) {
      validated[key] = result;
      changed = true;
    }
  }

  return { settings: validated, changed };
}

/**
 * Get estimated game duration in minutes
 */
function getEstimatedDuration(settings) {
  const roundDuration = (settings.roundTime + settings.voteTime + 5) / 60; // +5s buffer
  return Math.round(roundDuration * settings.totalRounds);
}

module.exports = {
  DEFAULT_SETTINGS,
  RANGES,
  validateSetting,
  updateSettings,
  getEstimatedDuration,
};

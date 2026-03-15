/**
 * Night Falls 🐺 — Werewolf / Mafia Mode
 * Role-based social deduction game with night/day phases
 */

// ── Role Definitions ──
const ROLES = {
  werewolf:  { name: 'Werewolf',  emoji: '🐺', team: 'evil',    hasNightAction: true },
  villager:  { name: 'Villager',  emoji: '👤', team: 'good',    hasNightAction: false },
  seer:      { name: 'Seer',      emoji: '🔮', team: 'good',    hasNightAction: true },
  doctor:    { name: 'Doctor',    emoji: '💊', team: 'good',    hasNightAction: true },
  hunter:    { name: 'Hunter',    emoji: '🏹', team: 'good',    hasNightAction: false },
  witch:     { name: 'Witch',     emoji: '🧙', team: 'good',    hasNightAction: true },
  cupid:     { name: 'Cupid',     emoji: '💘', team: 'good',    hasNightAction: true },
  jester:    { name: 'Jester',    emoji: '🃏', team: 'neutral', hasNightAction: false },
  bodyguard: { name: 'Bodyguard', emoji: '🛡️', team: 'good',    hasNightAction: true },
};

// ── Role Distribution by Player Count ──
const ROLE_DISTRIBUTION = [
  { min: 5,  max: 6,  werewolves: 1, specials: ['seer', 'doctor'] },
  { min: 7,  max: 8,  werewolves: 2, specials: ['seer', 'doctor', 'hunter'] },
  { min: 9,  max: 10, werewolves: 2, specials: ['seer', 'doctor', 'hunter', 'witch'] },
  { min: 11, max: 13, werewolves: 3, specials: ['seer', 'doctor', 'hunter', 'witch', 'cupid'] },
  { min: 14, max: 16, werewolves: 3, specials: ['seer', 'doctor', 'hunter', 'witch', 'cupid', 'jester', 'bodyguard'] },
];

// ── Night Falls Game State ──
function createNightFallsState() {
  return {
    nightNumber: 0,
    roles: {},              // { playerId: 'werewolf' | 'villager' | ... }
    alive: {},              // { playerId: true }
    eliminated: [],         // [{ id, name, avatar, role, eliminatedBy: 'night'|'vote'|'hunter'|'witch' }]

    // Night actions (collected simultaneously)
    nightActions: {
      werewolfVotes: {},    // { wolfId: targetId }
      seerTarget: null,
      doctorTarget: null,
      witchHeal: false,
      witchKill: null,
      cupidPair: null,      // [id1, id2]
      bodyguardTarget: null,
    },

    // Persistent state across nights
    lastDoctorTarget: null, // Can't protect same person twice in a row
    witchHealUsed: false,
    witchKillUsed: false,
    cupidLovers: null,      // [id1, id2] — set on first night
    hunterPending: null,    // Set when hunter is eliminated, needs to pick target

    // Config
    enabledRoles: [],       // Roles enabled by host
    nightDuration: 25,      // seconds
    discussionDuration: 120,
    voteDuration: 30,

    // Day vote
    dayVotes: {},           // { voterId: targetId | 'skip' }
  };
}

/**
 * Assign roles to players based on count and enabled roles
 */
function assignRoles(playerIds, enabledRoles) {
  const count = playerIds.length;
  const dist = ROLE_DISTRIBUTION.find(d => count >= d.min && count <= d.max);
  if (!dist) return null;

  const roles = {};
  const shuffled = [...playerIds].sort(() => Math.random() - 0.5);
  let idx = 0;

  // Assign werewolves
  for (let i = 0; i < dist.werewolves; i++) {
    roles[shuffled[idx++]] = 'werewolf';
  }

  // Assign special roles (only if enabled)
  for (const role of dist.specials) {
    if (enabledRoles.includes(role) && idx < shuffled.length) {
      roles[shuffled[idx++]] = role;
    }
  }

  // Fill remaining with villagers
  while (idx < shuffled.length) {
    roles[shuffled[idx++]] = 'villager';
  }

  return roles;
}

/**
 * Get role info to send to a specific player
 */
function getRoleInfo(nfState, playerId, players) {
  const role = nfState.roles[playerId];
  const roleDef = ROLES[role];
  const info = {
    role,
    roleName: roleDef.name,
    emoji: roleDef.emoji,
    team: roleDef.team,
    description: getRoleDescription(role),
  };

  // Werewolves see their packmates
  if (role === 'werewolf') {
    info.teammates = Object.entries(nfState.roles)
      .filter(([id, r]) => r === 'werewolf' && id !== playerId)
      .map(([id]) => ({
        id,
        name: players[id]?.name || 'Unknown',
        avatar: players[id]?.avatar || '',
      }));
  }

  return info;
}

function getRoleDescription(role) {
  switch (role) {
    case 'werewolf': return 'Eliminate the villagers before they find you.';
    case 'villager': return 'Find and eliminate the werewolves through discussion and voting.';
    case 'seer': return 'Each night, investigate one player to learn if they are good or evil.';
    case 'doctor': return 'Each night, protect one player from elimination. Can\'t pick the same player twice in a row.';
    case 'hunter': return 'When you are eliminated, you take one other player down with you.';
    case 'witch': return 'You have one heal potion and one kill potion — each usable once per game.';
    case 'cupid': return 'On the first night, pair two players as lovers. If one dies, both die.';
    case 'jester': return 'Win by getting voted out during the day. Trick the village!';
    case 'bodyguard': return 'Protect a player each night — but if they\'re attacked, you die instead.';
    default: return '';
  }
}

/**
 * Get the night phase prompt for a specific player
 */
function getNightPrompt(nfState, playerId, players) {
  const role = nfState.roles[playerId];
  const alivePlayers = getAlivePlayers(nfState, players, playerId);

  const prompt = {
    role,
    roleName: ROLES[role].name,
    emoji: ROLES[role].emoji,
    alivePlayers,
    nightNumber: nfState.nightNumber,
  };

  switch (role) {
    case 'werewolf': {
      // Show other wolves' votes
      const wolfVotes = {};
      for (const [wolfId, targetId] of Object.entries(nfState.nightActions.werewolfVotes)) {
        if (wolfId !== playerId && players[wolfId]) {
          wolfVotes[wolfId] = {
            voterName: players[wolfId].name,
            voterAvatar: players[wolfId].avatar,
            targetName: players[targetId]?.name || 'Unknown',
          };
        }
      }
      prompt.wolfVotes = wolfVotes;
      prompt.action = 'choose-target';
      break;
    }
    case 'seer':
      prompt.action = 'investigate';
      break;
    case 'doctor':
      prompt.action = 'protect';
      prompt.lastTarget = nfState.lastDoctorTarget;
      break;
    case 'witch': {
      // Witch sees who was attacked (resolved wolf target)
      const wolfTarget = resolveWolfTarget(nfState);
      prompt.action = 'witch-choose';
      prompt.attackedPlayer = wolfTarget ? {
        id: wolfTarget,
        name: players[wolfTarget]?.name || 'Unknown',
        avatar: players[wolfTarget]?.avatar || '',
      } : null;
      prompt.hasHealPotion = !nfState.witchHealUsed;
      prompt.hasKillPotion = !nfState.witchKillUsed;
      break;
    }
    case 'cupid':
      if (nfState.nightNumber === 1 && !nfState.cupidLovers) {
        prompt.action = 'pair-lovers';
        // Cupid can pair anyone, including themselves
        prompt.allAlivePlayers = Object.keys(nfState.alive)
          .filter(id => nfState.alive[id])
          .map(id => ({ id, name: players[id]?.name || 'Unknown', avatar: players[id]?.avatar || '' }));
      } else {
        prompt.action = 'sleep';
      }
      break;
    case 'bodyguard':
      prompt.action = 'protect';
      break;
    default:
      prompt.action = 'sleep';
  }

  return prompt;
}

/**
 * Get list of alive players (excluding self, optionally)
 */
function getAlivePlayers(nfState, players, excludeId) {
  return Object.keys(nfState.alive)
    .filter(id => nfState.alive[id] && id !== excludeId)
    .map(id => ({
      id,
      name: players[id]?.name || 'Unknown',
      avatar: players[id]?.avatar || '',
    }));
}

/**
 * Get all alive players including self
 */
function getAllAlivePlayers(nfState, players) {
  return Object.keys(nfState.alive)
    .filter(id => nfState.alive[id])
    .map(id => ({
      id,
      name: players[id]?.name || 'Unknown',
      avatar: players[id]?.avatar || '',
    }));
}

/**
 * Resolve werewolf target (majority vote among wolves)
 */
function resolveWolfTarget(nfState) {
  const votes = Object.values(nfState.nightActions.werewolfVotes);
  if (votes.length === 0) return null;

  // Count votes
  const counts = {};
  for (const target of votes) {
    counts[target] = (counts[target] || 0) + 1;
  }

  // Find max
  let maxVotes = 0;
  let targets = [];
  for (const [target, count] of Object.entries(counts)) {
    if (count > maxVotes) {
      maxVotes = count;
      targets = [target];
    } else if (count === maxVotes) {
      targets.push(target);
    }
  }

  // Random among ties
  return targets[Math.floor(Math.random() * targets.length)];
}

/**
 * Resolve all night actions and determine outcomes
 * Returns: { eliminated: [{id, name, avatar, role}], survived: boolean, events: [] }
 */
function resolveNight(nfState, players) {
  const results = { eliminated: [], survived: true, events: [] };

  // 1. Determine wolf target
  const wolfTarget = resolveWolfTarget(nfState);

  // 2. Check doctor protection
  const doctorProtected = nfState.nightActions.doctorTarget;

  // 3. Check bodyguard protection
  const bodyguardProtected = nfState.nightActions.bodyguardTarget;

  // 4. Apply witch actions
  let witchHealed = null;
  let witchKilled = null;

  if (nfState.nightActions.witchHeal && wolfTarget) {
    witchHealed = wolfTarget;
    nfState.witchHealUsed = true;
  }
  if (nfState.nightActions.witchKill) {
    witchKilled = nfState.nightActions.witchKill;
    nfState.witchKillUsed = true;
  }

  // 5. Resolve wolf kill
  if (wolfTarget) {
    const isProtected = wolfTarget === doctorProtected ||
                        wolfTarget === witchHealed ||
                        wolfTarget === bodyguardProtected;

    if (isProtected) {
      results.events.push({ type: 'protected', targetId: wolfTarget });
      results.survived = true;

      // Bodyguard dies if they protected the target
      if (wolfTarget === bodyguardProtected) {
        eliminatePlayer(nfState, bodyguardProtected, players, results, 'bodyguard-sacrifice');
      }
    } else {
      eliminatePlayer(nfState, wolfTarget, players, results, 'night');
    }
  }

  // 6. Resolve witch kill
  if (witchKilled && nfState.alive[witchKilled]) {
    eliminatePlayer(nfState, witchKilled, players, results, 'witch');
  }

  // 7. Handle cupid pair on first night
  if (nfState.nightNumber === 1 && nfState.nightActions.cupidPair) {
    nfState.cupidLovers = nfState.nightActions.cupidPair;
  }

  // 8. Check lover deaths
  if (nfState.cupidLovers) {
    for (const eliminated of [...results.eliminated]) {
      if (nfState.cupidLovers.includes(eliminated.id)) {
        const loverId = nfState.cupidLovers.find(id => id !== eliminated.id);
        if (loverId && nfState.alive[loverId]) {
          eliminatePlayer(nfState, loverId, players, results, 'heartbreak');
          results.events.push({ type: 'heartbreak', targetId: loverId });
        }
      }
    }
  }

  // Update doctor's last target
  nfState.lastDoctorTarget = nfState.nightActions.doctorTarget;

  // Reset night actions
  nfState.nightActions = {
    werewolfVotes: {},
    seerTarget: null,
    doctorTarget: null,
    witchHeal: false,
    witchKill: null,
    cupidPair: null,
    bodyguardTarget: null,
  };

  results.survived = results.eliminated.length === 0;
  return results;
}

function eliminatePlayer(nfState, playerId, players, results, cause) {
  if (!nfState.alive[playerId]) return;
  nfState.alive[playerId] = false;
  const player = players[playerId];
  const role = nfState.roles[playerId];
  const entry = {
    id: playerId,
    name: player?.name || 'Unknown',
    avatar: player?.avatar || '',
    role,
    roleName: ROLES[role]?.name || role,
    roleEmoji: ROLES[role]?.emoji || '',
    cause,
  };
  nfState.eliminated.push(entry);
  results.eliminated.push(entry);

  // Hunter triggers
  if (role === 'hunter') {
    nfState.hunterPending = playerId;
  }
}

/**
 * Resolve day vote
 * Returns: { ejected: null | {id, name, avatar, role, ...}, tie: boolean, voteTally: {} }
 */
function resolveDayVote(nfState, players) {
  const voteTally = {};
  let skipCount = 0;

  for (const [voterId, targetId] of Object.entries(nfState.dayVotes)) {
    if (targetId === 'skip') {
      skipCount++;
    } else {
      voteTally[targetId] = (voteTally[targetId] || 0) + 1;
    }
  }

  // Find max votes
  let maxVotes = skipCount; // Skip counts as a "candidate"
  let ejectedId = null;

  for (const [targetId, count] of Object.entries(voteTally)) {
    if (count > maxVotes) {
      maxVotes = count;
      ejectedId = targetId;
    } else if (count === maxVotes) {
      ejectedId = null; // Tie = no ejection
    }
  }

  const results = { ejected: null, tie: false, voteTally, skipCount };

  if (ejectedId && nfState.alive[ejectedId]) {
    const dummyResults = { eliminated: [] };
    eliminatePlayer(nfState, ejectedId, players, dummyResults, 'vote');
    results.ejected = dummyResults.eliminated[0];

    // Check jester win
    if (nfState.roles[ejectedId] === 'jester') {
      results.jesterWin = true;
    }

    // Check hunter trigger
    if (nfState.roles[ejectedId] === 'hunter') {
      nfState.hunterPending = ejectedId;
    }

    // Check lover death
    if (nfState.cupidLovers && nfState.cupidLovers.includes(ejectedId)) {
      const loverId = nfState.cupidLovers.find(id => id !== ejectedId);
      if (loverId && nfState.alive[loverId]) {
        eliminatePlayer(nfState, loverId, players, dummyResults, 'heartbreak');
        results.loverDeath = dummyResults.eliminated.find(e => e.id === loverId);
      }
    }
  } else if (!ejectedId && Object.keys(voteTally).length > 0) {
    results.tie = true;
  }

  // Reset day votes
  nfState.dayVotes = {};

  return results;
}

/**
 * Hunter picks their revenge target
 */
function resolveHunterShot(nfState, targetId, players) {
  if (!nfState.hunterPending) return null;
  nfState.hunterPending = null;

  if (!targetId || !nfState.alive[targetId]) return null;

  const results = { eliminated: [] };
  eliminatePlayer(nfState, targetId, players, results, 'hunter');

  // Check lover death from hunter shot
  if (nfState.cupidLovers && nfState.cupidLovers.includes(targetId)) {
    const loverId = nfState.cupidLovers.find(id => id !== targetId);
    if (loverId && nfState.alive[loverId]) {
      eliminatePlayer(nfState, loverId, players, results, 'heartbreak');
    }
  }

  return results.eliminated;
}

/**
 * Check win conditions
 * Returns: null | { winner: 'villagers'|'werewolves'|'jester', reason: string }
 */
function checkWinCondition(nfState) {
  const aliveIds = Object.keys(nfState.alive).filter(id => nfState.alive[id]);
  const aliveWolves = aliveIds.filter(id => nfState.roles[id] === 'werewolf');
  const aliveGood = aliveIds.filter(id => nfState.roles[id] !== 'werewolf');

  if (aliveWolves.length === 0) {
    return { winner: 'villagers', reason: 'All werewolves have been eliminated!' };
  }

  if (aliveWolves.length >= aliveGood.length) {
    return { winner: 'werewolves', reason: 'The werewolves outnumber the villagers!' };
  }

  return null;
}

/**
 * Check if all required night actions are submitted
 */
function checkAllNightActionsSubmitted(nfState) {
  const aliveIds = Object.keys(nfState.alive).filter(id => nfState.alive[id]);

  for (const id of aliveIds) {
    const role = nfState.roles[id];
    switch (role) {
      case 'werewolf':
        if (!nfState.nightActions.werewolfVotes[id]) return false;
        break;
      case 'seer':
        if (nfState.nightActions.seerTarget === null) return false;
        break;
      case 'doctor':
        if (nfState.nightActions.doctorTarget === null) return false;
        break;
      case 'witch':
        // Witch action is optional — don't wait for it
        break;
      case 'cupid':
        if (nfState.nightNumber === 1 && !nfState.cupidLovers && !nfState.nightActions.cupidPair) return false;
        break;
      case 'bodyguard':
        if (nfState.nightActions.bodyguardTarget === null) return false;
        break;
    }
  }

  return true;
}

/**
 * Check if all alive players have voted during day
 */
function checkAllDayVotes(nfState) {
  const aliveIds = Object.keys(nfState.alive).filter(id => nfState.alive[id]);
  return aliveIds.every(id => nfState.dayVotes[id] !== undefined);
}

/**
 * Get data for TV display during various phases
 */
function getTVData(nfState, players, phase) {
  const alivePlayers = getAllAlivePlayers(nfState, players);
  const eliminatedList = nfState.eliminated.map(e => ({
    name: e.name,
    avatar: e.avatar,
    role: e.roleName,
    roleEmoji: e.roleEmoji,
  }));

  return {
    phase,
    nightNumber: nfState.nightNumber,
    alivePlayers,
    eliminatedPlayers: eliminatedList,
    aliveCount: alivePlayers.length,
  };
}

/**
 * Get the full role reveal for game over
 */
function getAllRoles(nfState, players) {
  return Object.entries(nfState.roles).map(([id, role]) => ({
    id,
    name: players[id]?.name || 'Unknown',
    avatar: players[id]?.avatar || '',
    role,
    roleName: ROLES[role].name,
    roleEmoji: ROLES[role].emoji,
    alive: !!nfState.alive[id],
  }));
}

module.exports = {
  ROLES,
  ROLE_DISTRIBUTION,
  createNightFallsState,
  assignRoles,
  getRoleInfo,
  getNightPrompt,
  getAlivePlayers,
  getAllAlivePlayers,
  resolveWolfTarget,
  resolveNight,
  resolveDayVote,
  resolveHunterShot,
  checkWinCondition,
  checkAllNightActionsSubmitted,
  checkAllDayVotes,
  getTVData,
  getAllRoles,
};

/**
 * Teams Module
 * Handles team creation, assignment, rotation, and scoring
 */

const TEAM_COLORS = [
  '#506be6', // indigo
  '#f093fb', // pink
  '#4facfe', // blue
  '#43e97b', // green
  '#fa709a', // coral
  '#fee140', // yellow
];

/**
 * Create teams for a game
 */
function createTeams(teamCount) {
  const teams = {};
  for (let i = 0; i < teamCount; i++) {
    const teamId = `team-${i}`;
    teams[teamId] = {
      id: teamId,
      name: `Team ${String.fromCharCode(65 + i)}`, // A, B, C...
      color: TEAM_COLORS[i % TEAM_COLORS.length],
      players: [],
      score: 0,
      currentAnswerIndex: 0,
    };
  }
  return teams;
}

/**
 * Get the next team to have a player answer
 * Rotates through teams sequentially
 */
function getNextAnsweringTeam(teams, lastAnsweringTeamId) {
  const teamIds = Object.keys(teams);
  if (teamIds.length === 0) return null;

  if (!lastAnsweringTeamId) return teamIds[0];

  const currentIndex = teamIds.indexOf(lastAnsweringTeamId);
  return teamIds[(currentIndex + 1) % teamIds.length];
}

/**
 * Get the player from a team who should answer next
 * Rotates through team members
 */
function getNextAnswerer(team) {
  if (team.players.length === 0) return null;

  const playerId = team.players[team.currentAnswerIndex];
  team.currentAnswerIndex = (team.currentAnswerIndex + 1) % team.players.length;
  return playerId;
}

/**
 * Assign a player to a team
 */
function assignPlayerToTeam(teams, teamId, playerId) {
  if (!teams[teamId]) return false;

  const team = teams[teamId];
  if (!team.players.includes(playerId)) {
    team.players.push(playerId);
  }
  return true;
}

/**
 * Remove a player from all teams
 */
function removePlayerFromTeams(teams, playerId) {
  for (const team of Object.values(teams)) {
    const index = team.players.indexOf(playerId);
    if (index > -1) {
      team.players.splice(index, 1);
      // Reset rotation if we removed the current answerer
      if (team.currentAnswerIndex >= team.players.length) {
        team.currentAnswerIndex = 0;
      }
    }
  }
}

/**
 * Get team by player ID
 */
function getTeamByPlayerId(teams, playerId) {
  for (const team of Object.values(teams)) {
    if (team.players.includes(playerId)) {
      return team;
    }
  }
  return null;
}

/**
 * Score a round for a team (all players on team get points)
 */
function scoreTeamRound(teams, playerId, points) {
  const team = getTeamByPlayerId(teams, playerId);
  if (team) {
    team.score += points;
  }
}

/**
 * Get team info for scoreboard (sorted by score)
 */
function getTeamScoreboard(teams) {
  return Object.values(teams)
    .filter(t => t.players.length > 0) // Only teams with players
    .map(t => ({
      id: t.id,
      name: t.name,
      color: t.color,
      score: t.score,
      playerCount: t.players.length,
    }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Get smallest team (for balancing)
 */
function getSmallestTeam(teams) {
  let smallest = null;
  let minSize = Infinity;

  for (const team of Object.values(teams)) {
    if (team.players.length < minSize) {
      smallest = team;
      minSize = team.players.length;
    }
  }

  return smallest;
}

module.exports = {
  createTeams,
  getNextAnsweringTeam,
  getNextAnswerer,
  assignPlayerToTeam,
  removePlayerFromTeams,
  getTeamByPlayerId,
  scoreTeamRound,
  getTeamScoreboard,
  getSmallestTeam,
  TEAM_COLORS,
};

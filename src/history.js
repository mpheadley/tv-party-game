/**
 * Game history — SQLite persistence for drawings, scores, all-time leaderboard
 */
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/history.db');
let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_code TEXT NOT NULL,
      mode TEXT NOT NULL,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME,
      total_rounds INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS drawings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      round_num INTEGER NOT NULL,
      prompt TEXT NOT NULL,
      player_name TEXT NOT NULL,
      player_avatar TEXT,
      image_data TEXT NOT NULL,
      votes INTEGER DEFAULT 0,
      ai_score INTEGER,
      ai_comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (game_id) REFERENCES games(id)
    );

    CREATE TABLE IF NOT EXISTS player_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      player_name TEXT NOT NULL,
      player_avatar TEXT,
      total_score INTEGER DEFAULT 0,
      FOREIGN KEY (game_id) REFERENCES games(id)
    );
  `);
}

function startGame(roomCode, mode) {
  const db = getDb();
  const result = db.prepare('INSERT INTO games (room_code, mode) VALUES (?, ?)').run(roomCode, mode);
  return result.lastInsertRowid;
}

function endGame(gameId, totalRounds) {
  const db = getDb();
  db.prepare('UPDATE games SET ended_at = CURRENT_TIMESTAMP, total_rounds = ? WHERE id = ?').run(totalRounds, gameId);
}

function saveDrawing({ gameId, roundNum, prompt, playerName, playerAvatar, imageData, votes = 0, aiScore = null, aiComment = null }) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO drawings (game_id, round_num, prompt, player_name, player_avatar, image_data, votes, ai_score, ai_comment)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(gameId, roundNum, prompt, playerName, playerAvatar, imageData, votes, aiScore, aiComment).lastInsertRowid;
}

function savePlayerScores(gameId, scoreboard) {
  const db = getDb();
  const stmt = db.prepare('INSERT INTO player_scores (game_id, player_name, player_avatar, total_score) VALUES (?, ?, ?, ?)');
  for (const p of scoreboard) {
    stmt.run(gameId, p.name, p.avatar, p.score);
  }
}

function getRecentDrawings(limit = 20) {
  const db = getDb();
  return db.prepare(`
    SELECT d.*, g.room_code, g.mode
    FROM drawings d
    JOIN games g ON d.game_id = g.id
    ORDER BY d.created_at DESC
    LIMIT ?
  `).all(limit);
}

function getAllTimeLeaderboard(limit = 10) {
  const db = getDb();
  return db.prepare(`
    SELECT player_name, player_avatar,
           SUM(total_score) as lifetime_score,
           COUNT(*) as games_played,
           MAX(total_score) as best_game
    FROM player_scores
    GROUP BY player_name
    ORDER BY lifetime_score DESC
    LIMIT ?
  `).all(limit);
}

function getTopDrawings(limit = 12) {
  const db = getDb();
  return db.prepare(`
    SELECT d.*, g.room_code
    FROM drawings d
    JOIN games g ON d.game_id = g.id
    WHERE d.ai_score IS NOT NULL
    ORDER BY d.ai_score DESC
    LIMIT ?
  `).all(limit);
}

module.exports = { startGame, endGame, saveDrawing, savePlayerScores, getRecentDrawings, getAllTimeLeaderboard, getTopDrawings };

/**
 * Bot Players Module
 * Server-side bots that connect via socket.io-client to simulate real players.
 * Supports Hot Take, Speed Drawing, Pictionary, and Night Falls modes.
 */

const ioClient = require('socket.io-client');

const BOT_NAMES = [
  'Botsworth', 'Clankbot', 'Sir Beeps', 'Rusty', 'Sparky',
  'Glitch', 'Widget', 'Byte', 'Pixel', 'Chip',
  'Turbo', 'Blip', 'Gizmo', 'Nano', 'Cog',
];

const BOT_ANSWERS = {
  'hot-take': [
    'Honestly, I blame the cat.',
    'That sounds like a Tuesday.',
    'My therapist warned me about this.',
    'Have we tried turning it off and on again?',
    'Bold move, Cotton.',
    'I plead the fifth.',
    'According to my calculations... nah.',
    'Is this a trick question?',
    'I asked ChatGPT and it said no.',
    'This is above my pay grade.',
    'I choose chaos.',
    'That\'s what she said. Wait, wrong show.',
    'The vibes are off and I\'m leaving.',
    'Counterpoint: tacos.',
    'I\'m going to need a bigger boat.',
    'In this economy?!',
    'My mom said I\'m special.',
    'I was told there would be snacks.',
    'Google it, you coward.',
    'The answer is always pizza.',
  ],
};

// Tiny 1x1 white PNG as base64 for speed drawing submissions
const TINY_DRAWING = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Create bot players and connect them to a room.
 * @param {string} serverUrl - e.g. 'http://localhost:3000'
 * @param {string} roomCode - 4-letter room code
 * @param {number} count - number of bots to add (default 3)
 * @returns {object} { bots: [], cleanup: Function }
 */
function createBots(serverUrl, roomCode, count = 3) {
  const bots = [];
  const usedNames = new Set();

  for (let i = 0; i < count; i++) {
    let name;
    do {
      name = pickRandom(BOT_NAMES);
    } while (usedNames.has(name));
    usedNames.add(name);

    const bot = createBot(serverUrl, roomCode, name);
    bots.push(bot);
  }

  return {
    bots,
    cleanup: () => bots.forEach(b => b.disconnect()),
  };
}

function createBot(serverUrl, roomCode, name) {
  const socket = ioClient(serverUrl, {
    transports: ['websocket'],
    forceNew: true,
  });

  let gameMode = 'hot-take';
  let isDrawer = false;
  let hasAnswered = false;
  let hasVoted = false;

  socket.on('connect', () => {
    console.log(`[BOT] ${name} connecting to room ${roomCode}...`);
    socket.emit('join', { name, roomCode });
  });

  socket.on('joined', (data) => {
    console.log(`[BOT] ${name} joined as ${data.avatar}`);
  });

  socket.on('phase', (data) => {
    gameMode = data.gameMode || gameMode;

    switch (data.phase) {
      case 'prompt':
        hasAnswered = false;
        hasVoted = false;
        isDrawer = data.currentDrawer === socket.id;
        handlePrompt(socket, name, gameMode, isDrawer, data);
        break;

      case 'vote':
        hasVoted = false;
        handleVote(socket, name, gameMode, isDrawer, data);
        break;

      case 'results':
      case 'gameover':
        // Nothing to do — just wait
        break;

      // Night Falls phases
      case 'nf-role-reveal':
        break; // Wait for role assignment
      case 'nf-day-vote':
        handleNFDayVote(socket, name, data);
        break;
    }
  });

  // Night Falls role
  socket.on('nf-role-assigned', (roleInfo) => {
    console.log(`[BOT] ${name} is ${roleInfo.roleEmoji} ${roleInfo.roleName}`);
  });

  // Night Falls night prompt
  socket.on('nf-night-prompt', (prompt) => {
    handleNFNightAction(socket, name, prompt);
  });

  // Night Falls hunter trigger
  socket.on('nf-hunter-trigger', (data) => {
    if (data.alivePlayers && data.alivePlayers.length > 0) {
      const target = pickRandom(data.alivePlayers);
      setTimeout(() => {
        socket.emit('hunter-target', { targetId: target.id });
        console.log(`[BOT] ${name} (Hunter) targets ${target.name}`);
      }, randomDelay(1000, 3000));
    }
  });

  socket.on('error-msg', (msg) => {
    console.log(`[BOT] ${name} error: ${msg}`);
  });

  socket.on('disconnect', () => {
    console.log(`[BOT] ${name} disconnected`);
  });

  return {
    name,
    socket,
    disconnect: () => socket.disconnect(),
  };
}

function handlePrompt(socket, name, gameMode, isDrawer, data) {
  // Delay to simulate thinking
  const delay = randomDelay(2000, 8000);

  setTimeout(() => {
    if (gameMode === 'pictionary') {
      if (isDrawer) {
        // Drawer submits a drawing — in real game this streams, but bots just submit
        socket.emit('answer', TINY_DRAWING);
        console.log(`[BOT] ${name} submitted drawing (pictionary drawer)`);
      } else {
        // Guessers submit text guesses
        const guesses = [
          'A cat?', 'Is that a house?', 'Looks like a dog', 'A tree!',
          'Some kind of animal', 'A person', 'Is that food?', 'A car maybe',
          'That\'s definitely a fish', 'A mountain?', 'The sun?', 'A flower',
        ];
        socket.emit('answer', pickRandom(guesses));
        console.log(`[BOT] ${name} guessed (pictionary)`);
      }
    } else if (gameMode === 'speed-drawing') {
      socket.emit('answer', TINY_DRAWING);
      console.log(`[BOT] ${name} submitted drawing (speed drawing)`);
    } else {
      // Hot Take — text answer
      socket.emit('answer', pickRandom(BOT_ANSWERS['hot-take']));
      console.log(`[BOT] ${name} answered (hot-take)`);
    }
  }, delay);
}

function handleVote(socket, name, gameMode, isDrawer, data) {
  if (!data.answers || data.answers.length === 0) return;

  const delay = randomDelay(1000, 5000);

  setTimeout(() => {
    if (gameMode === 'pictionary' && isDrawer) {
      // Drawer approves/rejects each guess
      for (const answer of data.answers) {
        const approved = Math.random() > 0.5;
        setTimeout(() => {
          socket.emit('vote', { guesserId: answer.id, approved });
          console.log(`[BOT] ${name} ${approved ? 'approved' : 'rejected'} guess from ${answer.id}`);
        }, randomDelay(300, 1000));
      }
    } else {
      // Pick a random answer to vote for
      const choice = pickRandom(data.answers);
      socket.emit('vote', choice.id);
      console.log(`[BOT] ${name} voted`);
    }
  }, delay);
}

function handleNFDayVote(socket, name, data) {
  if (!data.alivePlayers || data.alivePlayers.length === 0) return;

  const delay = randomDelay(2000, 8000);

  setTimeout(() => {
    // 20% chance to skip, 80% chance to vote someone
    if (Math.random() < 0.2) {
      socket.emit('day-vote', { targetId: 'skip' });
      console.log(`[BOT] ${name} voted to skip`);
    } else {
      // Vote for someone other than self
      const others = data.alivePlayers.filter(p => p.id !== socket.id);
      if (others.length > 0) {
        const target = pickRandom(others);
        socket.emit('day-vote', { targetId: target.id });
        console.log(`[BOT] ${name} voted to eliminate ${target.name}`);
      } else {
        socket.emit('day-vote', { targetId: 'skip' });
      }
    }
  }, delay);
}

function handleNFNightAction(socket, name, prompt) {
  if (!prompt || prompt.action === 'spectator' || prompt.action === 'sleep') return;

  const delay = randomDelay(1000, 4000);

  setTimeout(() => {
    switch (prompt.action) {
      case 'eliminate': // Werewolf
        if (prompt.targets && prompt.targets.length > 0) {
          const target = pickRandom(prompt.targets);
          socket.emit('night-action', { action: 'eliminate', targetId: target.id });
          console.log(`[BOT] ${name} (Wolf) targets ${target.name}`);
        }
        break;

      case 'investigate': // Seer
        if (prompt.targets && prompt.targets.length > 0) {
          const target = pickRandom(prompt.targets);
          socket.emit('night-action', { action: 'investigate', targetId: target.id });
          console.log(`[BOT] ${name} (Seer) investigates ${target.name}`);
        }
        break;

      case 'protect': // Doctor / Bodyguard
        if (prompt.targets && prompt.targets.length > 0) {
          const target = pickRandom(prompt.targets);
          socket.emit('night-action', { action: 'protect', targetId: target.id });
          console.log(`[BOT] ${name} (Doctor) protects ${target.name}`);
        }
        break;

      case 'witch': // Witch
        // Usually skip — sometimes heal or kill
        if (prompt.canHeal && Math.random() < 0.5) {
          socket.emit('night-action', { action: 'witch-heal' });
          console.log(`[BOT] ${name} (Witch) heals`);
        } else if (prompt.canKill && prompt.targets && Math.random() < 0.3) {
          const target = pickRandom(prompt.targets);
          socket.emit('night-action', { action: 'witch-kill', targetId: target.id });
          console.log(`[BOT] ${name} (Witch) poisons ${target.name}`);
        } else {
          socket.emit('night-action', { action: 'witch-skip' });
          console.log(`[BOT] ${name} (Witch) skips`);
        }
        break;

      case 'pair-lovers': // Cupid
        if (prompt.targets && prompt.targets.length >= 2) {
          const shuffled = [...prompt.targets].sort(() => Math.random() - 0.5);
          socket.emit('night-action', {
            action: 'pair-lovers',
            lover1: shuffled[0].id,
            lover2: shuffled[1].id,
          });
          console.log(`[BOT] ${name} (Cupid) pairs ${shuffled[0].name} & ${shuffled[1].name}`);
        }
        break;
    }
  }, delay);
}

module.exports = { createBots };

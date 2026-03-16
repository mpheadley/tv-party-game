/**
 * Phone Controller — Main game logic for phone.html
 * Handles join flow, lobby, phase transitions, voting, Night Falls, and all socket events
 */
(function () {
  const socket = io();
  let myId = null;
  let phoneTimer = null;
  let hasSubmitted = false;
  let isHost = false;
  let isTestMode = false;
  let myToken = sessionStorage.getItem('hottake-token');
  let currentGameMode = 'hot-take';
  let tvConnected = false;

  // Room code from URL
  const urlParams = new URLSearchParams(window.location.search);
  const roomCode = urlParams.get('room');

  // ── Init shared modules ──
  GameSounds.init({ mode: 'phone', isMuted: () => isMuted });
  Drawing.init({
    socket,
    getHasSubmitted: () => hasSubmitted,
    setHasSubmitted: (v) => { hasSubmitted = v; },
    onSubmit: () => showScreen('answered'),
  });

  // Show room code badge
  if (roomCode) {
    const badge = document.getElementById('room-code-badge');
    badge.textContent = `Room: ${roomCode}`;
    badge.style.display = 'block';
  }

  // ── QR Code & Invite System ──
  const joinUrl = roomCode ? `${window.location.origin}/phone.html?room=${roomCode}` : '';

  function generateQR(container, size) {
    if (!roomCode || typeof qrcode === 'undefined') return;
    container.innerHTML = '';
    const qr = qrcode(0, 'M');
    qr.addData(joinUrl);
    qr.make();
    container.innerHTML = qr.createSvgTag({ cellSize: size, margin: 2 });
  }

  const floatingBadge = document.getElementById('floating-room-badge');
  if (roomCode) floatingBadge.textContent = roomCode;

  floatingBadge.addEventListener('click', openQRModal);
  document.getElementById('btn-close-qr').addEventListener('click', closeQRModal);
  document.getElementById('qr-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeQRModal();
  });

  function openQRModal() {
    const modal = document.getElementById('qr-modal');
    document.getElementById('qr-modal-code').textContent = roomCode;
    generateQR(document.getElementById('qr-modal-image'), 5);
    document.getElementById('qr-modal-url').textContent = joinUrl;
    modal.classList.remove('hidden');
  }

  function closeQRModal() {
    document.getElementById('qr-modal').classList.add('hidden');
  }

  function shareInvite() {
    if (navigator.share) {
      navigator.share({
        title: 'Join my party game!',
        text: `Join room ${roomCode} on Headley Party Games — free party games on your phone!`,
        url: joinUrl,
      }).catch(() => {});
    }
  }

  if (navigator.share && roomCode) {
    document.getElementById('btn-share-invite').style.display = 'block';
    document.getElementById('btn-share-invite').addEventListener('click', shareInvite);
    document.getElementById('btn-lobby-share').style.display = 'block';
    document.getElementById('btn-lobby-share').addEventListener('click', shareInvite);
  }

  // ── Sound & Mute ──
  let isMuted = localStorage.getItem('hottake-muted') === 'true';
  const muteBtn = document.getElementById('btn-mute');
  muteBtn.textContent = isMuted ? '🔇' : '🔊';

  muteBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    localStorage.setItem('hottake-muted', isMuted);
    muteBtn.textContent = isMuted ? '🔇' : '🔊';
    if (isMuted && 'speechSynthesis' in window) speechSynthesis.cancel();
  });

  function playSound(type) { GameSounds.playSound(type); }
  function ensureAudio() { GameSounds.ensureAudio(); }

  // Haptic feedback
  function vibrate(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  // ── Text-to-Speech (host only) ──
  let cachedVoices = [];
  if ('speechSynthesis' in window) {
    cachedVoices = speechSynthesis.getVoices();
    speechSynthesis.addEventListener('voiceschanged', () => {
      cachedVoices = speechSynthesis.getVoices();
    });
  }

  function speakPrompt(text) {
    if (isMuted || !isHost || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.9;
    utter.pitch = 0.8;
    const funVoice = cachedVoices.find(v => /Daniel|Samantha|Alex|Fred|Zarvox|Trinoids/i.test(v.name));
    if (funVoice) utter.voice = funVoice;
    speechSynthesis.speak(utter);
  }

  // ── Screens ──
  const screens = {
    join: document.getElementById('screen-join'),
    teamSelect: document.getElementById('screen-team-select'),
    waiting: document.getElementById('screen-waiting'),
    answer: document.getElementById('screen-answer'),
    draw: document.getElementById('screen-draw'),
    guess: document.getElementById('screen-guess'),
    answered: document.getElementById('screen-answered'),
    vote: document.getElementById('screen-vote'),
    pictionaryVote: document.getElementById('screen-pictionary-vote'),
    voted: document.getElementById('screen-voted'),
    roundEnd: document.getElementById('screen-round-end'),
    gameover: document.getElementById('screen-gameover'),
    'nf-role': document.getElementById('screen-nf-role'),
    'nf-night': document.getElementById('screen-nf-night'),
    'nf-spectator': document.getElementById('screen-nf-spectator'),
    'nf-discuss': document.getElementById('screen-nf-discuss'),
    'nf-vote': document.getElementById('screen-nf-vote'),
    'nf-voted': document.getElementById('screen-nf-voted'),
    'nf-dawn': document.getElementById('screen-nf-dawn'),
    'nf-hunter': document.getElementById('screen-nf-hunter'),
    'nf-gameover': document.getElementById('screen-nf-gameover'),
  };

  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.add('hidden'));
    screens[name].classList.remove('hidden');

    const hideOnScreens = ['join', 'teamSelect', 'reconnect'];
    if (roomCode) {
      floatingBadge.style.display = hideOnScreens.includes(name) ? 'none' : 'block';
    }

    // Show exit button during active game, hide on join/reconnect
    const exitBtn = document.getElementById('btn-exit-game');
    if (exitBtn) {
      exitBtn.classList.toggle('hidden', hideOnScreens.includes(name));
    }

    const modeIndicator = document.getElementById('screen-mode-indicator');
    if (modeIndicator) {
      const modeEmoji = {
        'hot-take': '🔥',
        'speed-drawing': '🎨',
        'pictionary': '🎭',
        'night-falls': '🐺',
      }[currentGameMode] || '';
      modeIndicator.textContent = `${modeEmoji} ${currentGameMode.replace('-', ' ')}`;
    }
  }

  // ── Pictionary guess submission ──
  document.getElementById('btn-submit-guess').addEventListener('click', submitGuess);
  document.getElementById('guess-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitGuess();
  });

  function submitGuess() {
    if (hasSubmitted) return;
    const guess = document.getElementById('guess-input').value.trim();
    if (!guess) return;
    hasSubmitted = true;
    document.getElementById('btn-submit-guess').disabled = true;
    socket.emit('answer', guess);
    showScreen('answered');
  }

  // ── TV Status ──
  socket.on('tv-status', (data) => {
    tvConnected = data.connected;
  });

  // ── Game Mode Display ──
  socket.on('game-mode-updated', (mode) => {
    currentGameMode = mode;
    updateModeDisplay(mode);
    document.querySelectorAll('#phone-mode-selector .mode-button').forEach(b => {
      b.classList.toggle('selected', b.dataset.mode === mode);
    });
    const roundPicker = document.getElementById('phone-round-picker');
    if (roundPicker) roundPicker.style.display = mode === 'night-falls' ? 'none' : '';
  });

  function updateModeDisplay(mode) {
    const modeDisplay = document.getElementById('current-mode-display');
    if (!modeDisplay) return;
    const modeMap = {
      'hot-take': '🔥 Hot Take',
      'speed-drawing': '🎨 Speed Drawing',
      'pictionary': '🎭 Pictionary',
      'night-falls': '🐺 Night Falls',
    };
    modeDisplay.textContent = modeMap[mode] || mode;
  }

  updateModeDisplay(currentGameMode);

  // ── Connection Management ──
  let graceTimerInterval = null;
  let graceSecondsRemaining = 120;

  socket.on('connect', () => {
    myId = socket.id;
    showConnectionStatus('connected', '✅ Connected');
    if (myToken) {
      socket.emit('reconnect-attempt', { token: myToken, roomCode });
    }
  });

  socket.on('disconnect', () => {
    showConnectionStatus('disconnected', '⚠️  Connection lost — reconnecting...');
    startGraceTimer();
  });

  socket.on('connect_error', () => {
    showConnectionStatus('error', '❌ Connection error');
  });

  socket.on('reconnected', (data) => {
    myToken = data.token;
    document.getElementById('my-avatar').textContent = data.avatar;
    document.getElementById('waiting-name').textContent = `Welcome back, ${data.name}!`;
    if (data.isHost) setHost();
    clearGraceTimer();
    showConnectionStatus('reconnected', '✅ Reconnected!');
    if (data.phase === 'lobby') showScreen('waiting');
  });

  socket.on('reconnect-failed', () => {
    myToken = null;
    sessionStorage.removeItem('hottake-token');
    clearGraceTimer();
    showScreen('join');
  });

  socket.on('player-disconnected', (data) => {
    showStatusMessage(`${data.name} disconnected (${data.graceSeconds}s grace period)`);
  });

  socket.on('player-reconnected', (data) => {
    showStatusMessage(`✅ ${data.name} reconnected!`);
  });

  document.getElementById('btn-rejoin').addEventListener('click', () => {
    if (myToken) {
      document.getElementById('btn-rejoin').disabled = true;
      socket.emit('reconnect-attempt', myToken);
    }
  });

  document.getElementById('btn-new-session').addEventListener('click', () => {
    myToken = null;
    sessionStorage.removeItem('hottake-token');
    clearGraceTimer();
    location.reload();
  });

  function startGraceTimer() {
    graceSecondsRemaining = 120;
    if (graceTimerInterval) clearInterval(graceTimerInterval);
    document.getElementById('btn-rejoin').classList.remove('hidden');
    document.getElementById('btn-new-session').disabled = false;

    graceTimerInterval = setInterval(() => {
      graceSecondsRemaining--;
      document.getElementById('grace-timer').textContent = graceSecondsRemaining;
      if (graceSecondsRemaining <= 30) {
        document.getElementById('grace-timer').className = 'grace-timer critical';
      }
      if (graceSecondsRemaining <= 0) {
        clearGraceTimer();
        document.getElementById('btn-rejoin').classList.add('hidden');
        document.getElementById('btn-rejoin').disabled = true;
        document.getElementById('btn-new-session').disabled = true;
        showStatusMessage('Grace period expired. Starting new session...');
        setTimeout(() => {
          myToken = null;
          sessionStorage.removeItem('hottake-token');
          location.reload();
        }, 2000);
      }
    }, 1000);
  }

  function clearGraceTimer() {
    if (graceTimerInterval) {
      clearInterval(graceTimerInterval);
      graceTimerInterval = null;
    }
    document.getElementById('grace-timer').className = 'grace-timer';
    graceSecondsRemaining = 120;
  }

  function showConnectionStatus(status, message) {
    let existing = document.getElementById('connection-status-bar');
    if (existing) existing.remove();

    if (status === 'connected') {
      const bar = document.createElement('div');
      bar.id = 'connection-status-bar';
      bar.className = 'connection-status connected';
      bar.textContent = message;
      document.body.appendChild(bar);
      setTimeout(() => bar.remove(), 3000);
    } else if (status !== 'connected') {
      const bar = document.createElement('div');
      bar.id = 'connection-status-bar';
      bar.className = `connection-status ${status === 'error' ? '' : 'reconnecting'}`;
      bar.textContent = message;
      document.body.appendChild(bar);
    }
  }

  function showStatusMessage(msg) {
    const elem = document.getElementById('join-error') || document.getElementById('status');
    if (elem) {
      elem.textContent = msg;
      elem.style.color = '#506be6';
    }
  }

  // Sound events from server
  socket.on('sound', (type) => { playSound(type); });

  // ── Emoji Picker & Join Flow ──
  const AVATARS = ['🦊', '🐸', '🦉', '🐙', '🦄', '🐲', '🦋', '🐢', '🦁', '🐧', '🦖', '🐬', '🦩', '🐨', '🦝', '🐝'];
  let selectedAvatar = AVATARS[0];
  const emojiPicker = document.getElementById('emoji-picker');

  AVATARS.forEach((emoji, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'emoji-option' + (i === 0 ? ' selected' : '');
    btn.textContent = emoji;
    btn.addEventListener('click', () => {
      selectedAvatar = emoji;
      emojiPicker.querySelectorAll('.emoji-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
    emojiPicker.appendChild(btn);
  });

  setTimeout(() => document.getElementById('name-input').focus(), 300);

  const nameInput = document.getElementById('name-input');
  const btnJoin = document.getElementById('btn-join');

  btnJoin.addEventListener('click', joinGame);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinGame();
  });

  let pendingJoinData = null;
  let availableTeams = null;

  function joinGame() {
    const name = nameInput.value.trim();
    if (!name) return;
    if (!roomCode) {
      document.getElementById('join-error').textContent = 'No room code. Go back to the home page.';
      return;
    }
    ensureAudio();
    btnJoin.disabled = true;
    socket.emit('join', { name, avatar: selectedAvatar, roomCode });
  }

  socket.on('joined', (data) => {
    myToken = data.token;
    if (data.testMode) isTestMode = true;
    sessionStorage.setItem('hottake-token', data.token);
    document.getElementById('waiting-name').textContent = `Welcome, ${data.name}!`;
    document.getElementById('my-avatar').textContent = data.avatar;
    if (data.isHost) setHost();
    vibrate(100);

    if (data.team === null && availableTeams) {
      pendingJoinData = data;
      showTeamSelect();
    } else {
      showScreen('waiting');
    }
  });

  socket.on('team-mode-updated', (data) => {
    availableTeams = data.teamMode ? data.teams : null;
  });

  function showTeamSelect() {
    const teamOptions = document.getElementById('team-options');
    teamOptions.innerHTML = '';
    for (const [teamId, team] of Object.entries(availableTeams)) {
      const btn = document.createElement('button');
      btn.className = 'team-button';
      btn.style.borderColor = team.color;
      btn.style.backgroundColor = team.color + '20';
      btn.innerHTML = `<span style="font-size:2rem; margin-bottom:0.5rem;">👥</span><strong>${team.name}</strong><br><span style="opacity:0.7;">${team.players.length} player${team.players.length !== 1 ? 's' : ''}</span>`;
      btn.addEventListener('click', () => {
        socket.emit('join', { name: pendingJoinData.name, avatar: pendingJoinData.avatar, team: teamId });
        showScreen('waiting');
      });
      teamOptions.appendChild(btn);
    }
    showScreen('team-select');
  }

  socket.on('host-assigned', (data) => {
    // If broadcast with hostId (from reconnection handler), only the new host should activate
    if (data && data.hostId && data.hostId !== myId) return;
    setHost();
  });

  function setHost() {
    isHost = true;
    document.getElementById('host-lobby-controls').classList.remove('hidden');
    document.getElementById('non-host-status').classList.add('hidden');
    document.querySelectorAll('.host-only').forEach(el => el.classList.remove('hidden'));
    if (roomCode) {
      const tvLink = document.getElementById('tv-link');
      tvLink.href = `/tv.html?room=${roomCode}`;
      tvLink.style.display = 'inline-block';
      const inviteSection = document.getElementById('host-invite-section');
      inviteSection.classList.remove('hidden');
      generateQR(document.getElementById('lobby-qr'), 4);
      document.getElementById('lobby-join-url').textContent = joinUrl;
    }
  }

  socket.on('error-msg', (msg) => {
    document.getElementById('join-error').textContent = msg;
    btnJoin.disabled = false;
    showToast(msg);
    vibrate([50, 50, 50]);
  });

  function showToast(msg) {
    const existing = document.getElementById('toast-msg');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'toast-msg';
    toast.textContent = msg;
    toast.style.cssText = 'position:fixed;top:1rem;left:50%;transform:translateX(-50%);background:#ff6b6b;color:#fff;padding:0.75rem 1.5rem;border-radius:0.75rem;font-size:1rem;z-index:999;animation:fadeInSnark 0.3s ease-out;';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // ── Phase Handler ──
  socket.on('phase', (data) => {
    clearInterval(phoneTimer);

    switch (data.phase) {
      case 'lobby':
        if (document.getElementById('my-avatar').textContent) {
          showScreen('waiting');
        }
        hasSubmitted = false;
        break;

      case 'prompt':
        hasSubmitted = false;
        clearInterval(phoneTimer);

        if (data.gameMode === 'pictionary') {
          const isDrawer = data.currentDrawer === myId;
          if (isDrawer) {
            showScreen('draw');
            Drawing.initCanvas();
            document.getElementById('draw-prompt').textContent = `Draw: ${data.prompt}`;
            document.getElementById('btn-submit-drawing').disabled = false;

            if (data.timeLimit) {
              let drawTimeLeft = data.timeLimit;
              const drawTimerEl = document.getElementById('draw-timer');
              const drawTimerFill = document.getElementById('draw-timer-fill');
              drawTimerEl.textContent = drawTimeLeft + 's';
              drawTimerEl.classList.remove('timer-urgent');
              if (drawTimerFill) {
                drawTimerFill.style.transition = 'none';
                drawTimerFill.style.width = '100%';
                requestAnimationFrame(() => {
                  drawTimerFill.style.transition = `width ${data.timeLimit}s linear`;
                  drawTimerFill.style.width = '0%';
                });
              }
              clearInterval(phoneTimer);
              phoneTimer = setInterval(() => {
                drawTimeLeft--;
                drawTimerEl.textContent = Math.max(0, drawTimeLeft) + 's';
                if (drawTimeLeft <= 10) {
                  drawTimerEl.classList.add('timer-urgent');
                  if (drawTimeLeft > 0) { vibrate(50); playSound('tick'); }
                }
                if (drawTimeLeft <= 0) {
                  clearInterval(phoneTimer);
                  if (!hasSubmitted) Drawing.submitDrawing();
                }
              }, 1000);
            }
          } else {
            showScreen('guess');
            document.getElementById('guess-input').value = '';
            document.getElementById('btn-submit-guess').disabled = false;
            setTimeout(() => document.getElementById('guess-input').focus(), 100);
          }
        } else if (data.gameMode === 'speed-drawing') {
          showScreen('draw');
          Drawing.initCanvas();
          document.getElementById('draw-prompt').textContent = data.prompt;
          document.getElementById('btn-submit-drawing').disabled = false;

          if (data.timeLimit) {
            let drawTimeLeft = data.timeLimit;
            const drawTimerEl = document.getElementById('draw-timer');
            const drawTimerFill = document.getElementById('draw-timer-fill');
            drawTimerEl.textContent = drawTimeLeft + 's';
            drawTimerEl.classList.remove('timer-urgent');
            if (drawTimerFill) {
              drawTimerFill.style.transition = 'none';
              drawTimerFill.style.width = '100%';
              requestAnimationFrame(() => {
                drawTimerFill.style.transition = `width ${data.timeLimit}s linear`;
                drawTimerFill.style.width = '0%';
              });
            }
            clearInterval(phoneTimer);
            phoneTimer = setInterval(() => {
              drawTimeLeft--;
              drawTimerEl.textContent = Math.max(0, drawTimeLeft) + 's';
              if (drawTimeLeft <= 10) {
                drawTimerEl.classList.add('timer-urgent');
                if (drawTimeLeft > 0) { vibrate(50); playSound('tick'); }
              }
              if (drawTimeLeft <= 0) {
                clearInterval(phoneTimer);
                if (!hasSubmitted) Drawing.submitDrawing();
              }
            }, 1000);
          }
        } else {
          showScreen('answer');
          document.getElementById('phone-prompt').textContent = data.prompt;
          document.getElementById('answer-input').value = '';
          document.getElementById('btn-submit').disabled = false;
          setTimeout(() => document.getElementById('answer-input').focus(), 100);
        }

        vibrate(200);
        speakPrompt(data.prompt);

        // Text-answer timer (hot-take only — drawing modes have their own timers above)
        if (data.gameMode !== 'speed-drawing' && data.gameMode !== 'pictionary') {
          const timerFill = document.getElementById('phone-timer-fill');
          if (timerFill) {
            timerFill.style.transition = 'none';
            timerFill.style.width = '100%';
            requestAnimationFrame(() => {
              timerFill.style.transition = `width ${data.timeLimit}s linear`;
              timerFill.style.width = '0%';
            });
          }

          let timeLeft = data.timeLimit;
          const timerEl = document.getElementById('phone-timer');
          timerEl.textContent = timeLeft + 's';
          timerEl.classList.remove('timer-urgent');
          phoneTimer = setInterval(() => {
            timeLeft--;
            timerEl.textContent = Math.max(0, timeLeft) + 's';
            if (timeLeft <= 10) {
              timerEl.classList.add('timer-urgent');
              if (timeLeft > 0) { vibrate(50); playSound('tick'); }
            }
            if (timeLeft <= 0) {
              clearInterval(phoneTimer);
              if (!hasSubmitted) {
                const text = document.getElementById('answer-input').value.trim();
                if (text) {
                  hasSubmitted = true;
                  document.getElementById('btn-submit').disabled = true;
                  document.getElementById('my-answer-note').textContent = `Your answer: "${text}"`;
                  socket.emit('answer', text);
                  showScreen('answered');
                }
              }
            }
          }, 1000);
        }
        break;

      case 'vote':
        if (data.gameMode === 'pictionary' && data.isDrawer) {
          showScreen('pictionaryVote');
          const guessesDiv = document.getElementById('pictionary-guesses');
          guessesDiv.innerHTML = data.answers.map((a) =>
            `<div class="guess-approval" data-guesser-id="${a.id}" style="display:flex; gap:1rem; padding:1rem; background:#1a1a2e; border:1px solid #333; border-radius:0.5rem; margin:0.5rem 0; align-items:center;">
              <span style="flex:1; font-weight:bold; color:#e8e8e8;">${escapeHtml(a.text)}</span>
              <button class="btn-approve" style="background:#4CAF50; color:white; border:none; padding:0.5rem 1rem; border-radius:0.3rem; cursor:pointer;">✓ Yes</button>
              <button class="btn-reject" style="background:#f44336; color:white; border:none; padding:0.5rem 1rem; border-radius:0.3rem; cursor:pointer;">✗ No</button>
            </div>`
          ).join('');

          let votedCount = 0;
          document.querySelectorAll('.guess-approval').forEach(guessDiv => {
            const guesserId = guessDiv.dataset.guesserId;
            guessDiv.querySelector('.btn-approve').addEventListener('click', () => {
              socket.emit('vote', { guesserId, approved: true });
              guessDiv.style.opacity = '0.5';
              guessDiv.querySelector('.btn-approve').disabled = true;
              guessDiv.querySelector('.btn-reject').disabled = true;
              votedCount++;
              if (votedCount >= document.querySelectorAll('.guess-approval').length) showScreen('voted');
            });
            guessDiv.querySelector('.btn-reject').addEventListener('click', () => {
              socket.emit('vote', { guesserId, approved: false });
              guessDiv.style.opacity = '0.5';
              guessDiv.querySelector('.btn-approve').disabled = true;
              guessDiv.querySelector('.btn-reject').disabled = true;
              votedCount++;
              if (votedCount >= document.querySelectorAll('.guess-approval').length) showScreen('voted');
            });
          });
        } else {
          showScreen('vote');
          vibrate(150);
          document.getElementById('vote-prompt-reminder').textContent = data.prompt || '';
          const options = document.getElementById('vote-options');
          const isDrawingMode = data.answers.length > 0 && data.answers[0].text.startsWith('data:image');
          if (isDrawingMode) {
            options.innerHTML = data.answers
              .map(a =>
                `<button class="vote-btn vote-btn-drawing" data-id="${a.id}">
                  <img src="${a.text}" alt="Drawing" style="width:100%; height:100%; object-fit:contain; pointer-events:none;">
                </button>`
              ).join('');
          } else {
            options.innerHTML = data.answers
              .map(a =>
                `<button class="vote-btn" data-id="${a.id}">${escapeHtml(a.text)}</button>`
              ).join('');
          }

          if (data.timeLimit) {
            let voteTimeLeft = data.timeLimit;
            const voteTimerEl = document.getElementById('vote-timer');
            if (voteTimerEl) {
              voteTimerEl.textContent = voteTimeLeft + 's';
              voteTimerEl.classList.remove('timer-urgent');
              phoneTimer = setInterval(() => {
                voteTimeLeft--;
                voteTimerEl.textContent = Math.max(0, voteTimeLeft) + 's';
                if (voteTimeLeft <= 5) voteTimerEl.classList.add('timer-urgent');
                if (voteTimeLeft <= 0) clearInterval(phoneTimer);
              }, 1000);
            }
          }

          let hasVoted = false;
          options.querySelectorAll('.vote-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              if (hasVoted) return;
              hasVoted = true;
              clearInterval(phoneTimer);
              vibrate(80);
              playSound('vote-cast');
              socket.emit('vote', btn.dataset.id);
              options.querySelectorAll('.vote-btn').forEach(b => b.classList.remove('selected'));
              btn.classList.add('selected');
            });
          });
        }
        break;

      case 'results':
        showScreen('roundEnd');
        playSound('reveal');
        vibrate([50, 100]);
        document.getElementById('phone-round-label').textContent =
          `Round ${data.round} of ${data.totalRounds}`;
        document.getElementById('phone-commentary').textContent = data.commentary || '';

        const revealCards = document.getElementById('phone-reveal-cards');
        if (revealCards) {
          revealCards.innerHTML = data.results.map((r, i) => {
            const isImage = r.text && r.text.startsWith('data:image');
            const metaLine = r.isDrawing
              ? `<div class="phone-reveal-meta">${r.avatar} ${escapeHtml(r.author)} — 🎨 The Drawing</div>`
              : `<div class="phone-reveal-meta">${r.avatar} ${escapeHtml(r.author)} — ${'⭐'.repeat(Math.max(0, r.votes))}${r.votes === 0 ? '—' : ''} ${r.votes} vote${r.votes !== 1 ? 's' : ''}</div>`;
            return `<div class="phone-reveal-card" style="animation-delay: ${i * 0.3}s">
              ${isImage
                ? `<img src="${r.text}" alt="Drawing" style="max-width:100%; height:auto; border-radius:0.5rem; margin-bottom:0.5rem;">`
                : `<div class="phone-reveal-text">"${escapeHtml(r.text)}"</div>`
              }
              ${metaLine}
            </div>`;
          }).join('');
        }

        const myScore = data.scoreboard.find(p => p.id === myId);
        document.getElementById('phone-score').textContent =
          myScore ? `Your score: ${myScore.score} pts` : '';

        renderPhoneScoreboard('phone-scoreboard', data.scoreboard);

        if (isHost) {
          const nextBtn = document.getElementById('btn-host-next');
          nextBtn.textContent = data.round >= data.totalRounds ? 'Final Scores' : 'Next Round';
        }
        break;

      case 'gameover':
        showScreen('gameover');
        playSound('gameover');
        vibrate([100, 100, 100, 100, 300]);

        if (data.scoreboard.length > 0) {
          const winner = data.scoreboard[0];
          document.getElementById('phone-winner-banner').innerHTML =
            `<span class="phone-winner-avatar">${winner.avatar}</span>
             <span class="phone-winner-name">${escapeHtml(winner.name)} wins!</span>`;
        }

        const finalMe = data.scoreboard.find(p => p.id === myId);
        const rank = data.scoreboard.findIndex(p => p.id === myId) + 1;
        const rankEmoji = ['🥇', '🥈', '🥉'][rank - 1] || '';
        document.getElementById('final-rank').textContent =
          rank > 0 ? (rankEmoji ? `${rankEmoji} #${rank}` : `#${rank}`) : '';
        document.getElementById('final-score').textContent =
          finalMe ? `${finalMe.score} point${finalMe.score !== 1 ? 's' : ''}` : '';

        renderPhoneScoreboard('final-phone-scoreboard', data.scoreboard);
        setTimeout(launchPhoneConfetti, 500);
        break;

      // ── Night Falls Phone Phases ──
      case 'nf-role-reveal':
        break;

      case 'nf-night':
        break;

      case 'nf-dawn':
        showScreen('nf-dawn');
        vibrate(200);
        if (data.survived) {
          document.getElementById('nf-dawn-icon').textContent = '✨';
          document.getElementById('nf-dawn-phone-title').textContent = 'Everyone survived!';
          document.getElementById('nf-dawn-phone-content').innerHTML = '<p style="color:#aaa;">No one was eliminated last night.</p>';
        } else {
          document.getElementById('nf-dawn-icon').textContent = '☀️';
          document.getElementById('nf-dawn-phone-title').textContent = 'Dawn Breaks';
          document.getElementById('nf-dawn-phone-content').innerHTML = data.eliminated.map(e =>
            `<div style="margin:0.5rem 0;">
              <p style="font-size:1.3rem;">💀 ${escapeHtml(e.name)} was eliminated</p>
              <p style="color:#aaa;">${e.roleEmoji} ${e.role}</p>
            </div>`
          ).join('');
        }
        break;

      case 'nf-day-discuss':
        showScreen('nf-discuss');
        vibrate(150);
        if (nfMyRole) {
          document.getElementById('nf-your-role-reminder').textContent =
            `Your role: ${nfMyRole.emoji} ${nfMyRole.roleName}`;
        }
        startPhoneTimer('nf-discuss-timer', data.timeLimit);
        break;

      case 'nf-day-vote':
        if (!nfMyAlive) { showScreen('nf-spectator'); break; }
        showScreen('nf-vote');
        vibrate(200);
        nfHasVoted = false;
        const voteOpts = document.getElementById('nf-vote-options');
        voteOpts.innerHTML = data.alivePlayers
          .filter(p => p.id !== myId)
          .map(p => `<button class="vote-btn nf-vote-btn" data-id="${p.id}">${p.avatar} ${escapeHtml(p.name)}</button>`)
          .join('');
        voteOpts.querySelectorAll('.nf-vote-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            if (nfHasVoted) return;
            nfHasVoted = true;
            vibrate(80);
            playSound('vote-cast');
            socket.emit('day-vote', { targetId: btn.dataset.id });
            showScreen('nf-voted');
          });
        });
        startPhoneTimer('nf-vote-timer', data.timeLimit);
        break;

      case 'nf-vote-reveal':
        showScreen('nf-dawn');
        vibrate([100, 100]);
        if (data.ejected) {
          document.getElementById('nf-dawn-icon').textContent = '🗳️';
          document.getElementById('nf-dawn-phone-title').textContent = `${data.ejected.name} was voted out!`;
          document.getElementById('nf-dawn-phone-content').innerHTML =
            `<p style="font-size:1.2rem;">${data.ejected.roleEmoji} ${data.ejected.role}</p>
             ${data.loverDeath ? `<p style="color:#ff6b9d; margin-top:0.5rem;">💔 ${escapeHtml(data.loverDeath.name)} died of heartbreak</p>` : ''}`;
        } else if (data.tie) {
          document.getElementById('nf-dawn-icon').textContent = '⚖️';
          document.getElementById('nf-dawn-phone-title').textContent = 'Tie — no one eliminated';
          document.getElementById('nf-dawn-phone-content').innerHTML = '';
        } else {
          document.getElementById('nf-dawn-icon').textContent = '🤷';
          document.getElementById('nf-dawn-phone-title').textContent = 'Vote skipped';
          document.getElementById('nf-dawn-phone-content').innerHTML = '';
        }
        break;

      case 'nf-gameover':
        showScreen('nf-gameover');
        vibrate([100, 100, 100, 100, 300]);
        const goTitle = document.getElementById('nf-phone-gameover-title');
        if (data.winner === 'villagers') {
          goTitle.textContent = '🏆 The Village Wins!';
        } else if (data.winner === 'werewolves') {
          goTitle.textContent = '🐺 The Werewolves Win!';
        } else {
          goTitle.textContent = '🃏 The Jester Wins!';
        }
        document.getElementById('nf-phone-gameover-reason').textContent = data.reason;
        document.getElementById('nf-phone-all-roles').innerHTML = data.allRoles.map(r =>
          `<div style="display:flex; align-items:center; gap:0.5rem; padding:0.5rem; ${!r.alive ? 'opacity:0.5;' : ''}">
            <span style="font-size:1.5rem;">${r.avatar}</span>
            <strong>${escapeHtml(r.name)}</strong>
            <span>${r.roleEmoji} ${r.roleName}</span>
            ${!r.alive ? '<span>💀</span>' : ''}
          </div>`
        ).join('');
        if (isHost) {
          document.querySelectorAll('.host-only').forEach(el => el.classList.remove('hidden'));
        }
        if (data.winner === 'villagers') {
          setTimeout(() => {
            const c = document.getElementById('nf-phone-confetti-canvas');
            if (c) launchPhoneConfettiOnCanvas(c);
          }, 500);
        }
        break;
    }
  });

  // ── Night Falls State & Events ──
  let nfMyRole = null;
  let nfMyAlive = true;
  let nfHasVoted = false;

  socket.on('nf-role-assigned', (data) => {
    nfMyRole = data;
    nfMyAlive = true;
    showScreen('nf-role');
    document.getElementById('nf-role-emoji').textContent = data.emoji;
    document.getElementById('nf-role-title').textContent = `You are a ${data.roleName}`;
    document.getElementById('nf-role-description').textContent = data.description;
    vibrate([100, 50, 200]);

    if (data.teammates && data.teammates.length > 0) {
      document.getElementById('nf-role-teammates').innerHTML =
        `<p style="color:#ff6b6b; margin-bottom:0.5rem;">Your pack:</p>` +
        data.teammates.map(t => `<p>${t.avatar} ${escapeHtml(t.name)}</p>`).join('');
    } else {
      document.getElementById('nf-role-teammates').innerHTML = '';
    }
  });

  document.getElementById('btn-nf-role-ok').addEventListener('click', () => {});

  socket.on('nf-night-prompt', (data) => {
    if (data.action === 'spectator') {
      nfMyAlive = false;
      showScreen('nf-spectator');
      return;
    }

    showScreen('nf-night');
    document.getElementById('nf-night-label').textContent = `🌙 Night ${data.nightNumber}`;
    document.getElementById('nf-night-role-label').textContent = `${data.emoji} ${data.roleName}`;

    const content = document.getElementById('nf-night-content');

    switch (data.action) {
      case 'choose-target':
        content.innerHTML = `
          <p style="margin-bottom:1rem;">Choose your target:</p>
          <div id="nf-wolf-targets">
            ${data.alivePlayers.map(p => `<button class="vote-btn nf-action-btn" data-id="${p.id}">${p.avatar} ${escapeHtml(p.name)}</button>`).join('')}
          </div>
          ${data.wolfVotes && Object.keys(data.wolfVotes).length > 0 ? `
            <div style="margin-top:1rem; color:#aaa;">
              <p>Pack votes:</p>
              ${Object.values(data.wolfVotes).map(v => `<p>${v.voterAvatar} ${v.voterName} → ${v.targetName}</p>`).join('')}
            </div>` : ''}
          <div id="nf-wolf-vote-display" style="margin-top:1rem; color:#aaa;"></div>
        `;
        content.querySelectorAll('.nf-action-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            vibrate(80);
            socket.emit('night-action', { action: 'eliminate', targetId: btn.dataset.id });
            content.querySelectorAll('.nf-action-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
          });
        });
        break;

      case 'investigate':
        content.innerHTML = `
          <p style="margin-bottom:1rem;">Investigate a player's alignment:</p>
          <div id="nf-seer-targets">
            ${data.alivePlayers.map(p => `<button class="vote-btn nf-action-btn" data-id="${p.id}">${p.avatar} ${escapeHtml(p.name)}</button>`).join('')}
          </div>
        `;
        content.querySelectorAll('.nf-action-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            vibrate(80);
            socket.emit('night-action', { action: 'investigate', targetId: btn.dataset.id });
            content.querySelectorAll('.nf-action-btn').forEach(b => b.disabled = true);
          });
        });
        break;

      case 'protect':
        const cantPickLabel = data.lastTarget ? `<p style="color:#ff6b6b; font-size:0.9rem; margin-bottom:0.5rem;">Can't protect the same player twice in a row</p>` : '';
        content.innerHTML = `
          <p style="margin-bottom:0.5rem;">Choose who to protect:</p>
          ${cantPickLabel}
          <div>
            ${data.alivePlayers.map(p => {
              const disabled = p.id === data.lastTarget ? 'disabled style="opacity:0.4;"' : '';
              return `<button class="vote-btn nf-action-btn" data-id="${p.id}" ${disabled}>${p.avatar} ${escapeHtml(p.name)}</button>`;
            }).join('')}
          </div>
        `;
        content.querySelectorAll('.nf-action-btn:not([disabled])').forEach(btn => {
          btn.addEventListener('click', () => {
            vibrate(80);
            socket.emit('night-action', { action: 'protect', targetId: btn.dataset.id });
            content.querySelectorAll('.nf-action-btn').forEach(b => b.disabled = true);
            btn.classList.add('selected');
          });
        });
        break;

      case 'witch-choose':
        let witchHtml = '';
        if (data.attackedPlayer && data.hasHealPotion) {
          witchHtml += `
            <div style="margin-bottom:1rem; padding:1rem; background:rgba(255,107,107,0.1); border-radius:0.5rem;">
              <p>🐺 The wolves attacked <strong>${data.attackedPlayer.avatar} ${escapeHtml(data.attackedPlayer.name)}</strong></p>
              <button class="btn-start nf-witch-btn" id="btn-witch-heal" style="margin-top:0.5rem;">💊 Use Heal Potion</button>
            </div>`;
        }
        if (data.hasKillPotion) {
          witchHtml += `
            <div style="margin-bottom:1rem;">
              <p style="margin-bottom:0.5rem;">☠️ Use Kill Potion:</p>
              ${data.alivePlayers.map(p => `<button class="vote-btn nf-witch-kill-btn" data-id="${p.id}">${p.avatar} ${escapeHtml(p.name)}</button>`).join('')}
            </div>`;
        }
        witchHtml += `<button class="btn-secondary" id="btn-witch-skip" style="width:100%;">💤 Do nothing</button>`;
        content.innerHTML = witchHtml;

        const healBtn = document.getElementById('btn-witch-heal');
        if (healBtn) {
          healBtn.addEventListener('click', () => {
            vibrate(80);
            socket.emit('night-action', { action: 'witch-heal' });
            healBtn.disabled = true;
            healBtn.textContent = '✅ Healed!';
          });
        }
        content.querySelectorAll('.nf-witch-kill-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            vibrate(80);
            socket.emit('night-action', { action: 'witch-kill', targetId: btn.dataset.id });
            content.querySelectorAll('.nf-witch-kill-btn').forEach(b => b.disabled = true);
            btn.classList.add('selected');
          });
        });
        const skipBtn = document.getElementById('btn-witch-skip');
        if (skipBtn) {
          skipBtn.addEventListener('click', () => {
            socket.emit('night-action', { action: 'witch-skip' });
            skipBtn.disabled = true;
            skipBtn.textContent = '✅ Skipped';
          });
        }
        break;

      case 'pair-lovers':
        content.innerHTML = `
          <p style="margin-bottom:1rem;">💘 Choose two players to be lovers:</p>
          <p style="color:#aaa; font-size:0.9rem; margin-bottom:0.5rem;">If one dies, both die.</p>
          <div id="nf-cupid-targets">
            ${data.allAlivePlayers.map(p => `<button class="vote-btn nf-cupid-btn" data-id="${p.id}">${p.avatar} ${escapeHtml(p.name)}</button>`).join('')}
          </div>
          <button class="btn-start" id="btn-cupid-confirm" disabled style="margin-top:1rem;">Pair Lovers 💘</button>
        `;
        let cupidPicks = [];
        content.querySelectorAll('.nf-cupid-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            if (cupidPicks.includes(btn.dataset.id)) {
              cupidPicks = cupidPicks.filter(id => id !== btn.dataset.id);
              btn.classList.remove('selected');
            } else if (cupidPicks.length < 2) {
              cupidPicks.push(btn.dataset.id);
              btn.classList.add('selected');
            }
            document.getElementById('btn-cupid-confirm').disabled = cupidPicks.length !== 2;
          });
        });
        document.getElementById('btn-cupid-confirm').addEventListener('click', () => {
          if (cupidPicks.length === 2) {
            vibrate(80);
            socket.emit('night-action', { action: 'pair-lovers', lover1: cupidPicks[0], lover2: cupidPicks[1] });
            document.getElementById('btn-cupid-confirm').disabled = true;
            document.getElementById('btn-cupid-confirm').textContent = '✅ Paired!';
          }
        });
        break;

      case 'sleep':
        content.innerHTML = `
          <div style="text-align:center;">
            <p style="font-size:3rem;">💤</p>
            <p style="font-size:1.2rem;">Sleep peacefully...</p>
            <p style="color:#aaa; margin-top:0.5rem;">The village sleeps while dark forces are at work...</p>
          </div>
        `;
        break;
    }
  });

  socket.on('investigation-result', (data) => {
    const content = document.getElementById('nf-night-content');
    if (!content) return;
    const alignColor = data.alignment === 'good' ? '#4CAF50' : '#ff6b6b';
    const alignEmoji = data.alignment === 'good' ? '👼' : '🐺';
    content.innerHTML = `
      <div style="text-align:center;">
        <p style="font-size:1.2rem;">🔮 Investigation Result</p>
        <p style="font-size:2rem; margin:1rem 0;">${data.targetAvatar} ${escapeHtml(data.targetName)}</p>
        <p style="font-size:2.5rem; color:${alignColor}; font-weight:bold;">${alignEmoji} ${data.alignment.toUpperCase()}</p>
        <p style="color:#aaa; margin-top:1rem; font-size:0.9rem;">Remember this — share wisely!</p>
      </div>
    `;
    vibrate([100, 50, 100]);
  });

  socket.on('wolf-vote-update', (data) => {
    const display = document.getElementById('nf-wolf-vote-display');
    if (display) {
      display.innerHTML += `<p>${data.voterAvatar} ${data.voterName} → ${data.targetName}</p>`;
    }
  });

  socket.on('action-confirmed', () => { vibrate(80); });

  socket.on('lover-paired', (data) => {
    const loverInfo = document.getElementById('nf-lover-info');
    if (loverInfo) {
      loverInfo.style.display = 'block';
      document.getElementById('nf-lover-name').textContent = `${data.loverAvatar} ${data.loverName}`;
    }
  });

  socket.on('nf-hunter-trigger', (data) => {
    showScreen('nf-hunter');
    vibrate([200, 100, 200]);
    const targets = document.getElementById('nf-hunter-targets');
    targets.innerHTML = data.alivePlayers.map(p =>
      `<button class="vote-btn nf-action-btn" data-id="${p.id}">${p.avatar} ${escapeHtml(p.name)}</button>`
    ).join('');
    targets.querySelectorAll('.nf-action-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        vibrate(100);
        socket.emit('hunter-target', { targetId: btn.dataset.id });
        targets.querySelectorAll('.nf-action-btn').forEach(b => b.disabled = true);
        btn.classList.add('selected');
      });
    });
  });

  socket.on('nf-vote-progress', (data) => {
    const el = document.getElementById('nf-vote-wait-status');
    if (el) el.textContent = `🗳️ ${data.voted}/${data.total} voted`;
  });

  document.getElementById('btn-nf-skip-vote').addEventListener('click', () => {
    if (nfHasVoted) return;
    nfHasVoted = true;
    vibrate(80);
    socket.emit('day-vote', { targetId: 'skip' });
    showScreen('nf-voted');
  });

  document.getElementById('btn-nf-phone-again').addEventListener('click', () => {
    socket.emit('play-again');
  });

  function startPhoneTimer(elementId, duration) {
    clearInterval(phoneTimer);
    const el = document.getElementById(elementId);
    if (!el) return;
    let timeLeft = duration;
    el.textContent = timeLeft + 's';
    el.classList.remove('timer-urgent');
    phoneTimer = setInterval(() => {
      timeLeft--;
      el.textContent = Math.max(0, timeLeft) + 's';
      if (timeLeft <= 10) el.classList.add('timer-urgent');
      if (timeLeft <= 0) clearInterval(phoneTimer);
    }, 1000);
  }

  // ── Answer & Vote Submission ──
  document.getElementById('btn-submit').addEventListener('click', () => {
    if (hasSubmitted) return;
    const text = document.getElementById('answer-input').value.trim();
    if (!text) return;
    hasSubmitted = true;
    clearInterval(phoneTimer);
    document.getElementById('btn-submit').disabled = true;
    document.getElementById('my-answer-note').textContent = `Your answer: "${text}"`;
    vibrate(100);
    socket.emit('answer', text);
  });

  socket.on('answer-received', () => { showScreen('answered'); });

  socket.on('answer-progress', (data) => {
    const statusEl = document.getElementById('answer-waiting-status');
    const namesEl = document.getElementById('answer-pending-names');
    if (statusEl) statusEl.textContent = `${data.answered}/${data.total} answered`;
    if (namesEl && data.pending && data.pending.length > 0) {
      namesEl.textContent = `Waiting for: ${data.pending.join(', ')}`;
    } else if (namesEl) {
      namesEl.textContent = '';
    }
  });

  socket.on('vote-received', () => { showScreen('voted'); });

  socket.on('vote-progress', (data) => {
    const statusEl = document.getElementById('vote-waiting-status');
    const namesEl = document.getElementById('vote-pending-names');
    if (statusEl) statusEl.textContent = `${data.voted}/${data.total} voted`;
    if (namesEl && data.pending && data.pending.length > 0) {
      namesEl.textContent = `Waiting for: ${data.pending.join(', ')}`;
    } else if (namesEl) {
      namesEl.textContent = '';
    }
  });

  // ── Player Update ──
  socket.on('player-update', (players) => {
    const takenAvatars = players.map(p => p.avatar);

    emojiPicker.querySelectorAll('.emoji-option').forEach(btn => {
      const emoji = btn.textContent;
      const isTaken = takenAvatars.includes(emoji);
      btn.classList.toggle('taken', isTaken);
      btn.disabled = isTaken;
      if (isTaken && emoji === selectedAvatar) {
        btn.classList.remove('selected');
      }
    });

    const phonePlayerList = document.getElementById('phone-player-list');
    if (phonePlayerList) {
      phonePlayerList.innerHTML = players.map(p =>
        `<span class="phone-player-chip">${p.avatar} ${escapeHtml(p.name)}</span>`
      ).join('');
    }

    if (!isHost) return;
    const btn = document.getElementById('btn-host-start');
    const minPlayers = isTestMode ? 1 : (currentGameMode === 'night-falls' ? 5 : 3);
    btn.disabled = players.length < minPlayers;
    if (isTestMode) {
      document.getElementById('host-lobby-status').textContent =
        `🧪 TEST MODE — ${players.length} player(s) ready!`;
    } else if (currentGameMode === 'night-falls') {
      document.getElementById('host-lobby-status').textContent =
        players.length < 5
          ? `Need at least 5 players (${players.length} joined)`
          : `🐺 ${players.length} players ready!`;
    } else {
      document.getElementById('host-lobby-status').textContent =
        players.length < 3
          ? `Need at least 3 players (${players.length} joined)`
          : `${players.length} players ready!`;
    }
  });

  // ── Host Controls ──
  document.querySelectorAll('#phone-mode-selector .mode-button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#phone-mode-selector .mode-button').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      currentGameMode = btn.dataset.mode;
      socket.emit('set-game-mode', currentGameMode);
      const roundPicker = document.getElementById('phone-round-picker');
      if (roundPicker) roundPicker.style.display = currentGameMode === 'night-falls' ? 'none' : '';
    });
  });

  let selectedRounds = 10;
  document.querySelectorAll('.phone-round-option').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.phone-round-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedRounds = parseInt(btn.dataset.rounds);
    });
  });

  function startGame() {
    socket.emit('start-game', selectedRounds);
  }

  document.getElementById('btn-host-start').addEventListener('click', () => {
    if (tvConnected) {
      startGame();
    } else {
      document.getElementById('tv-prompt-modal').classList.remove('hidden');
    }
  });

  document.getElementById('btn-tv-open-start').addEventListener('click', () => {
    document.getElementById('tv-prompt-modal').classList.add('hidden');
    window.open(`/tv.html?room=${roomCode}`, '_blank');
    // Give TV a moment to connect before starting
    setTimeout(startGame, 1500);
  });

  document.getElementById('btn-tv-skip-start').addEventListener('click', () => {
    document.getElementById('tv-prompt-modal').classList.add('hidden');
    startGame();
  });

  document.getElementById('btn-host-next').addEventListener('click', () => {
    socket.emit('next-round');
  });

  document.getElementById('btn-host-again').addEventListener('click', () => {
    socket.emit('play-again');
  });

  // Exit Game
  document.getElementById('btn-exit-game').addEventListener('click', () => {
    if (confirm('Leave the game?')) {
      socket.emit('leave-game');
    }
  });

  socket.on('left-game', () => {
    sessionStorage.removeItem('hottake-token');
    myToken = null;
    isHost = false;
    hasSubmitted = false;
    clearInterval(phoneTimer);
    showScreen('join');
  });

  // ── Host Lobby: Game Settings ──
  document.getElementById('btn-phone-settings').addEventListener('click', () => {
    document.getElementById('phone-settings-modal').classList.remove('hidden');
  });
  document.getElementById('btn-close-phone-settings').addEventListener('click', () => {
    document.getElementById('phone-settings-modal').classList.add('hidden');
  });
  document.getElementById('phone-round-time-slider').addEventListener('input', (e) => {
    document.getElementById('phone-round-time-display').textContent = e.target.value;
    socket.emit('update-settings', { roundTime: parseInt(e.target.value) });
  });
  document.getElementById('phone-vote-time-slider').addEventListener('input', (e) => {
    document.getElementById('phone-vote-time-display').textContent = e.target.value;
    socket.emit('update-settings', { voteTime: parseInt(e.target.value) });
  });
  document.getElementById('phone-total-rounds-slider').addEventListener('input', (e) => {
    document.getElementById('phone-total-rounds-display').textContent = e.target.value;
    socket.emit('update-settings', { totalRounds: parseInt(e.target.value) });
  });

  // Sync settings from server (when TV or another host changes them)
  socket.on('settings-updated', (settings) => {
    if (settings.roundTime) {
      document.getElementById('phone-round-time-slider').value = settings.roundTime;
      document.getElementById('phone-round-time-display').textContent = settings.roundTime;
    }
    if (settings.voteTime) {
      document.getElementById('phone-vote-time-slider').value = settings.voteTime;
      document.getElementById('phone-vote-time-display').textContent = settings.voteTime;
    }
    if (settings.totalRounds) {
      document.getElementById('phone-total-rounds-slider').value = settings.totalRounds;
      document.getElementById('phone-total-rounds-display').textContent = settings.totalRounds;
    }
  });

  // ── Host Lobby: Teams ──
  document.getElementById('btn-phone-teams').addEventListener('click', () => {
    document.getElementById('phone-teams-modal').classList.remove('hidden');
  });
  document.getElementById('btn-close-phone-teams').addEventListener('click', () => {
    document.getElementById('phone-teams-modal').classList.add('hidden');
  });
  let phoneTeamMode = false;
  let phoneTeamCount = 2;
  document.querySelectorAll('input[name="phone-team-mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      phoneTeamMode = e.target.value === 'teams';
      document.getElementById('phone-team-count-section').style.display = phoneTeamMode ? 'block' : 'none';
      socket.emit('set-team-mode', { teamMode: phoneTeamMode, teamCount: phoneTeamCount });
    });
  });
  document.getElementById('phone-team-count-slider').addEventListener('input', (e) => {
    phoneTeamCount = parseInt(e.target.value);
    document.getElementById('phone-team-count-display').textContent = phoneTeamCount;
    if (phoneTeamMode) {
      socket.emit('set-team-mode', { teamMode: phoneTeamMode, teamCount: phoneTeamCount });
    }
  });
  socket.on('team-mode-updated', (data) => {
    phoneTeamMode = data.teamMode;
    phoneTeamCount = data.teamCount;
    const radio = document.querySelector(`input[name="phone-team-mode"][value="${data.teamMode ? 'teams' : 'solo'}"]`);
    if (radio) radio.checked = true;
    document.getElementById('phone-team-count-slider').value = phoneTeamCount;
    document.getElementById('phone-team-count-display').textContent = phoneTeamCount;
    document.getElementById('phone-team-count-section').style.display = data.teamMode ? 'block' : 'none';
  });

  // ── Host Lobby: Manage Prompts ──
  document.getElementById('btn-phone-prompts').addEventListener('click', () => {
    document.getElementById('phone-prompts-modal').classList.remove('hidden');
  });
  document.getElementById('btn-close-phone-prompts').addEventListener('click', () => {
    document.getElementById('phone-prompts-modal').classList.add('hidden');
  });
  document.getElementById('btn-phone-add-prompt').addEventListener('click', () => {
    const input = document.getElementById('phone-prompt-input');
    const text = input.value.trim();
    if (text.length > 0) {
      socket.emit('add-custom-prompt', text);
      input.value = '';
    }
  });
  document.getElementById('phone-prompt-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-phone-add-prompt').click();
  });
  socket.on('custom-prompts-update', (prompts) => {
    const list = document.getElementById('phone-prompts-list');
    if (prompts.length === 0) {
      list.innerHTML = '<p style="opacity:0.5; text-align:center;">No custom prompts yet</p>';
    } else {
      list.innerHTML = prompts.map((p, i) =>
        `<div style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem; background:#1a1a2e; border:1px solid #333; border-radius:0.3rem; margin:0.3rem 0; color:#e8e8e8;">
          <span style="flex:1; font-size:0.9rem;">${escapeHtml(p)}</span>
          <button class="btn-phone-remove-prompt" data-index="${i}" style="background:none; border:none; color:#ff6b6b; cursor:pointer; font-size:1.1rem; padding:0 0.5rem;">✕</button>
        </div>`
      ).join('');
      list.querySelectorAll('.btn-phone-remove-prompt').forEach(btn => {
        btn.addEventListener('click', () => {
          socket.emit('remove-custom-prompt', parseInt(btn.dataset.index));
        });
      });
    }
  });

  // ── Host Lobby: Add Bots ──
  document.getElementById('btn-phone-bots').addEventListener('click', async () => {
    const btn = document.getElementById('btn-phone-bots');
    const count = prompt('How many bots? (1-12)', '3');
    if (!count) return;
    btn.disabled = true;
    btn.textContent = '🤖 Adding...';
    try {
      const resp = await fetch(`/api/add-bots?room=${roomCode}&count=${parseInt(count) || 3}`, { method: 'POST' });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      btn.textContent = `🤖 ${data.added} Bots Added`;
      setTimeout(() => { btn.textContent = '🤖 Add Bots'; btn.disabled = false; }, 3000);
    } catch (e) {
      btn.textContent = '🤖 Add Bots';
      btn.disabled = false;
      alert('Failed to add bots: ' + e.message);
    }
  });

  // ── Helpers ──
  function renderPhoneScoreboard(elementId, scoreboard) {
    const medals = ['🥇', '🥈', '🥉'];
    document.getElementById(elementId).innerHTML = scoreboard.map((p, i) =>
      `<div class="phone-score-row ${p.id === myId ? 'phone-score-me' : ''}">
        <span>${medals[i] || ''} ${p.avatar} ${escapeHtml(p.name)}</span>
        <span>${p.score} pts</span>
      </div>`
    ).join('');
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ── Confetti ──
  function launchPhoneConfettiOnCanvas(canvas) {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.display = 'block';
    const ctx = canvas.getContext('2d');
    const colors = ['#506be6', '#764ba2', '#ffd700', '#ff6b6b', '#48dbfb', '#ff9ff3', '#00d2d3'];
    const pieces = [];
    for (let i = 0; i < 100; i++) {
      pieces.push({
        x: Math.random() * canvas.width, y: Math.random() * canvas.height - canvas.height,
        w: Math.random() * 10 + 4, h: Math.random() * 6 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 3, vy: Math.random() * 2.5 + 1.5,
        rot: Math.random() * 360, rotSpeed: (Math.random() - 0.5) * 8,
      });
    }
    let frame = 0;
    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.rot += p.rotSpeed; p.vy += 0.04;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot * Math.PI / 180);
        ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      });
      frame++;
      if (frame < 250) requestAnimationFrame(animate);
      else canvas.style.display = 'none';
    }
    animate();
  }

  function launchPhoneConfetti() {
    const canvas = document.getElementById('phone-confetti-canvas');
    launchPhoneConfettiOnCanvas(canvas);
  }
})();

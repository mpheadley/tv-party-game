/**
 * Drawing Canvas Module
 * Handles canvas setup, drawing tools, touch/mouse events, and submission
 * Used by phone.html for Speed Drawing and Pictionary modes
 */
const Drawing = (() => {
  let canvas = null;
  let ctx = null;
  let isDrawing = false;
  let tool = 'pencil';
  let color = '#000000';
  let size = 3;
  let lastX = 0;
  let lastY = 0;
  let initialized = false;

  // Injected dependencies
  let _socket = null;
  let _getHasSubmitted = () => false;
  let _setHasSubmitted = () => {};
  let _onSubmit = () => {};

  function init(options) {
    _socket = options.socket;
    _getHasSubmitted = options.getHasSubmitted;
    _setHasSubmitted = options.setHasSubmitted;
    _onSubmit = options.onSubmit || (() => {});
  }

  function initCanvas() {
    canvas = document.getElementById('drawing-canvas');
    if (!canvas) return;

    const container = canvas.parentElement;
    const canvasWidth = Math.min(400, container.clientWidth - 20);
    const maxHeight = Math.min(400, window.innerHeight - 320);
    canvas.width = canvasWidth;
    canvas.height = Math.max(200, maxHeight);

    ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Only bind events once
    if (!initialized) {
      // Canvas drawing events
      canvas.addEventListener('mousedown', startDrawing);
      canvas.addEventListener('mousemove', draw);
      canvas.addEventListener('mouseup', stopDrawing);
      canvas.addEventListener('mouseout', stopDrawing);
      canvas.addEventListener('touchstart', startDrawing);
      canvas.addEventListener('touchmove', draw);
      canvas.addEventListener('touchend', stopDrawing);

      // Tool buttons
      document.getElementById('btn-pencil').addEventListener('click', () => {
        tool = 'pencil';
        document.getElementById('btn-pencil').classList.add('active');
        document.getElementById('btn-eraser').classList.remove('active');
      });

      document.getElementById('btn-eraser').addEventListener('click', () => {
        tool = 'eraser';
        document.getElementById('btn-eraser').classList.add('active');
        document.getElementById('btn-pencil').classList.remove('active');
      });

      document.getElementById('color-picker').addEventListener('change', (e) => {
        color = e.target.value;
      });

      document.getElementById('size-slider').addEventListener('input', (e) => {
        size = parseInt(e.target.value);
        document.getElementById('size-display').textContent = size;
      });

      document.getElementById('btn-clear').addEventListener('click', () => {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      });

      document.getElementById('btn-submit-drawing').addEventListener('click', submitDrawing);

      initialized = true;
    } else {
      // Re-init: clear canvas for new round
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    if (e.touches) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function startDrawing(e) {
    e.preventDefault();
    isDrawing = true;
    const coords = getCanvasCoords(e);
    lastX = coords.x;
    lastY = coords.y;
  }

  function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const coords = getCanvasCoords(e);

    if (tool === 'eraser') {
      ctx.clearRect(coords.x - size / 2, coords.y - size / 2, size, size);
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(coords.x, coords.y);
      ctx.stroke();
    }

    lastX = coords.x;
    lastY = coords.y;
  }

  function stopDrawing() {
    isDrawing = false;
  }

  function submitDrawing() {
    if (_getHasSubmitted()) return;
    _setHasSubmitted(true);
    document.getElementById('btn-submit-drawing').disabled = true;
    const imageData = canvas.toDataURL('image/png');
    _socket.emit('answer', imageData);
    _onSubmit();
  }

  return { init, initCanvas, submitDrawing };
})();

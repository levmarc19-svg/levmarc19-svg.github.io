/*
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  game.js — Math Attaque  (PvE mode)                         ║
 * ║                                                              ║
 * ║  Responsibilities:                                           ║
 * ║    • Canvas setup & resizing                                 ║
 * ║    • Level progression (rolling modifiers, placing dots)    ║
 * ║    • Equation input UI (renderControls)                      ║
 * ║    • Projectile animation (shoot / shootLaser)               ║
 * ║    • Wall collision detection                                ║
 * ║    • Particle explosion effect                               ║
 * ║    • Hint system (one hint per level)                        ║
 * ║    • HUD updates & high-score tracking                       ║
 * ╚══════════════════════════════════════════════════════════════╝
 */


/* ═══════════════════════════════════════════════════════════════
   CANVAS SETUP
   The game renders everything onto a single <canvas> element that
   fills the entire viewport.  Grid dimensions are fixed (16 × 10
   cells); pixel dimensions match window size and are recalculated
   on every resize.
═══════════════════════════════════════════════════════════════ */

var canvas = document.getElementById("c");
var ctx    = canvas.getContext("2d"); // 2-D drawing context

// Grid dimensions (in grid units, not pixels)
var GRID_COLS = 16;
var GRID_ROWS = 10;

// Pixel dimensions — recalculated by resizeCanvas()
var CANVAS_WIDTH, CANVAS_HEIGHT, CELL_WIDTH, CELL_HEIGHT;

/*
  resizeCanvas()
  Called on page load and whenever the window is resized.
  Sets canvas.width/height to actual pixel dimensions so drawing
  is never blurry (avoids CSS-only scaling).

  Reference: Canvas sizing best practices
  https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Basic_usage#the_canvas_element
*/
function resizeCanvas() {
  CANVAS_WIDTH  = window.innerWidth;
  CANVAS_HEIGHT = window.innerHeight;
  CELL_WIDTH    = CANVAS_WIDTH  / GRID_COLS;
  CELL_HEIGHT   = CANVAS_HEIGHT / GRID_ROWS;
  canvas.width  = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
}

/*
  Global resize listener.
  Redraws the game if a level is active (playerX will be defined).
  Also triggers the sandbox canvas resize so both stay in sync.
*/
window.addEventListener("resize", function() {
  resizeCanvas();
  if (typeof playerX !== "undefined") draw();
  sbResizeCanvas(); // defined in sandbox.js
});

/*
  gridToPixel(gx, gy)
  Converts a grid coordinate (col, row) to canvas pixel coordinates.

  The coordinate system:
    • Grid X 0 = left edge,  X increases to the right
    • Grid Y 0 = bottom edge, Y increases upward  ← inverted from canvas!
  Canvas Y increases DOWNWARD, so we invert: py = CANVAS_HEIGHT - gy × CELL_HEIGHT
  This lets us use familiar Cartesian (x right, y up) in game logic.
*/
function gridToPixel(gx, gy) {
  return {
    px: gx * CELL_WIDTH,
    py: CANVAS_HEIGHT - gy * CELL_HEIGHT
  };
}


/* ═══════════════════════════════════════════════════════════════
   GAME STATE VARIABLES
═══════════════════════════════════════════════════════════════ */

var level;             // Current level number (starts at 1)
var shotsLeft;         // How many shots remain this level (starts at 5)
var playerX, playerY;  // Player dot position in grid coordinates
var enemyX,  enemyY;   // Enemy dot position in grid coordinates

var lastAB     = null; // Last {a, b} used (for barrel angle on player dot)
var pastShots  = [];   // Array of path arrays — drawn as translucent trails
var isShooting = false;// True while a projectile animation is running
var particles  = [];   // Active explosion particle objects

// Modifiers — unlocked at higher levels
var hasWalls       = false; // Wall obstacles added at level 7+
var flippedParabola = false; // Parabola opens upward (a > 0) instead of downward
var walls          = [];    // Array of {gridX, topGridY} wall objects
var laserCharges   = 0;     // Number of laser shots available
var laserArmed     = false; // True when the player has clicked "⚡ Laser"

// Equation form cycling
var currentForm; // "general" | "factored" | "vertex"
var fixedA;      // Pre-chosen leading coefficient for factored/vertex forms

// Hint state
var hintUsedThisLevel = false;

// Tracker: position of the projectile head used for the on-screen label
var trackerPos = null;

/* Equation forms rotate in order each level */
var FORM_ORDER = ["general", "factored", "vertex"];

/* Possible negative leading coefficients for parabola shots */
var FIXED_A_OPTIONS = [-0.1, -0.15, -0.2, -0.25, -0.3];


/* ═══════════════════════════════════════════════════════════════
   MODIFIER LOGIC
═══════════════════════════════════════════════════════════════ */

/*
  rollModifiers(lvl)
  Randomly activates optional difficulty modifiers.
  Walls appear from level 7 (25% chance).
  Flipped parabola appears from level 10 (20% chance, only if no walls).
  Both can't be active at the same time (flipped check has the &&!hasWalls guard).
*/
function rollModifiers(lvl) {
  hasWalls        = (lvl >= 7)  && (Math.random() < 0.25);
  flippedParabola = !hasWalls   && (lvl >= 10) && (Math.random() < 0.20);
}

/*
  buildWalls()
  Generates 1–2 wall objects placed between the player and enemy.
  Each wall occupies a column and blocks projectiles at or below a Y threshold.
  Attempts prevent two walls in the same column (isWallAt guard).
*/
function buildWalls() {
  walls = [];
  if (!hasWalls) return;

  var numWalls = Math.random() < 0.4 ? 2 : 1;
  var left  = playerX + 2;
  var right = enemyX  - 2;
  if (right - left < 2) return; // Not enough space for a wall

  for (var w = 0; w < numWalls; w++) {
    var attempts = 0, wallCol;
    do {
      wallCol = left + Math.floor(Math.random() * (right - left + 1));
      attempts++;
    } while (isWallAt(wallCol) && attempts < 20);

    if (isWallAt(wallCol)) continue; // Give up if no unique column found

    walls.push({
      gridX:    wallCol,
      topGridY: 2 + Math.floor(Math.random() * 4) // Random height 2–5
    });
  }
}

/* Returns true if a wall already occupies grid column gx */
function isWallAt(gx) {
  for (var i = 0; i < walls.length; i++) {
    if (walls[i].gridX === gx) return true;
  }
  return false;
}

/*
  isBlockedByWall(wx, wy)
  Returns true if the projectile at world position (wx, wy) is
  inside or below a wall.
  Horizontal tolerance of ±0.6 grid units prevents the shot from
  passing through a wall at a steep angle.
*/
function isBlockedByWall(wx, wy) {
  for (var i = 0; i < walls.length; i++) {
    var w = walls[i];
    if (Math.abs(wx - w.gridX) < 0.6 && wy <= w.topGridY) return true;
  }
  return false;
}


/* ═══════════════════════════════════════════════════════════════
   LASER SYSTEM
═══════════════════════════════════════════════════════════════ */

/*
  checkLaserReward()
  Awards a laser charge every 5th level.
  The laser fires a straight line instead of a parabola.
*/
function checkLaserReward() {
  if (level % 5 === 0) {
    laserCharges++;
    setMessage("⚡ Laser charge earned! (" + laserCharges + " charge" + (laserCharges > 1 ? "s" : "") + ")");
  }
}

/* Called when player clicks the ⚡ Laser button */
function activateLaser() {
  if (laserCharges <= 0 || isShooting) return;
  laserArmed = true;
  renderControls();
  setMessage("⚡ Laser armed — enter slope m. Always starts from your dot.");
}

/* Called when player clicks ✕ Cancel Laser */
function cancelLaser() {
  laserArmed = false;
  renderControls();
  setMessage("");
}


/* ═══════════════════════════════════════════════════════════════
   LEVEL SETUP
═══════════════════════════════════════════════════════════════ */

/*
  pickForm(lvl)
  Cycles through General → Factored → Vertex using modulo arithmetic.
  fixedA is pre-chosen here so the player can't manipulate the
  leading coefficient in factored/vertex forms.
*/
function pickForm(lvl) {
  currentForm = FORM_ORDER[(lvl - 1) % FORM_ORDER.length];

  if (flippedParabola) {
    // Positive A options for upward-opening parabola
    var pos = [0.1, 0.15, 0.2, 0.25, 0.3];
    fixedA = pos[Math.floor(Math.random() * pos.length)];
  } else {
    fixedA = FIXED_A_OPTIONS[Math.floor(Math.random() * FIXED_A_OPTIONS.length)];
  }
}

/*
  placeDots()
  Randomly positions the player (left side) and enemy (right side).
  Player: columns 1–3, rows 2–6
  Enemy:  columns 12–15, rows 2–6
*/
function placeDots() {
  playerX = randomInt(1, 3);
  playerY = randomInt(2, 6);
  enemyX  = randomInt(12, 15);
  enemyY  = randomInt(2, 6);
}


/* ═══════════════════════════════════════════════════════════════
   CONTROL BAR RENDERING
   renderControls() is called at the start of each level and when
   the laser is armed/cancelled.  It writes dynamic HTML into
   #game-controls, varying with the active equation form.
═══════════════════════════════════════════════════════════════ */

/*
  dotPreviewHTML()
  Returns the HTML for the small dot-preview widget showing
  player and enemy grid coordinates in the control bar.
*/
function dotPreviewHTML() {
  return "<div id='dot-preview'>" +
    "<div class='dot-row'><div class='dot player'></div>" +
      "<span class='dot-label'>You (" + playerX + "," + playerY + ")</span></div>" +
    "<div class='dot-row'><div class='dot enemy'></div>" +
      "<span class='dot-label'>Enemy (" + enemyX + "," + enemyY + ")</span></div>" +
    "</div>";
}

/*
  renderControls()
  Builds the input bar HTML for the current state:
    Laser armed  → slope input  "y = m(x − px) + py"
    General form → a + b inputs "y = ax² + bx"
    Factored     → r + s inputs "y = fixedA(x−r)(x−s)"
    Vertex       → h + k inputs "y = fixedA(x−h)² + k"

  After inserting the laser inputs, a live-preview listener is
  attached via setTimeout (so the DOM is ready before querySelector).
*/
function renderControls() {
  var bar   = document.getElementById("game-controls");
  var badge = document.getElementById("form-badge");

  // Build optional laser button HTML
  var laserBtn = laserArmed
    ? "<button class='laser-cancel-btn' onclick='cancelLaser()'>✕ Cancel Laser</button>"
    : laserCharges > 0
      ? "<button class='laser-btn' onclick='activateLaser()'>⚡ Laser (" + laserCharges + ")</button>"
      : "";

  /* ── Laser mode ──────────────────────────────────────── */
  if (laserArmed) {
    badge.textContent = "⚡ Laser — Linear (through your dot)";
    badge.style.background = "#cc9900";
    badge.style.color = "#000";

    bar.innerHTML =
      dotPreviewHTML() +
      "<span class='label'>slope m =</span>" +
      "<input id='inputM' placeholder='m' style='width:60px'>" +
      "<span class='label' id='laser-preview-lbl' style='font-size:13px;color:rgba(255,255,255,0.45);'>" +
        "→ y = m(x−" + playerX + ")+" + playerY +
      "</span>" +
      laserBtn +
      "<button class='shoot-btn' onclick='shoot()'>Fire!</button>";

    // Attach a live preview listener once the DOM has updated
    setTimeout(function() {
      var mi  = document.getElementById("inputM");
      var lbl = document.getElementById("laser-preview-lbl");
      if (!mi || !lbl) return;
      mi.addEventListener("input", function() {
        var m = parseFloat(mi.value);
        if (!isNaN(m)) {
          var b = playerY - m * playerX;
          lbl.textContent = "→ y = " + m + "x + " + b.toFixed(2) + "  ✓";
          lbl.style.color = "#ffe44d";
        } else {
          lbl.textContent = "→ y = m(x−" + playerX + ")+" + playerY;
          lbl.style.color = "rgba(255,255,255,0.45)";
        }
      });
    }, 0);
    return;
  }

  // Reset badge styles from any previous laser use
  badge.style.background = "";
  badge.style.color = "";

  /* ── General form: y = ax² + bx ─────────────────────── */
  if (currentForm === "general") {
    badge.textContent = flippedParabola ? "General Form ↑ (a > 0)" : "General Form";
    bar.innerHTML =
      dotPreviewHTML() +
      "<span class='label'>y =</span>" +
      "<input id='inputA' placeholder='a'>" +
      "<span class='label'>x² +</span>" +
      "<input id='inputB' placeholder='b'>" +
      "<span class='label'>x</span>" +
      laserBtn +
      "<button class='shoot-btn' onclick='shoot()'>Shoot</button>";

  /* ── Factored form: y = fixedA(x−r)(x−s) ────────────── */
  } else if (currentForm === "factored") {
    badge.textContent = flippedParabola ? "Factored Form ↑" : "Factored Form";
    bar.innerHTML =
      dotPreviewHTML() +
      "<span class='label'>y =</span>" +
      "<span class='fixed'>" + fixedA + "</span>" +
      "<span class='label'>(x −</span>" +
      "<input id='inputR' placeholder='r'>" +
      "<span class='label'>)(x −</span>" +
      "<input id='inputS' placeholder='s'>" +
      "<span class='label'>)</span>" +
      laserBtn +
      "<button class='shoot-btn' onclick='shoot()'>Shoot</button>";

  /* ── Vertex form: y = fixedA(x−h)² + k ──────────────── */
  } else if (currentForm === "vertex") {
    badge.textContent = flippedParabola ? "Vertex Form ↑" : "Vertex Form";
    bar.innerHTML =
      dotPreviewHTML() +
      "<span class='label'>y =</span>" +
      "<span class='fixed'>" + fixedA + "</span>" +
      "<span class='label'>(x −</span>" +
      "<input id='inputH' placeholder='h'>" +
      "<span class='label'>)² +</span>" +
      "<input id='inputK' placeholder='k'>" +
      laserBtn +
      "<button class='shoot-btn' onclick='shoot()'>Shoot</button>";
  }
}


/* ═══════════════════════════════════════════════════════════════
   INPUT PARSING
═══════════════════════════════════════════════════════════════ */

/*
  readInputs()
  Reads values from the dynamically-built input bar and returns
  a normalised {a, b} object for the parabola, or {isLaser, m, bAuto}
  for a laser shot.

  Returns null and sets an error message if validation fails.

  Math:
    General:  equation is y = ax² + bx  starting from player origin.
    Factored: y = fixedA(x−r)(x−s)  →  expand to ax² + bx form.
      Expand: A(x−r)(x−s) = A(x² − (r+s)x + rs) = Ax² − A(r+s)x + Ars
      So b = −A(r+s)  (the rs term is absorbed into the absolute y calculation).
    Vertex:   y = fixedA(x−h)² + k
      Expand: A(x² − 2hx + h²) + k = Ax² − 2Ahx + (Ah² + k)
      So b = −2Ah  (k shifts via the offset calculation in draw).
    Laser:    y = m·worldX + bAuto  where bAuto = py − m·px so the
              line always passes through the player dot.

  flippedParabola forces a > 0 (curves upward) regardless of what
  the player entered, so they don't have to remember to use positive a.
*/
function readInputs() {
  /* ── Laser ──────────────────────────────────────────── */
  if (laserArmed) {
    var m = parseFloat(document.getElementById("inputM").value);
    if (isNaN(m)) { setMessage("Enter slope m for the laser."); return null; }
    return { isLaser: true, m: m, bAuto: playerY - m * playerX };
  }

  /* ── General form ────────────────────────────────────── */
  if (currentForm === "general") {
    var a = parseFloat(document.getElementById("inputA").value);
    var b = parseFloat(document.getElementById("inputB").value);
    if (isNaN(a) || isNaN(b)) { setMessage("Enter values for a and b."); return null; }
    if (Math.abs(a) < 0.05)   { setMessage("a is too small. Try ±0.2"); return null; }
    // Force correct sign based on flipped state
    if ( flippedParabola && a < 0) a = -a;
    if (!flippedParabola && a > 0) a = -a;
    return { a: a, b: b };
  }

  /* ── Factored form ───────────────────────────────────── */
  if (currentForm === "factored") {
    var r = parseFloat(document.getElementById("inputR").value);
    var s = parseFloat(document.getElementById("inputS").value);
    if (isNaN(r) || isNaN(s)) { setMessage("Enter values for r and s."); return null; }
    // Convert factored → general coefficients
    return { a: fixedA, b: -fixedA * (r + s) };
  }

  /* ── Vertex form ─────────────────────────────────────── */
  if (currentForm === "vertex") {
    var h = parseFloat(document.getElementById("inputH").value);
    var k = parseFloat(document.getElementById("inputK").value);
    if (isNaN(h) || isNaN(k)) { setMessage("Enter values for h and k."); return null; }
    // Convert vertex → general b coefficient
    return { a: fixedA, b: -2 * fixedA * h };
  }

  return null;
}

/*
  getAnswer()
  Returns a hint string showing one valid solution.
  Used by finishShot() when the player runs out of shots.
*/
function getAnswer() {
  var dx = enemyX - playerX;
  var dy = enemyY - playerY;

  if (currentForm === "general") {
    var a = flippedParabola ? 0.2 : -0.2;
    return "a=" + a.toFixed(2) + " b=" + ((dy - a * dx * dx) / dx).toFixed(2);
  }
  if (currentForm === "factored") {
    return "r=0  s=" + dx.toFixed(2);
  }
  if (currentForm === "vertex") {
    var aH = fixedA;
    var bH = (dy - aH * dx * dx) / dx;
    return "h=" + (-bH / (2 * aH)).toFixed(2) + "  (test k)";
  }
  return "";
}

/*
  getBarrelAngle(a, b)
  Returns the angle (radians) of the barrel on the player dot,
  matching the tangent of the parabola at x=0: dy/dx = b.

  Uses atan2(−b·CELL_HEIGHT, CELL_WIDTH) because canvas Y is inverted.
  Reference: MDN Math.atan2
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/atan2
*/
function getBarrelAngle(a, b) {
  return Math.atan2(-b * CELL_HEIGHT, CELL_WIDTH);
}

/* Triggers the CSS shake animation on the canvas */
function triggerShake() {
  canvas.classList.remove("shaking");
  void canvas.offsetWidth; // Force reflow so the animation restarts
  canvas.classList.add("shaking");
  setTimeout(function() { canvas.classList.remove("shaking"); }, 350);
}


/* ═══════════════════════════════════════════════════════════════
   PARTICLE EXPLOSION
   A simple particle system spawned on a successful hit.
   Each particle has position, velocity, life (fades to 0), and radius.

   Reference: Basic particle systems in Canvas
   https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Advanced_animations
═══════════════════════════════════════════════════════════════ */

function spawnExplosion(px, py) {
  particles = [];
  for (var i = 0; i < 16; i++) {
    var angle = (i / 16) * Math.PI * 2;
    var speed = 3 + Math.random() * 4;
    particles.push({
      x: px,  y: py,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life:   1,                          // 1 = fully visible, 0 = gone
      radius: 4 + Math.random() * 4
    });
  }
}

/*
  drawAndUpdateParticles()
  Moves each particle by its velocity, reduces its life, and draws it.
  Returns true if any particle is still alive (so the caller knows
  to keep requesting animation frames).
*/
function drawAndUpdateParticles() {
  var anyAlive = false;
  for (var i = 0; i < particles.length; i++) {
    var p = particles[i];
    if (p.life <= 0) continue;

    p.x += p.vx;
    p.y += p.vy;
    p.life -= 0.035; // Fade rate — higher = faster fade

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,140,0," + p.life + ")"; // Orange, fading out
    ctx.fill();
    anyAlive = true;
  }
  return anyAlive;
}

/*
  animateExplosion(done)
  Recursive rAF loop: redraws the scene + particles each frame.
  Calls done() when all particles have faded.
*/
function animateExplosion(done) {
  draw();
  var still = drawAndUpdateParticles();
  if (still) {
    requestAnimationFrame(function() { animateExplosion(done); });
  } else {
    setTimeout(done, 200); // Small delay before starting the next level
  }
}


/* ═══════════════════════════════════════════════════════════════
   CANVAS DRAWING
═══════════════════════════════════════════════════════════════ */

/*
  drawDotWithBarrel(px, py, dotR, color, angle, bLen, bW)
  Draws a circular dot with a rectangular "barrel" rotated to
  match the last-shot parabola's tangent angle.

  ctx.save() / ctx.restore() isolate the transform so subsequent
  draws are not affected.
  Reference: Canvas transforms
  https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Transformations
*/
function drawDotWithBarrel(px, py, dotR, color, angle, bLen, bW) {
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.fillRect(dotR - 2, -bW / 2, bLen, bW); // The barrel rectangle
  ctx.restore();

  // Draw the circular dot on top
  ctx.beginPath();
  ctx.arc(px, py, dotR, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

/*
  drawWalls()
  Renders each wall as an orange translucent rectangle plus a
  Y-threshold label.
*/
function drawWalls() {
  for (var i = 0; i < walls.length; i++) {
    var w   = walls[i];
    var top = gridToPixel(w.gridX, w.topGridY);
    var bot = gridToPixel(w.gridX, 0);           // Bottom of the wall = grid Y 0 = canvas bottom

    var wx = w.gridX * CELL_WIDTH - CELL_WIDTH * 0.15;
    var ww = CELL_WIDTH * 0.3;

    // Translucent orange fill
    ctx.fillStyle = "rgba(255,140,0,0.25)";
    ctx.fillRect(wx, top.py, ww, bot.py - top.py);

    // Orange border
    ctx.strokeStyle = "orange";
    ctx.lineWidth = 2;
    ctx.strokeRect(wx, top.py, ww, bot.py - top.py);

    // Solid cap at the top
    ctx.fillStyle = "orange";
    ctx.fillRect(wx, top.py, ww, 4);

    // Label showing the Y threshold
    ctx.fillStyle = "rgba(255,165,0,0.8)";
    ctx.font = Math.floor(CELL_HEIGHT * 0.18) + "px monospace";
    ctx.textAlign = "center";
    ctx.fillText("y≤" + w.topGridY, w.gridX * CELL_WIDTH, top.py - 6);
  }
}

/*
  updateModifierBadges()
  Rebuilds the modifier badge area in the HUD (walls / flipped / laser).
*/
function updateModifierBadges() {
  var c = document.getElementById("modifier-badges");
  c.innerHTML = "";

  if (walls.length > 0) {
    var wb = document.createElement("div");
    wb.className = "mod-badge wall-badge";
    wb.textContent = "⚠ Walls Active";
    c.appendChild(wb);
  }
  if (flippedParabola) {
    var fb = document.createElement("div");
    fb.className = "mod-badge flip-badge";
    fb.textContent = "↑ Flipped (a > 0)";
    c.appendChild(fb);
  }
  if (laserCharges > 0) {
    var lb = document.createElement("div");
    lb.className = "mod-badge laser-badge";
    lb.textContent = "⚡ Laser ×" + laserCharges;
    c.appendChild(lb);
  }
}

/*
  drawTracker()
  Draws a downward-pointing arrow and coordinate label at the
  top of the canvas, directly above the projectile's current
  x-position, so the player can see where the shot is heading
  relative to grid coordinates.

  Only shown while trackerPos is set (i.e. during a shot).
*/
function drawTracker() {
  if (!trackerPos || trackerPos.py >= 0) return;
  var ax  = Math.max(30, Math.min(CANVAS_WIDTH - 30, trackerPos.px));
  var ay  = 16, aw = 10, ah = 13;

  // Vertical line below the arrow
  ctx.save();
  ctx.strokeStyle = "rgba(255,220,0,0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ax, ay + ah + 2);
  ctx.lineTo(ax, ay + ah + 12);
  ctx.stroke();

  // Arrow triangle (pointing down)
  ctx.fillStyle = "rgba(255,220,0,0.9)";
  ctx.beginPath();
  ctx.moveTo(ax,      ay);
  ctx.lineTo(ax - aw, ay + ah);
  ctx.lineTo(ax + aw, ay + ah);
  ctx.closePath();
  ctx.fill();

  // Coordinate text
  ctx.fillStyle = "rgba(255,220,0,0.85)";
  ctx.font = "11px monospace";
  ctx.textAlign = "center";
  ctx.fillText("x=" + trackerPos.worldX.toFixed(1), ax, ay + ah + 24);
  ctx.fillText("y=" + trackerPos.worldY.toFixed(1), ax, ay + ah + 36);
  ctx.restore();
}

/*
  draw()
  Main draw function — clears the canvas and redraws everything:
    1. Black background
    2. Grid lines + axis labels
    3. Walls (if any)
    4. Past shot trails
    5. Player dot with barrel
    6. Enemy dot
    7. Tracker arrow (if a shot is in flight above the screen)
*/
function draw() {
  // Clear
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Grid lines
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 1;
  for (var col = 0; col <= GRID_COLS; col++) {
    ctx.beginPath();
    ctx.moveTo(col * CELL_WIDTH, 0);
    ctx.lineTo(col * CELL_WIDTH, CANVAS_HEIGHT);
    ctx.stroke();
  }
  for (var row = 0; row <= GRID_ROWS; row++) {
    ctx.beginPath();
    ctx.moveTo(0, row * CELL_HEIGHT);
    ctx.lineTo(CANVAS_WIDTH, row * CELL_HEIGHT);
    ctx.stroke();
  }

  // Axis labels along bottom and left edges
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.font = Math.floor(CELL_HEIGHT * 0.2) + "px monospace";
  ctx.textAlign = "left";
  for (var i = 1; i <= GRID_COLS; i++) {
    ctx.fillText(i, i * CELL_WIDTH + 4, CANVAS_HEIGHT - 6);
  }
  for (var j = 1; j <= GRID_ROWS; j++) {
    ctx.fillText(j, 4, CANVAS_HEIGHT - j * CELL_HEIGHT - 4);
  }

  drawWalls();

  // Past shot trails (faded lines from previous shots)
  for (var s = 0; s < pastShots.length; s++) {
    var shot = pastShots[s];
    if (shot.length < 2) continue;
    ctx.save();
    if (shot.isLaser) {
      ctx.strokeStyle = "rgba(255,230,0,0.45)";
      ctx.lineWidth = 2.5;
      ctx.shadowColor = "rgba(255,220,0,0.5)";
      ctx.shadowBlur = 6;
    } else {
      ctx.strokeStyle = "rgba(160,210,255,0.55)";
      ctx.lineWidth = 2.5;
      ctx.shadowColor = "rgba(100,180,255,0.6)";
      ctx.shadowBlur = 8;
    }
    ctx.beginPath();
    ctx.moveTo(shot[0].px, shot[0].py);
    for (var p = 1; p < shot.length; p++) {
      ctx.lineTo(shot[p].px, shot[p].py);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Player dot
  var player = gridToPixel(playerX, playerY);
  var dotR   = Math.max(7, Math.min(CELL_WIDTH, CELL_HEIGHT) * 0.18);
  var barrelAngle = lastAB ? getBarrelAngle(lastAB.a, lastAB.b) : 0;
  drawDotWithBarrel(player.px, player.py, dotR, "#0cc", barrelAngle, dotR * 2.2, dotR * 0.7);

  // Player coordinate label
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = Math.floor(CELL_HEIGHT * 0.18) + "px monospace";
  ctx.textAlign = "left";
  ctx.fillText("(" + playerX + "," + playerY + ")", player.px + dotR + 6, player.py - 7);

  // Enemy dot
  var enemy = gridToPixel(enemyX, enemyY);
  ctx.beginPath();
  ctx.arc(enemy.px, enemy.py, dotR, 0, Math.PI * 2);
  ctx.fillStyle = "#e44";
  ctx.fill();

  // Enemy coordinate label
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillText("(" + enemyX + "," + enemyY + ")", enemy.px + dotR + 6, enemy.py - 7);

  drawTracker();
}


/* ═══════════════════════════════════════════════════════════════
   SHOOTING
   The projectile is animated using requestAnimationFrame.
   Parameter t starts at 0 and advances by 0.05 per frame,
   representing "how far along the x-axis from the player".

   worldX = playerX + t
   worldY = playerY + a·t² + b·t   (parabolic motion)
   or
   worldY = m·worldX + bAuto        (laser / linear)

   The shot ends when:
     - It passes the enemy's X column by more than 1 unit (out-of-bounds)
     - It drops below Y = 0 (hits the ground)
     - It enters a wall cell
     - It comes within 14px of the enemy dot centre
═══════════════════════════════════════════════════════════════ */

/*
  isNearEnemy(px, py)
  Returns true if the canvas pixel position is within 14px of
  the enemy dot.  14px is roughly half the dot radius so the
  hit feels responsive without requiring pixel-perfect aim.
*/
function isNearEnemy(px, py) {
  var e  = gridToPixel(enemyX, enemyY);
  var dx = px - e.px;
  var dy = py - e.py;
  return Math.sqrt(dx * dx + dy * dy) < 14;
}

/*
  shoot()
  Validates inputs, reads the equation, then starts the parabolic
  or laser animation depending on laserArmed.
*/
function shoot() {
  if (isShooting) return;
  if (shotsLeft <= 0) { setMessage("No shots left!"); return; }
  closeHint();

  var inputs = readInputs();
  if (!inputs) return;

  isShooting = true;
  setMessage("");

  // Delegate to laser path if armed
  if (inputs.isLaser) {
    laserCharges--;
    laserArmed = false;
    updateModifierBadges();
    shootLaser(inputs.m, inputs.bAuto);
    return;
  }

  var a = inputs.a;
  var b = inputs.b;
  lastAB = { a: a, b: b }; // Remember for barrel angle

  var path = []; // Stores {px, py} points for the trail
  var t    = 0;  // Parameter: distance along X from player

  function step() {
    var worldX = playerX + t;
    var worldY = playerY + (a * t * t + b * t); // Parabola equation
    var pos    = gridToPixel(worldX, worldY);

    // Out-of-bounds check
    if (worldX > enemyX + 1 || worldY < -30) {
      trackerPos = null;
      finishShot(path, false, pos.px, pos.py, "oob", false);
      return;
    }

    // Update tracker arrow
    trackerPos = { px: pos.px, py: pos.py, worldX: worldX, worldY: worldY };

    var onScreen = pos.py >= 0 && pos.py <= CANVAS_HEIGHT &&
                   pos.px >= 0 && pos.px <= CANVAS_WIDTH;
    if (onScreen) path.push({ px: pos.px, py: pos.py });

    // Redraw the scene and overlay the active trail on top
    draw();
    if (onScreen && path.length > 0) {
      // Glow layer
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = flippedParabola ? "rgba(0,220,255,0.35)" : "rgba(100,180,255,0.35)";
      ctx.lineWidth = 6;
      ctx.shadowColor = flippedParabola ? "#0cf" : "#88aaff";
      ctx.shadowBlur = 14;
      for (var i = 0; i < path.length; i++) {
        if (i === 0) ctx.moveTo(path[i].px, path[i].py);
        else         ctx.lineTo(path[i].px, path[i].py);
      }
      ctx.stroke();
      ctx.restore();

      // Sharp trail line
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = flippedParabola ? "rgba(0,240,255,0.95)" : "rgba(200,230,255,0.95)";
      ctx.lineWidth = 2.5;
      for (var i = 0; i < path.length; i++) {
        if (i === 0) ctx.moveTo(path[i].px, path[i].py);
        else         ctx.lineTo(path[i].px, path[i].py);
      }
      ctx.stroke();
      ctx.restore();

      // Projectile head dot
      ctx.beginPath();
      ctx.arc(pos.px, pos.py, 5, 0, Math.PI * 2);
      ctx.fillStyle = flippedParabola ? "#0ff" : "#cce8ff";
      ctx.fill();
    }

    // Collision checks
    if (isBlockedByWall(worldX, worldY)) { trackerPos = null; finishShot(path, false, pos.px, pos.py, "wall", false); return; }
    if (isNearEnemy(pos.px, pos.py))      { trackerPos = null; finishShot(path, true,  pos.px, pos.py, "hit",  false); return; }

    t += 0.05;
    requestAnimationFrame(step);
  }
  step();
}

/*
  shootLaser(m, bAuto)
  Animates a straight-line laser shot.
  Equation: y = m·worldX + bAuto
  bAuto is set so the line passes exactly through (playerX, playerY).
*/
function shootLaser(m, bAuto) {
  lastAB = { a: 0, b: m };
  var path = [];
  path.isLaser = true;
  var t = 0;

  function stepL() {
    var worldX = playerX + t;
    var worldY = m * worldX + bAuto;
    var pos    = gridToPixel(worldX, worldY);

    if (worldX > enemyX + 1 || worldY < 0) { trackerPos = null; finishShot(path, false, pos.px, pos.py, "oob", true); return; }

    trackerPos = { px: pos.px, py: pos.py, worldX: worldX, worldY: worldY };

    var onScreen = pos.py >= 0 && pos.py <= CANVAS_HEIGHT &&
                   pos.px >= 0 && pos.px <= CANVAS_WIDTH;
    if (onScreen) path.push({ px: pos.px, py: pos.py });

    draw();
    if (onScreen && path.length > 0) {
      // Yellow glow
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255,240,0,0.35)";
      ctx.lineWidth = 8;
      ctx.shadowColor = "yellow";
      ctx.shadowBlur = 20;
      for (var i = 0; i < path.length; i++) {
        if (i === 0) ctx.moveTo(path[i].px, path[i].py);
        else         ctx.lineTo(path[i].px, path[i].py);
      }
      ctx.stroke();
      ctx.restore();

      // Bright yellow beam
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255,248,180,0.98)";
      ctx.lineWidth = 3;
      for (var i = 0; i < path.length; i++) {
        if (i === 0) ctx.moveTo(path[i].px, path[i].py);
        else         ctx.lineTo(path[i].px, path[i].py);
      }
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(pos.px, pos.py, 4, 0, Math.PI * 2);
      ctx.fillStyle = "white";
      ctx.fill();
    }

    if (isBlockedByWall(worldX, worldY)) { trackerPos = null; finishShot(path, false, pos.px, pos.py, "wall", true); return; }
    if (isNearEnemy(pos.px, pos.py))      { trackerPos = null; finishShot(path, true,  pos.px, pos.py, "hit",  true); return; }

    t += 0.05;
    requestAnimationFrame(stepL);
  }
  stepL();
}

/*
  finishShot(path, didHit, hitPx, hitPy, reason, isLaser)
  Called when a shot ends for any reason.
  Decrements shots, stores the trail, and handles the outcome:
    Hit  → explosion → advance level
    Miss → show feedback, let player try again
    OOB  → same as miss
    Wall → wall message
*/
function finishShot(path, didHit, hitPx, hitPy, reason, isLaser) {
  isShooting = false;
  laserArmed = false;
  trackerPos = null;

  if (isLaser) path.isLaser = true;

  // Store trail (cap at 20 to avoid memory growth)
  pastShots.push(path);
  if (pastShots.length > 20) pastShots.shift();

  shotsLeft--;

  if (didHit) {
    setMessage("Hit!");
    triggerShake();
    spawnExplosion(hitPx, hitPy);
    animateExplosion(function() {
      level++;
      checkLaserReward();
      shotsLeft = 5;
      pastShots = [];
      particles = [];
      lastAB    = null;
      startLevel();
    });
  } else {
    if (reason === "wall") setMessage("Wall blocked your shot! Arc higher.");
    if (shotsLeft <= 0) {
      // Game over — show the answer, return to home after a delay
      saveHighScore();
      setMessage("Out of shots!  Hint: " + getAnswer() + "  — back to menu…");
      setTimeout(function() { goTo("screen-home"); }, 3500);
    } else {
      if (reason !== "wall") setMessage("Miss!");
      updateHUD();
      draw();
    }
  }
}


/* ═══════════════════════════════════════════════════════════════
   HUD & MESSAGING
═══════════════════════════════════════════════════════════════ */

/* Updates the level/shots text in the HUD and refreshes modifier badges */
function updateHUD() {
  document.getElementById("hud").textContent = "Level: " + level + "   |   Shots: " + shotsLeft;
  updateModifierBadges();
}

/* Sets the floating message text (hit / miss / error messages) */
function setMessage(t) {
  document.getElementById("msg").textContent = t;
}


/* ═══════════════════════════════════════════════════════════════
   HINT SYSTEM
   One hint per level; the button becomes greyed after use.
   Hints give a nudge toward the correct a/b/r/s/h values without
   giving away the full answer.
═══════════════════════════════════════════════════════════════ */

function useHint() {
  if (hintUsedThisLevel || isShooting) return;
  hintUsedThisLevel = true;
  hintsUsedTotal++;   // Session-level counter tracked in username/highscore

  var btn = document.getElementById("hint-btn");
  btn.classList.add("used");
  btn.textContent = "💡 Used";

  var dx = enemyX - playerX;
  var dy = enemyY - playerY;
  var hintText = "";

  if (currentForm === "general") {
    var aH = flippedParabola ? 0.2 : -0.2;
    hintText = "Try a = " + aH + "\nHint: b ≈ " + ((dy - aH * dx * dx) / dx).toFixed(2);

  } else if (currentForm === "factored") {
    hintText = "y = " + fixedA + "(x − r)(x − s)\n" +
               "Try r = 0\n" +
               "Enemy is " + dx.toFixed(1) + " units away.";

  } else if (currentForm === "vertex") {
    var aV = fixedA;
    var bV = (dy - aV * dx * dx) / dx;
    hintText = "y = " + fixedA + "(x − h)² + k\n" +
               "Hint: h ≈ " + (-bV / (2 * aV)).toFixed(2) + "\n" +
               "Adjust k for height.";
  }

  document.getElementById("hint-body").textContent = hintText;
  document.getElementById("hint-popup").classList.add("visible");
}

/* Closes the hint popup (also called before every shot) */
function closeHint() {
  document.getElementById("hint-popup").classList.remove("visible");
}


/* ═══════════════════════════════════════════════════════════════
   HIGH SCORE (session only — no server/localStorage)
═══════════════════════════════════════════════════════════════ */

/* Best score data for this browser session */
var highScore      = { name: "", level: 0, hints: 0 };
var hintsUsedTotal = 0; // Accumulated across all levels this session

/*
  saveHighScore()
  Replaces the stored best if the current level exceeds it.
  Called on game-over and when navigating back to home.
*/
function saveHighScore() {
  var u = document.getElementById("username-input").value.trim() || "Anonymous";
  if (level > highScore.level) {
    highScore = { name: u, level: level, hints: hintsUsedTotal };
  }
  showHighScore();
}

/* Renders the high-score line on the home screen */
function showHighScore() {
  var d = document.getElementById("highscore-display");
  if (highScore.level === 0) { d.textContent = ""; return; }
  d.innerHTML =
    "Best: <span class='hs-name'>"  + highScore.name  + "</span> — " +
    "Level <span class='hs-level'>" + highScore.level + "</span>" +
    "<span class='hs-hints'>Hints used: " + highScore.hints + "</span>";
}

/* Used by the ← Back button in the game screen */
function returnToHome() {
  saveHighScore();
  goTo("screen-home");
}


/* ═══════════════════════════════════════════════════════════════
   USERNAME VALIDATION
═══════════════════════════════════════════════════════════════ */

/*
  tryPlay()
  Called by the Play button and Enter key on the username input.
  Validates that a username was entered before proceeding.
*/
function tryPlay() {
  var u = document.getElementById("username-input").value.trim();
  var e = document.getElementById("username-error");

  if (!u) {
    e.textContent = "⚠ Enter a username to continue";
    var inp = document.getElementById("username-input");
    inp.style.borderBottomColor = "#e02020";
    setTimeout(function() { inp.style.borderBottomColor = ""; }, 1200);
    return;
  }

  e.textContent = "";
  goTo("screen-mode");
}


/* ═══════════════════════════════════════════════════════════════
   LEVEL & GAME INITIALISATION
═══════════════════════════════════════════════════════════════ */

/*
  startLevel()
  Resets per-level state and kicks off a fresh level:
    1. Roll modifiers (walls / flipped)
    2. Pick equation form and fixedA
    3. Place dots randomly
    4. Build walls if active
    5. Rebuild control bar
    6. Resize canvas (window may have changed since last level)
    7. Draw the initial scene
*/
function startLevel() {
  rollModifiers(level);
  pickForm(level);
  placeDots();
  buildWalls();

  laserArmed = false;
  lastAB     = null;
  trackerPos = null;

  hintUsedThisLevel = false;
  var hb = document.getElementById("hint-btn");
  if (hb) { hb.classList.remove("used"); hb.textContent = "💡 Hint"; }

  closeHint();
  setMessage("");
  updateHUD();
  renderControls();
  resizeCanvas();
  draw();
}

/*
  startGame()
  Full game reset — called when entering PvE from the mode select.
  Sets level = 1 and fires startLevel().
*/
function startGame() {
  level       = 1;
  shotsLeft   = 5;
  pastShots   = [];
  particles   = [];
  isShooting  = false;
  lastAB      = null;
  laserCharges = 0;
  laserArmed  = false;
  walls       = [];
  hasWalls    = false;
  flippedParabola = false;
  trackerPos  = null;
  hintsUsedTotal  = 0;
  hintUsedThisLevel = false;

  startLevel();
}

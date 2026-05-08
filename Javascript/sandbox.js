/*
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  sandbox.js — Math Attaque  (Sandbox mode)                  ║
 * ║                                                              ║
 * ║  The Sandbox is a free-practice mode:                        ║
 * ║    • No level progression or shot limits                    ║
 * ║    • All four equation forms available via tabs             ║
 * ║    • Wall can be toggled and repositioned                    ║
 * ║    • Session stats tracked in the sidebar                   ║
 * ║    • Shot history log with colour-coded results             ║
 * ║                                                              ║
 * ║  KEY DESIGN DECISION — anchoring shots to the player dot:   ║
 * ║    All equations are offset at runtime so the projectile     ║
 * ║    always starts exactly at (sbPlayerX, sbPlayerY).          ║
 * ║    This means players can focus on the shape of the curve   ║
 * ║    without having to also think about vertical shifts.       ║
 * ╚══════════════════════════════════════════════════════════════╝
 */


/* ═══════════════════════════════════════════════════════════════
   CANVAS SETUP
   The sandbox canvas lives inside #sb-canvas-wrap which takes the
   remaining width after the 310px sidebar.  We query the wrapper's
   clientWidth/clientHeight to get the true available size.
═══════════════════════════════════════════════════════════════ */

var sbCanvas = document.getElementById("sb-c");
var sbCtx    = sbCanvas.getContext("2d");

// Grid dimensions match PvE (16 × 10 cells)
var SB_COLS = 16;
var SB_ROWS = 10;

// Pixel dimensions — set by sbResizeCanvas()
var SB_W, SB_H, SB_CW, SB_CH;

/*
  sbResizeCanvas()
  Measures the canvas wrapper and updates canvas.width/height.
  Called on startup, on window resize, and whenever the sidebar
  state might have changed (via the shared window resize listener).
*/
function sbResizeCanvas() {
  var wrap = document.getElementById("sb-canvas-wrap");
  SB_W = wrap.clientWidth;
  SB_H = wrap.clientHeight;
  sbCanvas.width  = SB_W;
  sbCanvas.height = SB_H;
  SB_CW = SB_W / SB_COLS;
  SB_CH = SB_H / SB_ROWS;
}

/*
  sbGtp(gx, gy)
  Grid-to-pixel conversion for the sandbox canvas.
  Same Y-inversion as PvE: grid Y=0 is at the canvas bottom.
*/
function sbGtp(gx, gy) {
  return {
    px: gx * SB_CW,
    py: SB_H - gy * SB_CH
  };
}


/* ═══════════════════════════════════════════════════════════════
   SANDBOX STATE
═══════════════════════════════════════════════════════════════ */

var sbPlayerX = 2,  sbPlayerY = 3;  // Player dot grid position
var sbEnemyX  = 13, sbEnemyY  = 4;  // Enemy dot grid position

var sbWallEnabled = false; // Whether the wall obstacle is on
var sbWallGX      = 7;     // Wall column (grid X)
var sbWallTopGY   = 4;     // Wall top row (grid Y) — blocks y ≤ this value

var sbCurrentForm = "general"; // Active equation form tab

var sbPastShots  = [];     // Array of shot objects {path, label, result, isLinear}
var sbIsShooting = false;  // True during a projectile animation

var sbStats = { total: 0, hits: 0, miss: 0, walls: 0 }; // Session counters

var sbMsgTimer  = null;    // Auto-clear timer for the floating message
var sbParticles = [];      // Active explosion particles


/* ═══════════════════════════════════════════════════════════════
   ENTRY POINT
═══════════════════════════════════════════════════════════════ */

/*
  startSandbox()
  Called from index.html when the Sandbox button is clicked.
  Initialises canvas dimensions, applies the default setup,
  renders the equation inputs, and draws the initial scene.
*/
function startSandbox() {
  sbResizeCanvas();
  sbApplySetup();
  sbRenderEqInputs();
  sbUpdateHud();
  sbDraw();
}


/* ═══════════════════════════════════════════════════════════════
   EQUATION FORM UI
   Four form types, each with different parameters:
     General:  y = a·t² + b·t + c + py    (t = worldX − playerX)
     Factored: y = A(x−r)(x−s), anchored
     Vertex:   y = A(x−h)² + k_nudge, anchored
     Linear:   y = m(x − playerX) + playerY
═══════════════════════════════════════════════════════════════ */

/*
  sbSetForm(formName, tabElement)
  Switches the active equation form and rebuilds the input fields.
  The clicked tab element gets class "active" (cyan background in CSS).
*/
function sbSetForm(f, btn) {
  sbCurrentForm = f;
  // Remove "active" from all tabs, then add it to the clicked one
  document.querySelectorAll(".form-tab").forEach(function(t) {
    t.classList.remove("active");
  });
  btn.classList.add("active");
  sbRenderEqInputs();
}

/*
  sbCurveY(params, worldX)
  ─────────────────────────────────────────────────────────────
  The core math function.  Returns the world-Y for any world-X,
  given the current equation parameters.

  All forms are ANCHORED to the player dot — the curve always
  passes through (sbPlayerX, sbPlayerY) regardless of parameters.

  How anchoring works for each form:
  ──────────────────────────────────
  General (t = worldX − playerX):
    y = py + a·t² + b·t + c
    At t=0 (x = playerX): y = py + c
    c=0 (default) means the shot starts exactly at the player dot.
    c ≠ 0 shifts the entire curve up/down.

  Factored (y = A(x−r)(x−s)):
    The raw formula gives some value at x = playerX.
    We subtract that value and add py to anchor it:
    y = A(x−r)(x−s) − A(px−r)(px−s) + py
    So at x = playerX: y = 0 + py ✓

  Vertex (y = A(x−h)² + k):
    Similar offset approach:
    y = A(x−h)² − A(px−h)² + py + k_nudge
    At x = playerX: y = 0 + py + k_nudge
    k is a "nudge" above the player dot (usually 0 = starts at dot).

  Linear:
    y = m(x − playerX) + playerY
    Always passes through player dot by construction.
*/
function sbCurveY(params, worldX) {
  var t = worldX - sbPlayerX; // Horizontal offset from player

  if (params.isLinear) {
    // Straight line through the player dot
    return params.m * t + sbPlayerY;
  }

  if (params.isFactored) {
    var A = params.A, r = params.r, s = params.s;
    var px = sbPlayerX, py = sbPlayerY;
    var atPx = A * (px - r) * (px - s); // Value of raw formula at player X
    return A * (worldX - r) * (worldX - s) - atPx + py; // Anchor offset
  }

  if (params.isVertex) {
    var A = params.A, h = params.h, k = params.k;
    var px = sbPlayerX, py = sbPlayerY;
    // Anchor offset: subtract the vertex value at player X, then add py and nudge
    return A * (worldX - h) * (worldX - h) - A * (px - h) * (px - h) + py + k;
  }

  // General form: y = py + a·t² + b·t + c
  return sbPlayerY + params.a * t * t + params.b * t + (params.c || 0);
}

/*
  sbRenderEqInputs()
  Rebuilds the input fields inside #eq-inputs based on sbCurrentForm.
  Each input has oninput="sbPreviewEq()" for live equation preview.
*/
function sbRenderEqInputs() {
  var c = document.getElementById("eq-inputs");
  var p = document.getElementById("eq-preview");
  p.textContent = "";

  if (sbCurrentForm === "general") {
    // Three parameters: a (quadratic), b (linear), c (vertical nudge)
    c.innerHTML =
      "<div class='eq-row' style='margin-top:8px;'>" +
        "<span class='eq-label'>y =</span>" +
        "<input id='iA' placeholder='a' oninput='sbPreviewEq()'>" +
        "<span class='eq-label'>t² +</span>" +
        "<input id='iB' placeholder='b' oninput='sbPreviewEq()'>" +
        "<span class='eq-label'>t +</span>" +
        "<input id='iC' placeholder='c' value='0' oninput='sbPreviewEq()'>" +
        "<span class='eq-label'>+ py</span>" +
      "</div>" +
      "<div class='eq-note'>t = x − player_x &nbsp;|&nbsp; c=0 starts at your dot &nbsp;|&nbsp; a&gt;0 curves up, a&lt;0 curves down</div>";

  } else if (sbCurrentForm === "factored") {
    // Three parameters: A (leading coefficient), r, s (x-intercepts in absolute x)
    c.innerHTML =
      "<div class='eq-row' style='margin-top:8px;'>" +
        "<span class='eq-label'>y =</span>" +
        "<input id='iA' placeholder='A' oninput='sbPreviewEq()' style='width:52px'>" +
        "<span class='eq-label'>(x −</span>" +
        "<input id='iR' placeholder='r' oninput='sbPreviewEq()' style='width:52px'>" +
        "<span class='eq-label'>)(x −</span>" +
        "<input id='iS' placeholder='s' oninput='sbPreviewEq()' style='width:52px'>" +
        "<span class='eq-label'>)</span>" +
      "</div>" +
      "<div class='eq-note'>Anchored to player dot. A&gt;0 = up, A&lt;0 = down &nbsp;|&nbsp; r,s are x-intercepts</div>";

  } else if (sbCurrentForm === "vertex") {
    // Three parameters: A, h (vertex x), k (vertical nudge above player dot)
    c.innerHTML =
      "<div class='eq-row' style='margin-top:8px;'>" +
        "<span class='eq-label'>y =</span>" +
        "<input id='iA' placeholder='A' oninput='sbPreviewEq()' style='width:52px'>" +
        "<span class='eq-label'>(x −</span>" +
        "<input id='iH' placeholder='h' oninput='sbPreviewEq()' style='width:52px'>" +
        "<span class='eq-label'>)² +</span>" +
        "<input id='iK' placeholder='k' value='0' oninput='sbPreviewEq()'>" +
      "</div>" +
      "<div class='eq-note'>Anchored to player dot. k = vertical nudge above dot &nbsp;|&nbsp; h = vertex x-position</div>";

  } else if (sbCurrentForm === "linear") {
    // One parameter: m (slope), player position shown as fixed values
    c.innerHTML =
      "<div class='eq-row' style='margin-top:8px;'>" +
        "<span class='eq-label'>y = m(x −</span>" +
        "<span class='eq-fixed'>" + sbPlayerX + "</span>" +
        "<span class='eq-label'>) +</span>" +
        "<span class='eq-fixed'>" + sbPlayerY + "</span>" +
        "<span class='eq-label'>&nbsp;&nbsp;m =</span>" +
        "<input id='iM' placeholder='m' oninput='sbPreviewEq()'>" +
      "</div>" +
      "<div class='eq-note'>Always passes through your dot. m&gt;0 = upward right, m&lt;0 = downward right</div>";
  }
}

/*
  sbPreviewEq()
  Called on every keypress in the equation inputs.
  Shows a formatted equation string below the inputs as live feedback.
*/
function sbPreviewEq() {
  var p = document.getElementById("eq-preview");
  var params = sbReadInputsSilent();
  if (!params) { p.textContent = ""; return; }

  if (params.isLinear) {
    p.textContent = "y = " + params.m + "(x−" + sbPlayerX + ") + " + sbPlayerY;
  } else if (params.isFactored) {
    p.textContent = "y = " + params.A + "(x−" + params.r + ")(x−" + params.s + ")  anchored to dot";
  } else if (params.isVertex) {
    p.textContent = "y = " + params.A + "(x−" + params.h + ")² + k_nudge(" + params.k + ")  anchored";
  } else {
    p.textContent = "y = " + params.a + "t² + " + params.b + "t + " + (params.c || 0) + " + py";
  }
}


/* ═══════════════════════════════════════════════════════════════
   INPUT PARSING
═══════════════════════════════════════════════════════════════ */

/*
  sbReadInputsSilent()
  Parses the current equation inputs and returns a params object,
  or null if any required field is empty/invalid.
  "Silent" = does not show error messages (used for live preview).
*/
function sbReadInputsSilent() {
  try {
    if (sbCurrentForm === "general") {
      var a = parseFloat(document.getElementById("iA").value);
      var b = parseFloat(document.getElementById("iB").value);
      var c = parseFloat(document.getElementById("iC").value) || 0;
      if (isNaN(a) || isNaN(b)) return null;
      return { a: a, b: b, c: c };

    } else if (sbCurrentForm === "factored") {
      var A = parseFloat(document.getElementById("iA").value);
      var r = parseFloat(document.getElementById("iR").value);
      var s = parseFloat(document.getElementById("iS").value);
      if (isNaN(A) || isNaN(r) || isNaN(s)) return null;
      return { isFactored: true, A: A, r: r, s: s };

    } else if (sbCurrentForm === "vertex") {
      var A = parseFloat(document.getElementById("iA").value);
      var h = parseFloat(document.getElementById("iH").value);
      var k = parseFloat(document.getElementById("iK").value) || 0;
      if (isNaN(A) || isNaN(h)) return null;
      return { isVertex: true, A: A, h: h, k: k };

    } else if (sbCurrentForm === "linear") {
      var m = parseFloat(document.getElementById("iM").value);
      if (isNaN(m)) return null;
      return { isLinear: true, m: m };
    }
  } catch (e) { return null; }
  return null;
}

/*
  sbReadInputs()
  Wrapper around sbReadInputsSilent() that also shows an error
  message to the player if fields are empty.
*/
function sbReadInputs() {
  var p = sbReadInputsSilent();
  if (!p) sbSetMsg("Fill in all equation values.");
  return p;
}

/*
  sbMakeLabel(params)
  Returns a compact string label for a shot (used in the log and formula bar).
  Examples:
    "m=0.5 (linear)"
    "A=-0.2(x−0)(x−11)"
    "a=-0.2 b=1.1 c=0"
*/
function sbMakeLabel(params) {
  if (params.isLinear)   return "m=" + params.m + " (linear)";
  if (params.isFactored) return "A=" + params.A + "(x−" + params.r + ")(x−" + params.s + ")";
  if (params.isVertex)   return "A=" + params.A + "(x−" + params.h + ")² k=" + params.k;
  return "a=" + params.a + " b=" + params.b + " c=" + (params.c || 0);
}


/* ═══════════════════════════════════════════════════════════════
   WALL CONTROLS
═══════════════════════════════════════════════════════════════ */

/*
  sbToggleWallInputs()
  Called when the wall enable/disable toggle changes.
  Shows/hides the wall coordinate inputs and redraws.
*/
function sbToggleWallInputs() {
  sbWallEnabled = document.getElementById("sbWallToggle").checked;
  document.getElementById("sb-wall-inputs").style.display = sbWallEnabled ? "block" : "none";
  sbDraw();
}

/* Randomises wall position within valid bounds and redraws */
function sbRandomizeWall() {
  document.getElementById("sbWallX").value =
    Math.floor(Math.random() * (sbEnemyX - sbPlayerX - 3)) + sbPlayerX + 2;
  document.getElementById("sbWallY").value = 2 + Math.floor(Math.random() * 5);
  sbDraw();
}

/*
  sbIsBlockedByWall(worldX, worldY)
  Returns true if the projectile at (worldX, worldY) collides with the wall.
  Reads live input values so the player can reposition the wall between shots.
  Horizontal tolerance ±0.55 prevents fast-moving shots from phasing through.
*/
function sbIsBlockedByWall(worldX, worldY) {
  if (!sbWallEnabled) return false;
  var wgx = clamp(parseInt(document.getElementById("sbWallX").value) || sbWallGX, 1, 15);
  var wgy = clamp(parseInt(document.getElementById("sbWallY").value) || sbWallTopGY, 1, 9);
  return Math.abs(worldX - wgx) < 0.55 && worldY <= wgy;
}


/* ═══════════════════════════════════════════════════════════════
   POSITION CONTROLS
═══════════════════════════════════════════════════════════════ */

/* Sets inputs to random valid positions and applies them */
function sbRandomizePositions() {
  document.getElementById("spX").value = Math.floor(Math.random() * 4) + 1;
  document.getElementById("spY").value = Math.floor(Math.random() * 6) + 2;
  document.getElementById("seX").value = Math.floor(Math.random() * 4) + 11;
  document.getElementById("seY").value = Math.floor(Math.random() * 6) + 2;
  sbApplySetup();
}

/*
  sbApplySetup()
  Reads all position/wall inputs, clamps them to valid ranges,
  updates the state variables, rebuilds the linear form's fixed labels
  (which embed the player position), and redraws.
*/
function sbApplySetup() {
  sbPlayerX = clamp(parseInt(document.getElementById("spX").value) || 2, 1, 7);
  sbPlayerY = clamp(parseInt(document.getElementById("spY").value) || 3, 1, 9);
  sbEnemyX  = clamp(parseInt(document.getElementById("seX").value) || 13, 8, 15);
  sbEnemyY  = clamp(parseInt(document.getElementById("seY").value) || 4, 1, 9);

  sbWallEnabled = document.getElementById("sbWallToggle").checked;
  sbWallGX      = clamp(parseInt(document.getElementById("sbWallX").value) || 7, sbPlayerX + 1, sbEnemyX - 1);
  sbWallTopGY   = clamp(parseInt(document.getElementById("sbWallY").value) || 4, 1, 9);

  // Linear form UI shows "y = m(x − PX) + PY" so it must be rebuilt when positions change
  if (sbCurrentForm === "linear") sbRenderEqInputs();

  sbUpdateHud();
  sbDraw();
}


/* ═══════════════════════════════════════════════════════════════
   SHOOTING
   Same rAF loop as PvE but uses sbCurveY() to support all forms.
   Increments t by 0.04 each frame (slightly smoother than PvE's 0.05).
═══════════════════════════════════════════════════════════════ */

/*
  sbIsNearEnemy(px, py)
  Hit detection: 16px radius (slightly larger than PvE at 14px)
  because the sandbox is for practice and doesn't need to be punishing.
*/
function sbIsNearEnemy(px, py) {
  var e  = sbGtp(sbEnemyX, sbEnemyY);
  var dx = px - e.px;
  var dy = py - e.py;
  return Math.sqrt(dx * dx + dy * dy) < 16;
}

/*
  sbShoot()
  Reads inputs, then runs the rAF animation loop.
  sbApplySetup() is called first to ensure positions/wall are in sync
  with the current input values.
*/
function sbShoot() {
  if (sbIsShooting) return;
  sbApplySetup(); // Sync state with inputs before firing

  var params = sbReadInputs();
  if (!params) return;

  sbIsShooting = true;
  sbSetMsg("");

  var path   = [];               // Pixel-coordinate trail
  var t      = 0;                // X offset parameter
  var label  = sbMakeLabel(params);
  var isLin  = params.isLinear;

  function step() {
    var worldX = sbPlayerX + t;
    var worldY = sbCurveY(params, worldX);
    var pos    = sbGtp(worldX, worldY);

    // Out-of-bounds: past enemy column or below Y=0 or above Y=rows+2
    var obb = worldX > sbEnemyX + 1.5 || worldY < 0 || worldY > SB_ROWS + 2;
    if (obb) { sbFinishShot(path, "miss", label, pos.px, pos.py, isLin); return; }

    var onScreen = pos.py >= 0 && pos.py <= SB_H &&
                   pos.px >= 0 && pos.px <= SB_W;
    if (onScreen) path.push({ px: pos.px, py: pos.py });

    sbDraw();                           // Redraw base scene
    sbDrawActivePath(path, isLin, pos); // Overlay active trail

    if (sbIsBlockedByWall(worldX, worldY)) { sbFinishShot(path, "wall", label, pos.px, pos.py, isLin); return; }
    if (sbIsNearEnemy(pos.px, pos.py))      { sbFinishShot(path, "hit",  label, pos.px, pos.py, isLin); return; }

    t += 0.04;
    requestAnimationFrame(step);
  }
  step();
}

/*
  sbDrawActivePath(path, isLin, pos)
  Draws the currently-animating trail on top of the static scene.
  Two passes: a wide glow layer + a sharp thin line.
  isLin selects yellow (laser-like) vs cyan (parabola) colouring.
*/
function sbDrawActivePath(path, isLin, pos) {
  if (path.length < 2) return;

  // Glow pass
  sbCtx.save();
  sbCtx.beginPath();
  sbCtx.strokeStyle = isLin ? "rgba(255,228,77,0.3)" : "rgba(0,204,204,0.3)";
  sbCtx.lineWidth = 8;
  sbCtx.shadowColor = isLin ? "#ffe44d" : "#0cc";
  sbCtx.shadowBlur  = 18;
  for (var i = 0; i < path.length; i++) {
    if (i === 0) sbCtx.moveTo(path[i].px, path[i].py);
    else         sbCtx.lineTo(path[i].px, path[i].py);
  }
  sbCtx.stroke();
  sbCtx.restore();

  // Sharp line pass
  sbCtx.save();
  sbCtx.beginPath();
  sbCtx.strokeStyle = isLin ? "rgba(255,248,160,0.98)" : "rgba(160,240,255,0.98)";
  sbCtx.lineWidth = 2.5;
  for (var i = 0; i < path.length; i++) {
    if (i === 0) sbCtx.moveTo(path[i].px, path[i].py);
    else         sbCtx.lineTo(path[i].px, path[i].py);
  }
  sbCtx.stroke();
  sbCtx.restore();

  // Projectile head dot
  sbCtx.beginPath();
  sbCtx.arc(pos.px, pos.py, 5, 0, Math.PI * 2);
  sbCtx.fillStyle = isLin ? "#ffe44d" : "#0ff";
  sbCtx.fill();
}


/* ═══════════════════════════════════════════════════════════════
   SANDBOX EXPLOSION
   Same concept as PvE but slightly larger (20 particles, faster).
═══════════════════════════════════════════════════════════════ */

function sbSpawnExplosion(px, py) {
  sbParticles = [];
  for (var i = 0; i < 20; i++) {
    var angle = (i / 20) * Math.PI * 2;
    var speed = 3 + Math.random() * 5;
    sbParticles.push({
      x: px, y: py,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      r:   3 + Math.random() * 5
    });
  }
}

/* Update and draw all active particles; called once per rAF frame */
function sbTickParticles() {
  for (var i = 0; i < sbParticles.length; i++) {
    var p = sbParticles[i];
    if (p.life <= 0) continue;
    p.x += p.vx;
    p.y += p.vy;
    p.life -= 0.03;
    sbCtx.beginPath();
    sbCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    sbCtx.fillStyle = "rgba(255,140,0," + p.life + ")";
    sbCtx.fill();
  }
}

/* rAF loop for the explosion animation */
function sbAnimateExplosion(done) {
  sbDraw();
  sbTickParticles();
  if (sbParticles.some(function(p) { return p.life > 0; })) {
    requestAnimationFrame(function() { sbAnimateExplosion(done); });
  } else {
    setTimeout(done, 100);
  }
}

/* Triggers the CSS shake on the sandbox canvas (shorter than PvE) */
function sbShake() {
  sbCanvas.classList.remove("shaking");
  void sbCanvas.offsetWidth; // Force reflow
  sbCanvas.classList.add("shaking");
  setTimeout(function() { sbCanvas.classList.remove("shaking"); }, 300);
}

/*
  sbFinishShot(path, result, label, hpx, hpy, isLin)
  Called when a sandbox shot ends.
  Updates stats, logs the entry, sets the message, and triggers
  the explosion animation on a hit.
*/
function sbFinishShot(path, result, label, hpx, hpy, isLin) {
  sbIsShooting = false;

  // Update stats
  sbStats.total++;
  if (result === "hit")  { sbStats.hits++;  sbShake(); sbSpawnExplosion(hpx, hpy); }
  if (result === "miss") { sbStats.miss++; }
  if (result === "wall") { sbStats.walls++; }

  // Store shot for redrawing as a trail
  path.isLinear = isLin;
  path.result   = result;
  sbPastShots.push({ path: path.slice(), label: label, result: result, isLinear: isLin });
  if (sbPastShots.length > 30) sbPastShots.shift(); // Cap at 30 stored trails

  sbUpdateStats();
  sbAddLogEntry(label, result);

  var msgMap = { hit: "✦ Hit!", miss: "Miss — adjust your equation.", wall: "⚠ Blocked by wall!" };
  sbSetMsg(msgMap[result] || "");

  sbUpdateFormulaBar();

  // Hit: run explosion then redraw; Miss/Wall: just redraw
  if (result === "hit") {
    sbAnimateExplosion(function() { sbDraw(); });
  } else {
    sbDraw();
  }
}


/* ═══════════════════════════════════════════════════════════════
   CANVAS DRAWING
═══════════════════════════════════════════════════════════════ */

/*
  sbDraw()
  Full scene redraw:
    1. Black background
    2. Grid lines + labels
    3. Wall (if enabled)
    4. Past shot trails (colour-coded by result)
    5. Player dot with glow ring
    6. Enemy dot with glow ring
*/
function sbDraw() {
  sbCtx.fillStyle = "#000";
  sbCtx.fillRect(0, 0, SB_W, SB_H);

  // Grid lines (slightly more transparent than PvE for readability)
  sbCtx.strokeStyle = "rgba(255,255,255,0.08)";
  sbCtx.lineWidth = 1;
  for (var col = 0; col <= SB_COLS; col++) {
    sbCtx.beginPath();
    sbCtx.moveTo(col * SB_CW, 0);
    sbCtx.lineTo(col * SB_CW, SB_H);
    sbCtx.stroke();
  }
  for (var row = 0; row <= SB_ROWS; row++) {
    sbCtx.beginPath();
    sbCtx.moveTo(0, row * SB_CH);
    sbCtx.lineTo(SB_W, row * SB_CH);
    sbCtx.stroke();
  }

  // Axis labels
  sbCtx.fillStyle = "rgba(255,255,255,0.2)";
  sbCtx.font = Math.floor(SB_CH * 0.18) + "px monospace";
  sbCtx.textAlign = "left";
  for (var i = 1; i <= SB_COLS; i++) sbCtx.fillText(i, i * SB_CW + 3, SB_H - 4);
  for (var j = 1; j <= SB_ROWS; j++) sbCtx.fillText(j, 3, SB_H - j * SB_CH - 3);

  // ── Wall ──────────────────────────────────────────────────
  if (sbWallEnabled) {
    var wx  = clamp(parseInt(document.getElementById("sbWallX").value) || sbWallGX, 1, 15);
    var wgy = clamp(parseInt(document.getElementById("sbWallY").value) || sbWallTopGY, 1, 9);
    var wTop = sbGtp(wx, wgy);
    var wBot = sbGtp(wx, 0);
    var wrx  = wx * SB_CW - SB_CW * 0.14;
    var wrw  = SB_CW * 0.28;

    sbCtx.fillStyle = "rgba(255,140,0,0.18)";
    sbCtx.fillRect(wrx, wTop.py, wrw, wBot.py - wTop.py);
    sbCtx.strokeStyle = "orange";
    sbCtx.lineWidth = 2;
    sbCtx.strokeRect(wrx, wTop.py, wrw, wBot.py - wTop.py);
    sbCtx.fillStyle = "orange";
    sbCtx.fillRect(wrx, wTop.py, wrw, 4); // Solid cap
    sbCtx.fillStyle = "rgba(255,165,0,0.8)";
    sbCtx.font = Math.floor(SB_CH * 0.17) + "px monospace";
    sbCtx.textAlign = "center";
    sbCtx.fillText("y≤" + wgy, wx * SB_CW, wTop.py - 5);
  }

  // ── Past shot trails ──────────────────────────────────────
  // Each trail is drawn twice: a faint glow pass + a sharper line
  for (var s = 0; s < sbPastShots.length; s++) {
    var shot = sbPastShots[s];
    if (shot.path.length < 2) continue;

    // Colour by outcome
    var col  = shot.result === "hit"  ? "rgba(100,255,160,0.3)"  :
               shot.result === "wall" ? "rgba(255,160,0,0.28)"   : "rgba(120,180,255,0.28)";
    var gCol = shot.result === "hit"  ? "rgba(60,255,120,0.12)"  :
               shot.result === "wall" ? "rgba(255,140,0,0.1)"    : "rgba(80,140,255,0.1)";

    // Glow pass
    sbCtx.save();
    sbCtx.beginPath();
    sbCtx.strokeStyle = gCol;
    sbCtx.lineWidth = 6;
    sbCtx.shadowColor = gCol;
    sbCtx.shadowBlur = 5;
    for (var p = 0; p < shot.path.length; p++) {
      if (p === 0) sbCtx.moveTo(shot.path[p].px, shot.path[p].py);
      else         sbCtx.lineTo(shot.path[p].px, shot.path[p].py);
    }
    sbCtx.stroke();

    // Sharp line pass
    sbCtx.beginPath();
    sbCtx.strokeStyle = col;
    sbCtx.lineWidth = 2;
    sbCtx.shadowBlur = 0;
    for (var p = 0; p < shot.path.length; p++) {
      if (p === 0) sbCtx.moveTo(shot.path[p].px, shot.path[p].py);
      else         sbCtx.lineTo(shot.path[p].px, shot.path[p].py);
    }
    sbCtx.stroke();
    sbCtx.restore();
  }

  var dotR = Math.max(7, Math.min(SB_CW, SB_CH) * 0.18);

  // ── Player dot ────────────────────────────────────────────
  var pl = sbGtp(sbPlayerX, sbPlayerY);
  // Outer glow ring
  sbCtx.beginPath();
  sbCtx.arc(pl.px, pl.py, dotR + 5, 0, Math.PI * 2);
  sbCtx.strokeStyle = "rgba(0,204,204,0.25)";
  sbCtx.lineWidth = 3;
  sbCtx.stroke();
  // Solid dot
  sbCtx.beginPath();
  sbCtx.arc(pl.px, pl.py, dotR, 0, Math.PI * 2);
  sbCtx.fillStyle = "#0cc";
  sbCtx.fill();
  // Label
  sbCtx.fillStyle = "rgba(255,255,255,0.6)";
  sbCtx.font = Math.floor(SB_CH * 0.16) + "px monospace";
  sbCtx.textAlign = "left";
  sbCtx.fillText("P(" + sbPlayerX + "," + sbPlayerY + ")", pl.px + dotR + 5, pl.py - 6);

  // ── Enemy dot ─────────────────────────────────────────────
  var en = sbGtp(sbEnemyX, sbEnemyY);
  sbCtx.beginPath();
  sbCtx.arc(en.px, en.py, dotR + 5, 0, Math.PI * 2);
  sbCtx.strokeStyle = "rgba(224,32,32,0.25)";
  sbCtx.lineWidth = 3;
  sbCtx.stroke();
  sbCtx.beginPath();
  sbCtx.arc(en.px, en.py, dotR, 0, Math.PI * 2);
  sbCtx.fillStyle = "#e44";
  sbCtx.fill();
  sbCtx.fillStyle = "rgba(255,255,255,0.6)";
  sbCtx.fillText("E(" + sbEnemyX + "," + sbEnemyY + ")", en.px + dotR + 5, en.py - 6);
}


/* ═══════════════════════════════════════════════════════════════
   UI HELPERS
═══════════════════════════════════════════════════════════════ */

/*
  sbSetMsg(text)
  Displays a message over the canvas and auto-clears it after 3.5 s.
  Clears any previous timer first to prevent overlapping clears.
*/
function sbSetMsg(t) {
  clearTimeout(sbMsgTimer);
  document.getElementById("sb-msg").textContent = t;
  if (t) {
    sbMsgTimer = setTimeout(function() {
      document.getElementById("sb-msg").textContent = "";
    }, 3500);
  }
}

/* Updates the top-right HUD showing P and E coordinates */
function sbUpdateHud() {
  document.getElementById("sb-hud-info").textContent =
    "P(" + sbPlayerX + "," + sbPlayerY + ")  →  E(" + sbEnemyX + "," + sbEnemyY + ")";
}

/*
  sbUpdateFormulaBar()
  Reads the current inputs and updates the bottom formula bar
  to show the last-shot equation in a formatted string.
*/
function sbUpdateFormulaBar() {
  var p  = sbReadInputsSilent();
  var fb = document.getElementById("sb-formula-bar");
  if (!p) { fb.innerHTML = "Equation will appear here"; return; }
  fb.innerHTML = "Last shot: <span>" + sbMakeLabel(p) + "</span>";
}

/* Refreshes the four stat counters in the sidebar */
function sbUpdateStats() {
  document.getElementById("sb-stat-total").textContent = sbStats.total;
  document.getElementById("sb-stat-hits").textContent  = sbStats.hits;
  document.getElementById("sb-stat-miss").textContent  = sbStats.miss;
  document.getElementById("sb-stat-walls").textContent = sbStats.walls;
}

/*
  sbAddLogEntry(label, result)
  Prepends a new row to the shot history log.
  Class "hit" | "miss" | "wall" controls the left-border colour in CSS.
  Trims the log to a maximum of 20 entries.
*/
function sbAddLogEntry(label, result) {
  var log   = document.getElementById("sb-shot-log");
  var entry = document.createElement("div");
  entry.className = "log-entry " + result;

  var rt = result === "hit"  ? "HIT ✓" :
           result === "wall" ? "WALL ✗" : "MISS ✗";

  entry.innerHTML =
    "<span class='log-eq'>"     + label + "</span>" +
    "<span class='log-result " + result + "'>" + rt + "</span>";

  log.insertBefore(entry, log.firstChild); // Newest entry at top

  // Keep log to 20 entries maximum
  while (log.children.length > 20) log.removeChild(log.lastChild);
}

/* Clears all trail lines without resetting stats */
function sbClearShots() {
  sbPastShots = [];
  sbDraw();
  sbSetMsg("Trails cleared.");
}

/* Full session reset: trails, stats, log, message, formula bar */
function sbResetAll() {
  sbPastShots  = [];
  sbParticles  = [];
  sbStats      = { total: 0, hits: 0, miss: 0, walls: 0 };
  sbUpdateStats();
  document.getElementById("sb-shot-log").innerHTML = "";
  document.getElementById("sb-formula-bar").innerHTML = "Equation will appear here";
  sbSetMsg("");
  sbDraw();
}

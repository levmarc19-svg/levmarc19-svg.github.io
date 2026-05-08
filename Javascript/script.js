/*
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  utils.js — Math Attaque                                    ║
 * ║                                                              ║
 * ║  Shared utility functions used by every other JS file.      ║
 * ║  Load this FIRST in index.html so game.js / sandbox.js      ║
 * ║  can call these functions without errors.                   ║
 * ╚══════════════════════════════════════════════════════════════╝
 */


/* ─────────────────────────────────────────────────────────────────
   CUSTOM CURSOR
   Moves the SVG crosshair element to follow the real mouse pointer.
   The native cursor is hidden via CSS (cursor:none on body).

   Why use mousemove instead of CSS cursor:url()?
   CSS custom cursors are limited in size (32×32 on some browsers)
   and can't be styled dynamically.  JS positioning has no such limits.

   Reference: MDN MouseEvent
   https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent
───────────────────────────────────────────────────────────────── */
var customCursor = document.getElementById("custom-cursor");

document.addEventListener("mousemove", function(e) {
  // e.clientX/Y = mouse position relative to the viewport
  // The SVG is already centred on this point via transform:translate(-50%,-50%) in CSS
  customCursor.style.left = e.clientX + "px";
  customCursor.style.top  = e.clientY + "px";
});


/* ─────────────────────────────────────────────────────────────────
   goTo(screenId)
   Shows the named screen and hides all others.
   Screens are <div class="screen"> — only the one with class
   "active" is rendered (display:flex vs display:none in CSS).

   Usage:
     goTo("screen-home")    → show home screen
     goTo("screen-game")    → show PvE canvas screen

   Reference: DOM classList API
   https://developer.mozilla.org/en-US/docs/Web/API/Element/classList
───────────────────────────────────────────────────────────────── */
function goTo(id) {
  // Remove "active" from every screen first
  document.querySelectorAll(".screen").forEach(function(s) {
    s.classList.remove("active");
  });
  // Then add it only to the target screen
  document.getElementById(id).classList.add("active");
}


/* ─────────────────────────────────────────────────────────────────
   clamp(value, min, max)
   Returns value clamped to the inclusive range [min, max].
   Equivalent to Math.max(min, Math.min(max, value)).

   Used extensively to keep grid coordinates in valid bounds
   and to prevent divide-by-zero or out-of-bounds canvas drawing.

   Examples:
     clamp(20, 1, 15) → 15   (too large, capped at max)
     clamp(-3, 1, 15) → 1    (negative, capped at min)
     clamp( 7, 1, 15) → 7    (already in range)
───────────────────────────────────────────────────────────────── */
function clamp(v, mn, mx) {
  return Math.max(mn, Math.min(mx, v));
}


/* ─────────────────────────────────────────────────────────────────
   randomInt(min, max)
   Returns a random integer in the inclusive range [min, max].

   Math.random() → uniform float in [0, 1)
   Multiplying by (max - min + 1) then flooring gives an integer
   in [0, max - min], which we shift up by adding min.

   Reference: MDN Math.random()
   https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/random
───────────────────────────────────────────────────────────────── */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}


/* ─────────────────────────────────────────────────────────────────
   KEYBOARD SHORTCUT: Enter = Shoot
   A single global keydown listener checks which screen is active
   and fires the appropriate shoot function.

   Why global?  Each screen doesn't have its own focus scope, so a
   screen-level listener would be tricky.  One document-level
   listener with an active-screen check is simpler and reliable.

   isShooting / sbIsShooting guards prevent queuing multiple shots
   while an animation is already running.
───────────────────────────────────────────────────────────────── */
document.addEventListener("keydown", function(e) {
  if (e.key !== "Enter") return; // Ignore all keys except Enter

  var sbScreen = document.getElementById("screen-sandbox");
  var gmScreen = document.getElementById("screen-game");

  // Sandbox screen is active and no shot is in flight
  if (sbScreen.classList.contains("active") && !sbIsShooting) {
    sbShoot();
  }
  // PvE screen is active and no shot is in flight
  else if (gmScreen.classList.contains("active") && !isShooting) {
    shoot();
  }
});

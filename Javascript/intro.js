/*
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  intro.js — Math Attaque                                    ║
 * ║                                                              ║
 * ║  Handles the two-video intro sequence:                       ║
 * ║    1. Opening Scene.mp4  (brand splash)                     ║
 * ║    2. Loading screen.mp4 (fake loading bar / atmosphere)    ║
 * ║                                                              ║
 * ║  After both videos play (or on error / timeout), the game   ║
 * ║  automatically navigates to the Home screen.                ║
 * ╚══════════════════════════════════════════════════════════════╝
 */


/* ── Video element references ───────────────────────────────── */
var videoOpening = document.getElementById("video-opening");
var videoLoading = document.getElementById("video-loading");


/* ─────────────────────────────────────────────────────────────────
   playOpeningVideo()
   Shows "Opening Scene.mp4" and starts playback.
   A 6-second fallback timer guards against browsers that block
   autoplay (common on mobile / some desktop policies).

   Flow:
     play() resolves  → wait for "ended" event → playLoadingVideo()
     play() rejects   → immediately playLoadingVideo()
     6 s timeout      → playLoadingVideo()   (safety net)

   Reference: HTMLMediaElement.play() returns a Promise
   https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play
───────────────────────────────────────────────────────────────── */
function playOpeningVideo() {
  // Make opening visible, keep loading hidden
  videoOpening.style.display = "block";
  videoLoading.style.display = "none";

  // Fallback: if video stalls or autoplay is blocked, move on after 6 s
  var fb = setTimeout(playLoadingVideo, 6000);

  // "ended" fires when the video reaches its natural end
  videoOpening.addEventListener("ended", function() {
    clearTimeout(fb);      // Cancel the fallback timer
    playLoadingVideo();
  });

  // "error" fires if the file is missing or unplayable
  videoOpening.addEventListener("error", function() {
    clearTimeout(fb);
    playLoadingVideo();
  });

  // .play() may be rejected (e.g. autoplay policy) — handle gracefully
  videoOpening.play().catch(function() {
    clearTimeout(fb);
    playLoadingVideo();
  });
}


/* ─────────────────────────────────────────────────────────────────
   playLoadingVideo()
   Hides the opening video, shows and plays the loading screen video.
   After it ends (or after a 7-second fallback), navigates to
   the Home screen via goTo() from utils.js.
───────────────────────────────────────────────────────────────── */
function playLoadingVideo() {
  videoOpening.style.display = "none";
  videoLoading.style.display = "block";

  // 7-second fallback in case the video doesn't load
  var fb = setTimeout(function() { goTo("screen-home"); }, 7000);

  videoLoading.addEventListener("ended", function() {
    clearTimeout(fb);
    goTo("screen-home");
  });

  videoLoading.addEventListener("error", function() {
    clearTimeout(fb);
    goTo("screen-home");
  });

  videoLoading.play().catch(function() {
    clearTimeout(fb);
    goTo("screen-home");
  });
}


/* ── Kick off the sequence as soon as this script runs ────────── */
playOpeningVideo();

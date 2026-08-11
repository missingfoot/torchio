# Linux mpv Playback Engine — Design

## Problem

Torchio's video preview (`src/components/TrimModal.tsx`) uses a plain HTML `<video>` element pointed at the file via Tauri's `asset://` protocol (`convertFileSrc`). On Windows and macOS this is rendered by WebView2 (Chromium) and WKWebView (Safari) respectively, both of which have solid codec support. On Linux, Tauri embeds WebKitGTK, whose GStreamer-backed decoding is comparatively limited — some videos load but fail to play, often with no console errors, making it hard for users to self-diagnose.

## Goals

- Fix Linux video preview playback by swapping the rendering engine from WebKitGTK's built-in `<video>` decoding to `libmpv`, without changing the player's UX (same controls, same layout, same trim/scrub/frame-step behavior).
- Zero impact on Windows/macOS — they keep using the existing `<video>` element, since playback already works fine there.
- No impact on FFmpeg-based export or filmstrip thumbnail generation, which are untouched.

## Non-goals

- Cross-platform mpv adoption. Windows/macOS are explicitly out of scope for this change (would require bundling mpv as a binary, which is a separate, larger effort).
- Automated test coverage for playback (consistent with the rest of the player, which has none today).

## Architecture

### Embedding

- Linux only, behind `#[cfg(target_os = "linux")]` in the Rust backend.
- `libmpv` is linked directly into the Tauri Rust binary via the `libmpv2` (or `libmpv-rs`) crate, using its OpenGL render API — not a spawned mpv subprocess with IPC. A subprocess+window-embed approach would produce visible seams/lag on resize; the render API draws frames directly into a widget in the same native window, matching the current seamless `<video>` UX.
- Tauri's Linux window is a GTK window. A `GtkGLArea` is added as a native sibling widget inside that window. libmpv's render context draws each video frame into this `GtkGLArea`.
- The React side replaces the `<video>` element with an empty placeholder `<div>` in the same layout position. A `ResizeObserver` on that div reports its on-screen position/size to Rust via a Tauri command whenever it changes (window resize, layout changes, modal open, etc.), and Rust moves/resizes the `GtkGLArea` to match — keeping video visually pinned under the placeholder exactly as the `<video>` element was.
- All existing overlay UI (timeline, trim markers, filmstrip thumbnails, scrubber) continues to render as HTML on top of this area unchanged, since it was already an overlay on top of the `<video>` element, not inside it.

### Control flow (commands: JS → Rust → mpv)

`src/hooks/useVideoPlayback.ts` currently calls methods directly on a `videoRef` (`HTMLVideoElement`). On Linux this is rewired to call Tauri commands instead:

| Current (`videoRef.current.x`) | New (Linux) |
|---|---|
| `.play()` | `invoke('mpv_play')` |
| `.pause()` | `invoke('mpv_pause')` |
| `.currentTime = t` | `invoke('mpv_seek', { t })` |
| `.volume = v` | `invoke('mpv_set_volume', { v })` |
| frame step | `invoke('mpv_frame_step', { dir })` |

The public shape of `useVideoPlayback`'s return value/callbacks stays the same, so `TrimModal.tsx` and the rest of the UI don't need to change — only the hook's Linux-specific implementation swaps its target from a DOM ref to Tauri invokes.

### Event flow (mpv → Rust → JS)

Rust registers for mpv property-change events (`time-pos`, `duration`, `pause`, `seeking`, `eof-reached`) via `libmpv2`'s event API and re-emits them as Tauri events:

- `mpv://timeupdate` ↔ replaces `<video>`'s `timeupdate` event
- `mpv://duration` ↔ replaces `loadedmetadata`
- `mpv://ended` ↔ replaces `ended`
- `mpv://error` — new; mpv load/decode errors, surfaced through the app's existing error-toast pattern

`useVideoPlayback.ts` listens for these instead of native DOM video events on Linux.

### Fallback behavior

If `libmpv` isn't present on the user's system at startup (e.g. sideloaded outside a package manager), the app detects this and falls back to the existing `<video>` element, with a one-time toast noting playback may be limited. This is a safety net, not the expected path — see Packaging below.

### Packaging

Linux distribution package(s) (deb, AUR, or others as they're added) should declare `mpv`/`libmpv` as a runtime dependency in that packaging format's own metadata, so it installs automatically alongside Torchio (e.g. `paru -S torchio` pulls in `mpv` on Arch/AUR). This is a system shared library, not something bundled as a static binary the way FFmpeg is.

## Testing

Manual verification against a set of videos/codecs known to fail under WebKitGTK today, confirming playback, seeking, frame-stepping, and trim-marker interaction all behave identically to the current `<video>`-based experience.

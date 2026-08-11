# Linux mpv Playback Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace WebKitGTK's `<video>` element with a libmpv-rendered surface on Linux only, fixing broken/silent playback failures caused by WebKitGTK's limited GStreamer codec support, with no change to the player's UX or to Windows/macOS behavior.

**Architecture:** On Linux, `libmpv` is linked into the Rust backend (via the `libmpv2` crate) and renders video frames directly into a `gtk::GLArea` sibling widget inside Tauri's native GTK window, positioned to track an empty placeholder `<div>` in the React UI. Playback commands/events that currently go through the DOM `<video>` element are rewired through Tauri commands/events on Linux, while Windows/macOS keep the existing `<video>`-based path untouched.

**Tech Stack:** Rust (`libmpv2`, `gtk` via Tauri's existing `wry`/`tao` GTK dependency), React/TypeScript, Tauri v2 commands & events.

## Global Constraints

- Linux-only change: gated behind `#[cfg(target_os = "linux")]` in Rust; zero behavior change on Windows/macOS.
- No change to FFmpeg-based export or filmstrip thumbnail generation.
- No bundled mpv binary — `libmpv` is a linked system library; Linux packaging metadata (deb/AUR/etc, wherever maintained) must declare it as a runtime dependency.
- If `libmpv` is unavailable at runtime, fall back to the existing `<video>` element with a one-time toast; app must not crash.
- Public shape of `useVideoPlayback`'s return value stays the same — consumers (`TrimModal.tsx`, `PlaybackControls`, etc.) do not need to change.

---

## File Structure

- `src-tauri/Cargo.toml` — add `libmpv2` dependency, Linux-only.
- `src-tauri/src/mpv.rs` — new. Owns the `libmpv` session, GTK GL embedding, Tauri commands, and the mpv event → Tauri event bridge. Linux-only module.
- `src-tauri/src/lib.rs` — register `mpv` module and its commands (Linux-only), add `mpv_available` command (all platforms).
- `src/hooks/useMpvAvailable.ts` — new. One-shot check of whether the mpv backend is usable (calls `mpv_available`, caches result for the session).
- `src/hooks/usePlayerAdapter.ts` — new. Defines the `PlayerAdapter` interface and two implementations: `createHtmlVideoAdapter(videoRef)` (existing behavior) and `createMpvAdapter(containerId)` (new, Tauri invoke/event-based). This is what lets `useVideoPlayback` stay backend-agnostic.
- `src/hooks/useVideoPlayback.ts` — modified to drive a `PlayerAdapter` instead of `videoRef` directly.
- `src/components/MpvSurface.tsx` — new. Placeholder `<div>` + `ResizeObserver` that reports its screen bounds to Rust via `mpv_set_bounds`. Rendered instead of `<video>` when the mpv backend is active.
- `src/components/TrimModal.tsx` — modified to pick `<video>` vs `<MpvSurface>` based on `useMpvAvailable()`, and to pass a `PlayerAdapter` into `useVideoPlayback` instead of a raw `videoRef`.

---

## Task 1: `mpv_available` command and Cargo dependency

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/mpv.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `#[tauri::command] async fn mpv_available() -> bool` — registered on all platforms, returns `false` immediately on non-Linux, and on Linux attempts a throwaway `libmpv2::Mpv::new()` to confirm the shared library actually loads (handles the "declared as a dependency but somehow missing" edge case from the spec).

- [ ] **Step 1: Add the dependency**

In `src-tauri/Cargo.toml`, add under `[dependencies]`:

```toml
[target.'cfg(target_os = "linux")'.dependencies]
libmpv2 = "3"
```

- [ ] **Step 2: Create `src-tauri/src/mpv.rs` with the availability check**

```rust
#![cfg(target_os = "linux")]

use std::sync::Mutex;

pub struct MpvState(pub Mutex<Option<MpvSession>>);

pub struct MpvSession {
    // populated in Task 2
}

impl Default for MpvState {
    fn default() -> Self {
        MpvState(Mutex::new(None))
    }
}

#[tauri::command]
pub async fn mpv_available() -> bool {
    match libmpv2::Mpv::new() {
        Ok(_) => true,
        Err(_) => false,
    }
}
```

- [ ] **Step 3: Add a non-Linux stub so `lib.rs` doesn't need per-platform command registration**

Create `src-tauri/src/mpv_stub.rs`:

```rust
#![cfg(not(target_os = "linux"))]

#[tauri::command]
pub async fn mpv_available() -> bool {
    false
}
```

- [ ] **Step 4: Wire modules into `lib.rs`**

In `src-tauri/src/lib.rs`, add near the top with the other `mod` declarations:

```rust
#[cfg(target_os = "linux")]
mod mpv;
#[cfg(not(target_os = "linux"))]
mod mpv_stub;

#[cfg(target_os = "linux")]
use mpv::mpv_available;
#[cfg(not(target_os = "linux"))]
use mpv_stub::mpv_available;
```

Add `mpv_available` to the `tauri::generate_handler![...]` list in `run()`:

```rust
.invoke_handler(tauri::generate_handler![get_file_size, get_video_duration, get_video_info_cmd, get_media_metadata_cmd, extract_frame, extract_filmstrip, detect_scenes, convert_file, mpv_available])
```

- [ ] **Step 5: Build to verify it compiles on this machine (Linux)**

Run: `cd src-tauri && cargo build`
Expected: builds successfully, `mpv_available` command registered.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/mpv.rs src-tauri/src/mpv_stub.rs src-tauri/src/lib.rs
git commit -m "Add mpv_available command and libmpv2 dependency scaffolding"
```

---

## Task 2: Frontend mpv-availability hook

**Files:**
- Create: `src/hooks/useMpvAvailable.ts`
- Test: manual (see Step 3)

**Interfaces:**
- Consumes: `mpv_available` Tauri command from Task 1.
- Produces: `useMpvAvailable(): boolean | null` — `null` while the check is in flight, then `true`/`false`. Consumed by `TrimModal.tsx` in Task 6.

- [ ] **Step 1: Implement the hook**

```typescript
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

let cached: boolean | null = null;

export function useMpvAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(cached);

  useEffect(() => {
    if (cached !== null) return;
    invoke<boolean>("mpv_available")
      .then((result) => {
        cached = result;
        setAvailable(result);
      })
      .catch(() => {
        cached = false;
        setAvailable(false);
      });
  }, []);

  return available;
}
```

- [ ] **Step 2: Verify manually**

Run `npm run tauri dev`, add a temporary `console.log(useMpvAvailable())` in `TrimModal.tsx`, confirm it logs `true` on this Linux machine (with `libmpv` installed) or `false` if not installed (`sudo pacman -Rns mpv` temporarily to test the negative path, then reinstall). Remove the temporary log afterward.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useMpvAvailable.ts
git commit -m "Add useMpvAvailable hook for mpv backend detection"
```

---

## Task 3: mpv session lifecycle + playback commands (no video output yet)

**Files:**
- Modify: `src-tauri/src/mpv.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `MpvState` from Task 1.
- Produces: Tauri commands `mpv_create(path: String) -> Result<(), String>`, `mpv_destroy() -> Result<(), String>`, `mpv_play() -> Result<(), String>`, `mpv_pause() -> Result<(), String>`, `mpv_seek(time: f64) -> Result<(), String>`, `mpv_set_volume(volume: f64) -> Result<(), String>`, `mpv_frame_step(direction: String) -> Result<(), String>` (`direction` is `"forward"` or `"backward"`). All operate on the single session stored in managed `MpvState`.

- [ ] **Step 1: Flesh out `MpvSession` and the lifecycle/control commands**

Replace the placeholder `MpvSession` and add commands in `src-tauri/src/mpv.rs`:

```rust
#![cfg(target_os = "linux")]

use std::sync::Mutex;
use libmpv2::Mpv;
use tauri::State;

pub struct MpvState(pub Mutex<Option<MpvSession>>);

pub struct MpvSession {
    pub mpv: Mpv,
}

impl Default for MpvState {
    fn default() -> Self {
        MpvState(Mutex::new(None))
    }
}

#[tauri::command]
pub async fn mpv_available() -> bool {
    Mpv::new().is_ok()
}

#[tauri::command]
pub async fn mpv_create(state: State<'_, MpvState>, path: String) -> Result<(), String> {
    let mpv = Mpv::new().map_err(|e| e.to_string())?;
    mpv.set_property("vo", "libmpv").map_err(|e| e.to_string())?;
    mpv.set_property("pause", true).map_err(|e| e.to_string())?;
    mpv.command("loadfile", &[&path]).map_err(|e| e.to_string())?;

    let mut guard = state.0.lock().map_err(|_| "mpv state poisoned".to_string())?;
    *guard = Some(MpvSession { mpv });
    Ok(())
}

#[tauri::command]
pub async fn mpv_destroy(state: State<'_, MpvState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "mpv state poisoned".to_string())?;
    *guard = None;
    Ok(())
}

#[tauri::command]
pub async fn mpv_play(state: State<'_, MpvState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|_| "mpv state poisoned".to_string())?;
    let session = guard.as_ref().ok_or("no active mpv session")?;
    session.mpv.set_property("pause", false).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mpv_pause(state: State<'_, MpvState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|_| "mpv state poisoned".to_string())?;
    let session = guard.as_ref().ok_or("no active mpv session")?;
    session.mpv.set_property("pause", true).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mpv_seek(state: State<'_, MpvState>, time: f64) -> Result<(), String> {
    let guard = state.0.lock().map_err(|_| "mpv state poisoned".to_string())?;
    let session = guard.as_ref().ok_or("no active mpv session")?;
    session
        .mpv
        .command("seek", &[&time.to_string(), "absolute"])
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mpv_set_volume(state: State<'_, MpvState>, volume: f64) -> Result<(), String> {
    let guard = state.0.lock().map_err(|_| "mpv state poisoned".to_string())?;
    let session = guard.as_ref().ok_or("no active mpv session")?;
    session
        .mpv
        .set_property("volume", volume * 100.0)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mpv_frame_step(state: State<'_, MpvState>, direction: String) -> Result<(), String> {
    let guard = state.0.lock().map_err(|_| "mpv state poisoned".to_string())?;
    let session = guard.as_ref().ok_or("no active mpv session")?;
    let cmd = if direction == "forward" { "frame-step" } else { "frame-back-step" };
    session.mpv.command(cmd, &[]).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register `MpvState` and the new commands in `lib.rs`**

```rust
#[cfg(target_os = "linux")]
use mpv::{mpv_available, mpv_create, mpv_destroy, mpv_play, mpv_pause, mpv_seek, mpv_set_volume, mpv_frame_step, MpvState};
```

In `run()`, before `.invoke_handler(...)`:

```rust
.manage({
    #[cfg(target_os = "linux")]
    { mpv::MpvState::default() }
})
```

Add the new commands to `generate_handler!`:

```rust
.invoke_handler(tauri::generate_handler![get_file_size, get_video_duration, get_video_info_cmd, get_media_metadata_cmd, extract_frame, extract_filmstrip, detect_scenes, convert_file, mpv_available, mpv_create, mpv_destroy, mpv_play, mpv_pause, mpv_seek, mpv_set_volume, mpv_frame_step])
```

Note: since `mpv_available` differs by platform (real module vs stub), keep the `#[cfg(...)]` import split from Task 1 Step 4 — only the Linux branch gains the extra imports above.

- [ ] **Step 3: Build to verify it compiles**

Run: `cd src-tauri && cargo build`
Expected: builds successfully.

- [ ] **Step 4: Manual smoke test via Tauri's dev console**

Run `npm run tauri dev`, open the webview inspector, and in its JS console run:

```js
await window.__TAURI__.core.invoke('mpv_create', { path: '/absolute/path/to/test.mp4' });
await window.__TAURI__.core.invoke('mpv_play');
```//
Expected: no errors thrown (no visible video yet — that's Task 4).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/mpv.rs src-tauri/src/lib.rs
git commit -m "Add mpv session lifecycle and playback control commands"
```

---

## Task 4: GL video output — embed mpv rendering into the GTK window

**Files:**
- Modify: `src-tauri/src/mpv.rs`
- Modify: `src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: `MpvSession` from Task 3, Tauri's `AppHandle`/main `WebviewWindow` to obtain the underlying `gtk::ApplicationWindow`.
- Produces: `mpv_create` now also creates and attaches a `gtk::GLArea` sized/positioned via `mpv_set_bounds`; Tauri command `mpv_set_bounds(x: i32, y: i32, width: i32, height: i32) -> Result<(), String>`.

- [ ] **Step 1: Add GTK bindings matching the version Tauri already uses**

Check the pinned `gtk`/`gdk` crate versions Tauri's `tao`/`wry` pull in:

Run: `cd src-tauri && cargo tree -i gtk`

Add the same major version explicitly to `[target.'cfg(target_os = "linux")'.dependencies]` in `Cargo.toml` (e.g. `gtk = "0.18"` — match whatever `cargo tree` reports) so the `gtk::Widget` handle obtained from Tauri and the one used to build the `GLArea` are the same binding version.

- [ ] **Step 2: Extend `MpvSession` with the GL area and render context**

```rust
use gtk::prelude::*;
use gtk::{GLArea, Fixed};
use libmpv2::{Mpv, GenericMpv};
use libmpv2::render::{RenderContext, RenderParam, RenderParamApiType, OpenGLInitParams};

pub struct MpvSession {
    pub mpv: Mpv,
    pub render_ctx: RenderContext,
    pub gl_area: GLArea,
}
```

- [ ] **Step 3: Build the GL area, attach it to the window's GTK container, and initialize the render context in `mpv_create`**

```rust
#[tauri::command]
pub async fn mpv_create(
    app: tauri::AppHandle,
    state: State<'_, MpvState>,
    path: String,
) -> Result<(), String> {
    let mpv = Mpv::new().map_err(|e| e.to_string())?;
    mpv.set_property("vid", "auto").map_err(|e| e.to_string())?;
    mpv.set_property("pause", true).map_err(|e| e.to_string())?;

    let window = app.get_webview_window("main").ok_or("no main window")?;
    let gtk_window: gtk::ApplicationWindow = window
        .gtk_window()
        .map_err(|e| e.to_string())?
        .downcast()
        .map_err(|_| "main window is not a gtk::ApplicationWindow".to_string())?;

    let fixed = gtk_window
        .child()
        .and_then(|w| w.downcast::<Fixed>().ok())
        .ok_or("expected a gtk::Fixed root container for absolute positioning")?;

    let gl_area = GLArea::new();
    gl_area.set_has_depth_buffer(false);
    fixed.put(&gl_area, 0, 0);
    gl_area.show();

    let render_ctx = RenderContext::new(
        unsafe { mpv.ctx.as_mut() },
        vec![
            RenderParam::ApiType(RenderParamApiType::OpenGl),
            RenderParam::InitParams(OpenGLInitParams {
                get_proc_address: |_, name| unsafe {
                    epoxy::get_proc_addr(name) as *mut std::ffi::c_void
                },
                ctx: (),
            }),
        ],
    )
    .map_err(|e| format!("failed to create mpv render context: {e}"))?;

    {
        let render_ctx_ptr = &render_ctx as *const RenderContext;
        gl_area.connect_render(move |area, _gl_ctx| {
            let width = area.allocated_width();
            let height = area.allocated_height();
            unsafe {
                (*render_ctx_ptr)
                    .render::<()>(0, width, height, true)
                    .ok();
            }
            gtk::glib::Propagation::Stop
        });
    }

    mpv.command("loadfile", &[&path]).map_err(|e| e.to_string())?;

    let mut guard = state.0.lock().map_err(|_| "mpv state poisoned".to_string())?;
    *guard = Some(MpvSession { mpv, render_ctx, gl_area });
    Ok(())
}
```

(This uses `epoxy` for GL proc-address resolution, matching how `webkit2gtk`/GTK apps typically source GL entry points; add `epoxy = "0.1"` to the Linux-only Cargo dependencies alongside `gtk`.)

- [ ] **Step 4: Add `mpv_set_bounds` and call it from `mpv_destroy` to tear the widget down**

```rust
#[tauri::command]
pub async fn mpv_set_bounds(
    state: State<'_, MpvState>,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    let guard = state.0.lock().map_err(|_| "mpv state poisoned".to_string())?;
    let session = guard.as_ref().ok_or("no active mpv session")?;
    session.gl_area.set_size_request(width, height);
    // parent is a gtk::Fixed put() earlier; move() repositions an existing child
    if let Some(fixed) = session.gl_area.parent().and_then(|p| p.downcast::<Fixed>().ok()) {
        fixed.move_(&session.gl_area, x, y);
    }
    Ok(())
}
```

Update `mpv_destroy` to remove the widget:

```rust
#[tauri::command]
pub async fn mpv_destroy(state: State<'_, MpvState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "mpv state poisoned".to_string())?;
    if let Some(session) = guard.take() {
        session.gl_area.unparent();
    }
    Ok(())
}
```

Register `mpv_set_bounds` in `lib.rs`'s imports and `generate_handler!` list, same pattern as Task 3 Step 2.

- [ ] **Step 5: Build and manually verify video renders**

Run: `cd src-tauri && cargo build`
Expected: builds successfully (this is the highest-risk step in the plan — GTK widget-tree assumptions and exact `libmpv2` render-API method names may need adjusting against the actual installed crate version; consult `cargo doc --open -p libmpv2` and `cargo doc --open -p gtk` if signatures don't match).

Then `npm run tauri dev`, invoke `mpv_create` + `mpv_set_bounds` + `mpv_play` from the dev console as in Task 3 Step 4, plus:

```js
await window.__TAURI__.core.invoke('mpv_set_bounds', { x: 50, y: 50, width: 640, height: 360 });
```

Expected: a 640x360 video render appears at (50,50) in the window and plays.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/mpv.rs src-tauri/Cargo.toml
git commit -m "Embed mpv OpenGL render output into a GTK GLArea"
```

---

## Task 5: mpv event bridge (time/duration/ended/error → Tauri events)

**Files:**
- Modify: `src-tauri/src/mpv.rs`

**Interfaces:**
- Produces: Tauri events emitted on the main window: `mpv://timeupdate` (payload: `{ time: f64 }`), `mpv://duration` (payload: `{ duration: f64 }`), `mpv://ended` (no payload), `mpv://error` (payload: `{ message: String }`).

- [ ] **Step 1: Observe properties and spawn an event-forwarding thread in `mpv_create`**

Add after `mpv.command("loadfile", ...)` in `mpv_create`, before storing the session:

```rust
mpv.observe_property("time-pos", libmpv2::Format::Double, 0).map_err(|e| e.to_string())?;
mpv.observe_property("duration", libmpv2::Format::Double, 1).map_err(|e| e.to_string())?;
mpv.observe_property("eof-reached", libmpv2::Format::Flag, 2).map_err(|e| e.to_string())?;

let app_handle = app.clone();
let mut ev_ctx = mpv.create_event_context();
std::thread::spawn(move || {
    loop {
        if let Some(Ok(event)) = ev_ctx.wait_event(1.0) {
            use libmpv2::events::Event;
            match event {
                Event::PropertyChange { name: "time-pos", change, .. } => {
                    if let libmpv2::events::PropertyData::Double(t) = change {
                        let _ = app_handle.emit("mpv://timeupdate", serde_json::json!({ "time": t }));
                    }
                }
                Event::PropertyChange { name: "duration", change, .. } => {
                    if let libmpv2::events::PropertyData::Double(d) = change {
                        let _ = app_handle.emit("mpv://duration", serde_json::json!({ "duration": d }));
                    }
                }
                Event::PropertyChange { name: "eof-reached", change, .. } => {
                    if let libmpv2::events::PropertyData::Flag(true) = change {
                        let _ = app_handle.emit("mpv://ended", ());
                    }
                }
                Event::EndFile(Err(e)) => {
                    let _ = app_handle.emit("mpv://error", serde_json::json!({ "message": e.to_string() }));
                }
                Event::Shutdown => break,
                _ => {}
            }
        }
    }
});
```

(Exact `Event`/`PropertyData` variant names must be checked against the installed `libmpv2` version's docs — adjust to match during Step 2's build.)

Note: this thread currently has no clean shutdown signal tied to `mpv_destroy`; since `Mpv` drop triggers a `Shutdown` event that breaks the loop, this is acceptable, but confirm no panic-on-shutdown during Step 3's manual test.

- [ ] **Step 2: Build**

Run: `cd src-tauri && cargo build`
Expected: builds successfully; fix any event/property-data variant name mismatches against the actual `libmpv2` API surface.

- [ ] **Step 3: Manual verification**

`npm run tauri dev`, open the JS console, listen for events before invoking `mpv_create`/`mpv_play`:

```js
const { listen } = window.__TAURI__.event;
await listen('mpv://timeupdate', (e) => console.log('time', e.payload));
await listen('mpv://duration', (e) => console.log('duration', e.payload));
```

Expected: `duration` fires once after `mpv_create`, `time` fires repeatedly during playback.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/mpv.rs
git commit -m "Bridge mpv property-change events to Tauri events"
```

---

## Task 6: `PlayerAdapter` abstraction + `useVideoPlayback` rewire

**Files:**
- Create: `src/hooks/usePlayerAdapter.ts`
- Modify: `src/hooks/useVideoPlayback.ts`

**Interfaces:**
- Produces (`usePlayerAdapter.ts`):
  ```typescript
  export interface PlayerAdapter {
    play(): void;
    pause(): void;
    seek(time: number): void;
    setVolume(volume: number): void;
    stepFrame(direction: 'forward' | 'backward'): void;
    getCurrentTime(): number;
    isPaused(): boolean;
    onTimeUpdate(cb: (time: number) => void): () => void;
    onEnded(cb: () => void): () => void;
  }
  export function createHtmlVideoAdapter(videoRef: RefObject<HTMLVideoElement | null>): PlayerAdapter;
  export function createMpvAdapter(): PlayerAdapter;
  ```
- Consumes (in `useVideoPlayback.ts`): a `PlayerAdapter` instead of `videoRef` directly. `TrimModal.tsx` (Task 7) constructs the adapter and passes it in.

- [ ] **Step 1: Implement `createHtmlVideoAdapter`** (wraps existing `<video>` behavior 1:1, so Windows/macOS is provably unchanged)

```typescript
import { RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface PlayerAdapter {
  play(): void;
  pause(): void;
  seek(time: number): void;
  setVolume(volume: number): void;
  stepFrame(direction: 'forward' | 'backward'): void;
  getCurrentTime(): number;
  isPaused(): boolean;
  onTimeUpdate(cb: (time: number) => void): () => void;
  onEnded(cb: () => void): () => void;
}

export function createHtmlVideoAdapter(videoRef: RefObject<HTMLVideoElement | null>): PlayerAdapter {
  return {
    play() { videoRef.current?.play().catch(() => {}); },
    pause() { videoRef.current?.pause(); },
    seek(time) { if (videoRef.current) videoRef.current.currentTime = time; },
    setVolume(volume) { if (videoRef.current) videoRef.current.volume = volume; },
    stepFrame(direction) {
      const video = videoRef.current;
      if (!video) return;
      const frameTime = 1 / 30;
      video.currentTime = direction === 'forward'
        ? video.currentTime + frameTime
        : Math.max(video.currentTime - frameTime, 0);
    },
    getCurrentTime() { return videoRef.current?.currentTime ?? 0; },
    isPaused() { return videoRef.current?.paused ?? true; },
    onTimeUpdate(cb) {
      const video = videoRef.current;
      if (!video) return () => {};
      const handler = () => cb(video.currentTime);
      video.addEventListener('timeupdate', handler);
      return () => video.removeEventListener('timeupdate', handler);
    },
    onEnded(cb) {
      const video = videoRef.current;
      if (!video) return () => {};
      video.addEventListener('ended', cb);
      return () => video.removeEventListener('ended', cb);
    },
  };
}
```

- [ ] **Step 2: Implement `createMpvAdapter`**

```typescript
export function createMpvAdapter(): PlayerAdapter {
  let lastTime = 0;
  let paused = true;

  return {
    play() { paused = false; invoke('mpv_play').catch(() => {}); },
    pause() { paused = true; invoke('mpv_pause').catch(() => {}); },
    seek(time) { lastTime = time; invoke('mpv_seek', { time }).catch(() => {}); },
    setVolume(volume) { invoke('mpv_set_volume', { volume }).catch(() => {}); },
    stepFrame(direction) { invoke('mpv_frame_step', { direction }).catch(() => {}); },
    getCurrentTime() { return lastTime; },
    isPaused() { return paused; },
    onTimeUpdate(cb) {
      let unlisten = () => {};
      listen<{ time: number }>('mpv://timeupdate', (e) => {
        lastTime = e.payload.time;
        cb(e.payload.time);
      }).then((fn) => { unlisten = fn; });
      return () => unlisten();
    },
    onEnded(cb) {
      let unlisten = () => {};
      listen('mpv://ended', () => cb()).then((fn) => { unlisten = fn; });
      return () => unlisten();
    },
  };
}
```

- [ ] **Step 3: Rewire `useVideoPlayback.ts` to take a `PlayerAdapter`**

Replace the `videoRef: RefObject<HTMLVideoElement | null>` option and all `videoRef.current.x` calls with an `adapter: PlayerAdapter` option and corresponding `adapter.x()` calls. The `requestAnimationFrame` polling loop (lines 66-97 of the current file) is replaced by subscribing to `adapter.onTimeUpdate` for `currentTime` updates, while loop-zone/trim-boundary correction logic (which needs to force-seek) stays but calls `adapter.seek(...)` instead of `video.currentTime = ...`. Concretely:

```typescript
import { useState, useRef, useCallback, useEffect, MutableRefObject } from "react";
import type { Trim } from "@/types";
import type { PlayerAdapter } from "./usePlayerAdapter";

interface UseVideoPlaybackOptions {
  adapter: PlayerAdapter;
  duration: number;
  loopZone: { start: number; end: number } | null;
  trims: Trim[];
  onFrameCapture?: (time: number) => void;
  getCacheKey?: (time: number) => number;
  frameCacheRef?: MutableRefObject<Map<number, string>>;
}

// ... UseVideoPlaybackReturn interface unchanged ...

export function useVideoPlayback({
  adapter,
  duration,
  loopZone,
  trims,
  onFrameCapture,
  getCacheKey,
  frameCacheRef,
}: UseVideoPlaybackOptions): UseVideoPlaybackReturn {
  const prevTimeRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.7);

  useEffect(() => { adapter.setVolume(volume); }, [volume, adapter]);

  useEffect(() => {
    return adapter.onTimeUpdate((time) => {
      const prevTime = prevTimeRef.current;
      prevTimeRef.current = time;
      setCurrentTime(time);

      if (onFrameCapture && getCacheKey && frameCacheRef?.current) {
        const cacheKey = getCacheKey(time);
        if (!frameCacheRef.current.has(cacheKey)) {
          onFrameCapture(time);
        }
      }

      if (loopZone) {
        if (time >= loopZone.end) {
          adapter.seek(loopZone.start);
          prevTimeRef.current = loopZone.start;
        }
        return;
      }

      if (trims.length > 0) {
        for (const trim of trims) {
          const wasInTrim = prevTime >= trim.startTime && prevTime < trim.endTime;
          const nowAtOrPastEnd = time >= trim.endTime;
          if (wasInTrim && nowAtOrPastEnd) {
            adapter.seek(trim.startTime);
            prevTimeRef.current = trim.startTime;
            break;
          }
        }
      }
    });
  }, [adapter, loopZone, trims, onFrameCapture, getCacheKey, frameCacheRef]);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      adapter.pause();
      setIsPlaying(false);
    } else {
      adapter.seek(currentTime);
      prevTimeRef.current = currentTime;
      adapter.play();
      setIsPlaying(true);
    }
  }, [isPlaying, currentTime, adapter]);

  const goToStart = useCallback(() => {
    adapter.seek(0);
    setCurrentTime(0);
    prevTimeRef.current = 0;
  }, [adapter]);

  const stepFrame = useCallback((direction: 'forward' | 'backward') => {
    if (isPlaying) return;
    adapter.stepFrame(direction);
    const frameTime = 1 / 30;
    const newTime = direction === 'forward'
      ? Math.min(currentTime + frameTime, duration)
      : Math.max(currentTime - frameTime, 0);
    setCurrentTime(newTime);
    prevTimeRef.current = newTime;
  }, [isPlaying, duration, adapter, currentTime]);

  const seekTo = useCallback((time: number) => {
    adapter.seek(time);
    setCurrentTime(time);
    prevTimeRef.current = time;
  }, [adapter]);

  return {
    isPlaying, currentTime, setCurrentTime, togglePlay, goToStart,
    stepFrame, seekTo, isMuted, setIsMuted, volume, setVolume, prevTimeRef,
  };
}
```

Note the shift from a 60fps `requestAnimationFrame` poll to event-driven updates via `onTimeUpdate`: the HTML adapter's `timeupdate` DOM event only fires a few times per second by spec, which is a UX regression for the playhead's smoothness on non-Linux platforms. To avoid that regression, `createHtmlVideoAdapter`'s `onTimeUpdate` (Step 1) should internally drive its callback from a `requestAnimationFrame` loop reading `video.currentTime`, rather than the native `timeupdate` event — update Step 1's `onTimeUpdate` implementation accordingly:

```typescript
onTimeUpdate(cb) {
  const video = videoRef.current;
  if (!video) return () => {};
  let raf: number | null = null;
  const tick = () => {
    if (!video.paused) cb(video.currentTime);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => { if (raf !== null) cancelAnimationFrame(raf); };
},
```

- [ ] **Step 4: Build the frontend**

Run: `npm run build`
Expected: TypeScript compiles with no errors from the interface change (this will surface any remaining `videoRef`-shaped usage that needs updating in Task 7).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePlayerAdapter.ts src/hooks/useVideoPlayback.ts
git commit -m "Introduce PlayerAdapter abstraction, rewire useVideoPlayback"
```

---

## Task 7: `MpvSurface` component and `TrimModal` wiring

**Files:**
- Create: `src/components/MpvSurface.tsx`
- Modify: `src/components/TrimModal.tsx`

**Interfaces:**
- Consumes: `useMpvAvailable` (Task 2), `createHtmlVideoAdapter`/`createMpvAdapter` (Task 6), `mpv_create`/`mpv_destroy`/`mpv_set_bounds` commands (Tasks 3-4).
- Produces: `<MpvSurface filePath={string} onBoundsReady={() => void} />` — renders the placeholder div, creates the mpv session on mount, tears it down on unmount, and keeps bounds synced.

- [ ] **Step 1: Implement `MpvSurface`**

```typescript
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

interface MpvSurfaceProps {
  filePath: string;
}

export function MpvSurface({ filePath }: MpvSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke('mpv_create', { path: filePath }).catch((e) => {
      console.error('mpv_create failed', e);
    });
    return () => {
      invoke('mpv_destroy').catch(() => {});
    };
  }, [filePath]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const syncBounds = () => {
      const rect = el.getBoundingClientRect();
      invoke('mpv_set_bounds', {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }).catch(() => {});
    };

    const observer = new ResizeObserver(syncBounds);
    observer.observe(el);
    syncBounds();

    return () => observer.disconnect();
  }, []);

  return <div ref={containerRef} className="w-full h-full" />;
}
```

- [ ] **Step 2: Wire into `TrimModal.tsx`**

In `src/components/TrimModal.tsx`, add the import and hook:

```typescript
import { useMpvAvailable } from "@/hooks/useMpvAvailable";
import { createHtmlVideoAdapter, createMpvAdapter } from "@/hooks/usePlayerAdapter";
import { MpvSurface } from "./MpvSurface";
```

Near the top of the component body (after `videoRef` declaration at line 43):

```typescript
const mpvAvailable = useMpvAvailable();
const adapter = useMemo(
  () => (mpvAvailable ? createMpvAdapter() : createHtmlVideoAdapter(videoRef)),
  [mpvAvailable]
);
```

(add `useMemo` to the existing React import at line 1)

Update the `useVideoPlayback` call (currently at line 86) to pass `adapter` instead of `videoRef`:

```typescript
const playback = useVideoPlayback({
  adapter,
  duration,
  loopZone,
  trims: persistence.trims,
  onFrameCapture: frameCache.captureFrame,
  getCacheKey: frameCache.getCacheKey,
  frameCacheRef,
});
```

Replace the `<video>` block (lines 379-397) with a conditional:

```tsx
{mpvAvailable ? (
  <MpvSurface filePath={filePath} />
) : (
  <video
    ref={videoRef}
    src={videoSrc}
    crossOrigin="anonymous"
    className="w-full h-full object-contain block"
    playsInline
    muted={playback.isMuted}
    preload="metadata"
    onLoadedMetadata={handleLoadedMetadata}
    onTimeUpdate={handleTimeUpdate}
    onSeeked={handleSeeked}
    onEnded={() => {
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
        playback.prevTimeRef.current = 0;
        videoRef.current.play().catch(() => {});
      }
    }}
  />
)}
```

`duration`/`videoWidth`/`videoHeight` currently come from the `<video>` element's `onLoadedMetadata` (`handleLoadedMetadata`); when using mpv, source them instead from the existing `get_video_info_cmd` Tauri command (already used elsewhere in the app for file info) called once when `MpvSurface` mounts — add an effect alongside the `mpvAvailable` branch that calls `invoke('get_video_info_cmd', { path: filePath })` and feeds `setDuration`/`setVideoWidth`/`setVideoHeight` the same way `handleLoadedMetadata` does, so both code paths converge on the same state.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: compiles with no type errors.

- [ ] **Step 4: Manual end-to-end verification**

Run `npm run tauri dev`, open a video that previously failed to play under plain WebKitGTK `<video>` (from the earlier bug report), confirm:
- Video renders in the correct position/size in the preview pane.
- Play/pause, seek (scrubber drag), frame-step (arrow keys), and trim-loop playback all behave the same as before.
- Resizing the app window keeps the video aligned with the preview pane (tests the `ResizeObserver` → `mpv_set_bounds` sync).
- Closing the trim modal and reopening with a different file correctly tears down and recreates the mpv session (no stale video, no crash).

- [ ] **Step 5: Commit**

```bash
git add src/components/MpvSurface.tsx src/components/TrimModal.tsx
git commit -m "Wire MpvSurface into TrimModal, switching Linux playback to mpv"
```

---

## Task 8: Fallback banner when mpv is unavailable

**Files:**
- Create: `src/components/MpvFallbackBanner.tsx`
- Modify: `src/components/TrimModal.tsx`

**Interfaces:**
- Produces: `<MpvFallbackBanner />` — a small dismissible inline banner, no dependency on any app-wide notification system (the codebase has none; errors elsewhere are shown as inline per-item status, e.g. in `ExportContext.tsx`, so a local inline banner matches existing conventions rather than inventing global toasts).

- [ ] **Step 1: Implement the banner**

```typescript
import { useState } from "react";
import { X } from "lucide-react";

export function MpvFallbackBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs bg-yellow-500/10 text-yellow-600 border-b border-yellow-500/20">
      <span>mpv not found — using fallback player, playback may be limited.</span>
      <button onClick={() => setDismissed(true)} className="p-0.5 hover:opacity-70">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Render it in `TrimModal.tsx` when mpv is unavailable on Linux**

Add the import:

```typescript
import { MpvFallbackBanner } from "./MpvFallbackBanner";
```

Determine Linux at runtime using the OS check already available from Tauri (the app already depends on `@tauri-apps/api`; use its `platform()` export rather than sniffing `navigator.platform`, which WebKitGTK may report inconsistently):

```typescript
import { platform } from "@tauri-apps/plugin-os";
```

If `@tauri-apps/plugin-os` isn't already a dependency, add it: `npm install @tauri-apps/plugin-os` and register `tauri_plugin_os::init()` in `src-tauri/src/lib.rs`'s `Builder` chain alongside the existing `tauri_plugin_fs`/`tauri_plugin_store` plugins, plus add the corresponding Rust crate to `Cargo.toml` (`tauri-plugin-os = "2"`) and the permission `"os:default"` to `src-tauri/capabilities/default.json`.

In the component body:

```typescript
const [isLinux, setIsLinux] = useState(false);
useEffect(() => { platform().then((p) => setIsLinux(p === 'linux')); }, []);
```

Render the banner just above the video/sidebar row (before line 372's `{/* Video Preview + Sidebar */}` comment):

```tsx
{isLinux && mpvAvailable === false && <MpvFallbackBanner />}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: compiles with no type errors.

- [ ] **Step 4: Manual verification**

Temporarily uninstall `mpv`/`libmpv` (`sudo pacman -Rns mpv`), run `npm run tauri dev`, open a video, confirm the banner appears once and is dismissible, and the `<video>` fallback still plays supported files. Reinstall mpv afterward (`sudo pacman -S mpv`).

- [ ] **Step 5: Commit**

```bash
git add src/components/MpvFallbackBanner.tsx src/components/TrimModal.tsx src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/capabilities/default.json package.json
git commit -m "Show fallback banner when mpv backend is unavailable"
```

# Torchio

**Cut, clip, and convert videos without the hassle.**

**No account. No uploads. No cloud. Just your videos, on your machine.**

---

## What It Does

Torchio makes it dead simple to chop up videos and export them however you need. Select multiple sections from a single video, export them all at once as MP4, GIF, WebP, MKV — whatever format fits. No complicated timeline editors, no confusing export settings. Just drag, cut, export.

Everything runs locally on your computer. Your videos never leave your machine — no uploading to servers, no waiting for cloud processing, no accounts or subscriptions. Open the app and start working.

---

## Features

### Cut Once, Export Many

The app is built around one idea: **make cutting videos fast**.

Drag through the timeline to select what you want to keep. Need multiple clips? Just keep adding them. Each cut gets its own color in the timeline and shows up in the sidebar. When you're done, hit export and all your clips render out as separate files.

- **Visual timeline** — See exactly where you're cutting with a filmstrip preview
- **Frame-perfect precision** — Step frame-by-frame with arrow keys when you need exact cuts
- **Multi-clip workflow** — Create as many cuts as you want from one video
- **Batch export** — All clips export at once, no babysitting required

Perfect for pulling highlights from streams, chopping up long recordings, or grabbing multiple moments from a single video file.

### Instant GIF & WebP Export

Turn any video clip into an animated GIF or WebP in seconds.

1. Select the moment you want
2. Pick GIF or WebP
3. Set your target file size
4. Export

The app automatically handles resizing and optimization to hit your target size. Need it under 8MB for Discord? 10MB for a forum? Just set the number and export.

**WebP** gives you smaller files with better quality. **GIF** works everywhere. Pick what fits your needs.

### Chapter Markers for MKV

Add named chapter markers anywhere in your video. Give each one a label — "Intro", "Round 1", "Final Boss", whatever makes sense. When you export to MKV, these become real chapter markers that viewers can use to skip between sections.

- Click to drop a marker at any point
- Name each chapter in the sidebar
- Markers show as red dots on the timeline
- Exported MKV files have built-in chapter navigation

Great for tutorials, long gameplay sessions, or any video where you want easy navigation without splitting into separate files.

### Export to Anything

One video in, any format out:

| Format | What It's For |
|--------|---------------|
| **MP4 (H.264)** | Plays on everything — phones, browsers, TVs |
| **MP4 (H.265)** | Same quality, smaller file — for newer devices |
| **MOV** | Apple ecosystem and pro editing software |
| **MKV** | Open format with chapter support — great for archiving |
| **WebP** | Modern animated images — small and sharp |
| **GIF** | Classic animated format — works literally everywhere |

Set a target file size and the app figures out the rest. It remembers your preferences per format, so you're not re-entering settings every time.

### 100% Offline & Private

No cloud. No servers. No account. No subscription.

Torchio runs entirely on your computer. When you drop in a video, it stays on your machine. When you export, it saves to your drive. Nothing gets uploaded anywhere.

- **No account required** — Download, open, start using
- **No internet needed** — Works completely offline
- **No cloud processing** — Your hardware does the work
- **No data collection** — We don't see your videos, ever

Your files are yours. Period.

### Fast By Default

- **GPU acceleration** — Automatically uses your NVIDIA graphics card when available
- **Smart caching** — Frames load ahead as you scrub so there's no waiting
- **Lightweight** — Small download, minimal resource usage

---

## Coming Soon

- **Subtitle Support** — Import, edit, and burn in subtitles. Extract subtitles from videos or add your own.

---

## Quick Examples

**Clip a moment for Discord**
→ Select 5 seconds, export as GIF, set target to 8MB, done.

**Pull 10 highlights from a 2-hour stream**
→ Make 10 cuts in the timeline, name them, export all at once.

**Archive a tutorial with chapters**
→ Add markers at each section, export as MKV, chapters are baked in.

**Convert a video for your phone**
→ Drop it in, pick MP4 (H.265), set a reasonable size, export.

---

## System Requirements

- Windows 10/11 (macOS and Linux planned)
- FFmpeg included — nothing else to install
- NVIDIA GPU optional (enables faster exports)

---

## Development

Built with [Tauri](https://tauri.app/), React, TypeScript, and Rust.

```bash
# Install dependencies
npm install

# Run in development
npm run tauri dev

# Build for production
npm run tauri build
```

---

## License

MIT

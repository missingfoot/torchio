#![allow(unused_imports)]

use regex::Regex;
use std::path::PathBuf;
use std::process::Stdio;
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[cfg(target_os = "windows")]
const FFMPEG_NAME: &str = "ffmpeg.exe";
#[cfg(target_os = "windows")]
const FFPROBE_NAME: &str = "ffprobe.exe";

#[cfg(not(target_os = "windows"))]
const FFMPEG_NAME: &str = "ffmpeg";
#[cfg(not(target_os = "windows"))]
const FFPROBE_NAME: &str = "ffprobe";

fn find_binary(app: &tauri::AppHandle, name: &str) -> PathBuf {
    // 1. Check development path (src-tauri/ffmpeg/)
    if let Ok(exe_path) = std::env::current_exe() {
        // During dev: target/debug/mini-converter.exe
        // We want: src-tauri/ffmpeg/
        if let Some(target_dir) = exe_path.parent() {
            // Go up from target/debug to project root, then into src-tauri/ffmpeg
            let dev_path = target_dir
                .join("..") // target
                .join("..") // src-tauri
                .join("ffmpeg")
                .join(name);
            if dev_path.exists() {
                return dev_path.canonicalize().unwrap_or(dev_path);
            }
        }
    }

    // 2. Check bundled resources (for built app)
    if let Ok(resource_path) = app.path().resource_dir() {
        let bundled = resource_path.join("ffmpeg").join(name);
        if bundled.exists() {
            return bundled;
        }
    }

    // 3. Fall back to system PATH
    PathBuf::from(name)
}

pub fn get_ffmpeg_path(app: &tauri::AppHandle) -> PathBuf {
    find_binary(app, FFMPEG_NAME)
}

pub fn get_ffprobe_path(app: &tauri::AppHandle) -> PathBuf {
    find_binary(app, FFPROBE_NAME)
}

#[derive(Debug, Clone)]
pub struct VideoInfo {
    pub duration: f64,
    pub width: u32,
    pub height: u32,
}

pub async fn get_video_info(ffprobe_path: &PathBuf, input: &str) -> Result<VideoInfo, String> {
    // Debug: show which ffprobe we're using
    let ffprobe_exists = ffprobe_path.exists();

    let output = Command::new(ffprobe_path)
        .args([
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height,r_frame_rate,duration",
            "-show_entries", "format=duration",
            "-of", "csv=p=0",
            input,
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run ffprobe (path: {:?}, exists: {}): {}", ffprobe_path, ffprobe_exists, e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        return Err(format!("ffprobe failed (path: {:?}, exists: {}, exit: {:?})\nstderr: {}\nstdout: {}",
            ffprobe_path, ffprobe_exists, output.status.code(), stderr, stdout));
    }

    let lines: Vec<&str> = stdout.trim().lines().collect();
    if lines.is_empty() {
        return Err("No video stream found".to_string());
    }

    let mut width = 0u32;
    let mut height = 0u32;
    let mut duration = 0.0f64;

    for line in lines {
        let parts: Vec<&str> = line.split(',').collect();

        // Try to parse stream info (width,height,fps,duration)
        if parts.len() >= 3 {
            if let Ok(w) = parts[0].parse::<u32>() {
                width = w;
            }
            if let Ok(h) = parts[1].parse::<u32>() {
                height = h;
            }
            // Try stream duration (4th field)
            if parts.len() >= 4 {
                if let Ok(d) = parts[3].parse::<f64>() {
                    duration = d;
                }
            }
        }

        // Try format duration (single value line)
        if parts.len() == 1 {
            if let Ok(d) = parts[0].parse::<f64>() {
                if duration == 0.0 {
                    duration = d;
                }
            }
        }
    }

    if duration == 0.0 {
        return Err("Could not determine video duration".to_string());
    }

    Ok(VideoInfo {
        duration,
        width,
        height,
    })
}

pub async fn run_ffmpeg_with_progress<F: FnMut(f64) + Send>(
    ffmpeg_path: &PathBuf,
    args: Vec<&str>,
    duration: f64,
    mut on_progress: F,
) -> Result<(), String> {
    // Add progress flag to get structured output
    let mut full_args = vec!["-progress", "pipe:1", "-nostats"];
    full_args.extend(args);

    let mut cmd = Command::new(ffmpeg_path);
    cmd.args(&full_args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn ffmpeg: {}", e))?;

    // Read progress from stdout (where -progress pipe:1 sends it)
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let mut reader = BufReader::new(stdout).lines();

    // FFmpeg progress output format: out_time_us=microseconds
    let time_regex = Regex::new(r"out_time_us=(\d+)").unwrap();

    while let Ok(Some(line)) = reader.next_line().await {
        if let Some(caps) = time_regex.captures(&line) {
            if let Ok(microseconds) = caps[1].parse::<f64>() {
                let current_time = microseconds / 1_000_000.0;
                let progress = (current_time / duration * 100.0).min(100.0);
                on_progress(progress);
            }
        }
    }

    let status = child.wait().await.map_err(|e| format!("FFmpeg process error: {}", e))?;

    if !status.success() {
        // Try to get error from stderr
        return Err("FFmpeg encoding failed".to_string());
    }

    on_progress(100.0);
    Ok(())
}

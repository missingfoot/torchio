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
        // During dev: target/debug/torchio.exe
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

/// Comprehensive media metadata for file info display
#[derive(Debug, Clone, serde::Serialize)]
pub struct MediaMetadata {
    // Video stream info
    pub video_codec: Option<String>,
    pub video_codec_long: Option<String>,
    pub width: u32,
    pub height: u32,
    pub frame_rate: Option<String>,
    pub frame_rate_decimal: Option<f64>,
    pub video_bitrate: Option<u64>,
    pub pixel_format: Option<String>,
    pub color_space: Option<String>,
    pub duration: f64,

    // Audio stream info
    pub audio_codec: Option<String>,
    pub audio_codec_long: Option<String>,
    pub audio_channels: Option<u32>,
    pub audio_channel_layout: Option<String>,
    pub audio_sample_rate: Option<u32>,
    pub audio_bitrate: Option<u64>,

    // Format/container info
    pub format_name: Option<String>,
    pub format_long_name: Option<String>,
    pub overall_bitrate: Option<u64>,
}

pub async fn get_media_metadata(ffprobe_path: &PathBuf, input: &str) -> Result<MediaMetadata, String> {
    let output = Command::new(ffprobe_path)
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            input,
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run ffprobe: {}", e))?;

    if !output.status.success() {
        return Err("ffprobe failed to analyze file".to_string());
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse ffprobe output: {}", e))?;

    let mut metadata = MediaMetadata {
        video_codec: None,
        video_codec_long: None,
        width: 0,
        height: 0,
        frame_rate: None,
        frame_rate_decimal: None,
        video_bitrate: None,
        pixel_format: None,
        color_space: None,
        duration: 0.0,
        audio_codec: None,
        audio_codec_long: None,
        audio_channels: None,
        audio_channel_layout: None,
        audio_sample_rate: None,
        audio_bitrate: None,
        format_name: None,
        format_long_name: None,
        overall_bitrate: None,
    };

    // Parse format info
    if let Some(format) = json.get("format") {
        metadata.format_name = format.get("format_name").and_then(|v| v.as_str()).map(String::from);
        metadata.format_long_name = format.get("format_long_name").and_then(|v| v.as_str()).map(String::from);
        metadata.duration = format.get("duration")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse().ok())
            .unwrap_or(0.0);
        metadata.overall_bitrate = format.get("bit_rate")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse().ok());
    }

    // Parse streams
    if let Some(streams) = json.get("streams").and_then(|v| v.as_array()) {
        for stream in streams {
            let codec_type = stream.get("codec_type").and_then(|v| v.as_str()).unwrap_or("");

            match codec_type {
                "video" if metadata.video_codec.is_none() => {
                    metadata.video_codec = stream.get("codec_name").and_then(|v| v.as_str()).map(String::from);
                    metadata.video_codec_long = stream.get("codec_long_name").and_then(|v| v.as_str()).map(String::from);
                    metadata.width = stream.get("width").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                    metadata.height = stream.get("height").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                    metadata.pixel_format = stream.get("pix_fmt").and_then(|v| v.as_str()).map(String::from);
                    metadata.color_space = stream.get("color_space").and_then(|v| v.as_str()).map(String::from);
                    metadata.video_bitrate = stream.get("bit_rate")
                        .and_then(|v| v.as_str())
                        .and_then(|s| s.parse().ok());

                    // Parse frame rate (usually in format "30000/1001" or "30/1")
                    if let Some(fps_str) = stream.get("r_frame_rate").and_then(|v| v.as_str()) {
                        metadata.frame_rate = Some(fps_str.to_string());
                        // Convert to decimal
                        let parts: Vec<&str> = fps_str.split('/').collect();
                        if parts.len() == 2 {
                            if let (Ok(num), Ok(den)) = (parts[0].parse::<f64>(), parts[1].parse::<f64>()) {
                                if den > 0.0 {
                                    metadata.frame_rate_decimal = Some(num / den);
                                }
                            }
                        }
                    }

                    // Get duration from stream if not in format
                    if metadata.duration == 0.0 {
                        metadata.duration = stream.get("duration")
                            .and_then(|v| v.as_str())
                            .and_then(|s| s.parse().ok())
                            .unwrap_or(0.0);
                    }
                }
                "audio" if metadata.audio_codec.is_none() => {
                    metadata.audio_codec = stream.get("codec_name").and_then(|v| v.as_str()).map(String::from);
                    metadata.audio_codec_long = stream.get("codec_long_name").and_then(|v| v.as_str()).map(String::from);
                    metadata.audio_channels = stream.get("channels").and_then(|v| v.as_u64()).map(|v| v as u32);
                    metadata.audio_channel_layout = stream.get("channel_layout").and_then(|v| v.as_str()).map(String::from);
                    metadata.audio_sample_rate = stream.get("sample_rate")
                        .and_then(|v| v.as_str())
                        .and_then(|s| s.parse().ok());
                    metadata.audio_bitrate = stream.get("bit_rate")
                        .and_then(|v| v.as_str())
                        .and_then(|s| s.parse().ok());
                }
                _ => {}
            }
        }
    }

    Ok(metadata)
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

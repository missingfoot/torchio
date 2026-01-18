#![allow(unused_imports)]

use crate::ffmpeg::{get_ffmpeg_path, get_ffprobe_path, get_video_info, run_ffmpeg_with_progress};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::Emitter;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversionResult {
    pub success: bool,
    #[serde(rename = "outputPath")]
    pub output_path: Option<String>,
    #[serde(rename = "outputSize")]
    pub output_size: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct ProgressPayload {
    id: String,
    progress: f64,
    status: String,
}

// Cache for NVENC availability check
static NVENC_AVAILABLE: OnceLock<bool> = OnceLock::new();

fn emit_progress(app: &tauri::AppHandle, id: &str, progress: f64, status: &str) {
    let _ = app.emit(
        "conversion-progress",
        ProgressPayload {
            id: id.to_string(),
            progress,
            status: status.to_string(),
        },
    );
}

async fn check_nvenc_available(ffmpeg_path: &PathBuf) -> bool {
    // Check if already cached
    if let Some(&available) = NVENC_AVAILABLE.get() {
        return available;
    }

    // Test NVENC by checking if encoder is available
    let output = Command::new(ffmpeg_path)
        .args(["-hide_banner", "-encoders"])
        .output()
        .await;

    let available = match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            stdout.contains("h264_nvenc")
        }
        Err(_) => false,
    };

    let _ = NVENC_AVAILABLE.set(available);
    available
}

pub async fn convert_file_impl(
    app: tauri::AppHandle,
    id: String,
    input_path: String,
    target_bytes: u64,
    conversion_type: String,
    trim_start: Option<f64>,
    trim_duration: Option<f64>,
) -> Result<ConversionResult, String> {
    let result = match conversion_type.as_str() {
        "video" => convert_video(&app, &id, &input_path, target_bytes).await,
        "webp" => convert_to_webp(&app, &id, &input_path, target_bytes, trim_start, trim_duration).await,
        _ => Err("Unknown conversion type".to_string()),
    };

    match result {
        Ok(r) => Ok(r),
        Err(e) => Ok(ConversionResult {
            success: false,
            output_path: None,
            output_size: None,
            error: Some(e),
        }),
    }
}

async fn convert_video(
    app: &tauri::AppHandle,
    id: &str,
    input_path: &str,
    target_bytes: u64,
) -> Result<ConversionResult, String> {
    let ffmpeg = get_ffmpeg_path(app);
    let ffprobe = get_ffprobe_path(app);

    emit_progress(app, id, 0.0, "analyzing");

    // Get video info
    let info = get_video_info(&ffprobe, input_path).await?;

    // Check for NVENC support
    let use_nvenc = check_nvenc_available(&ffmpeg).await;

    // Calculate target bitrate
    let audio_bitrate = 128_000.0; // 128 kbps for audio
    let total_bitrate = (target_bytes as f64 * 8.0) / info.duration;
    let video_bitrate = (total_bitrate - audio_bitrate).max(100_000.0);

    // Convert to kbps for ffmpeg
    let video_bitrate_k = (video_bitrate / 1000.0) as u32;

    // Build output path
    let input_pathbuf = PathBuf::from(input_path);
    let stem = input_pathbuf
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let parent = input_pathbuf.parent().unwrap_or(&input_pathbuf);
    let output_path = parent.join(format!("{}_converted.mp4", stem));
    let output_str = output_path.to_string_lossy().to_string();

    // Determine scaling - cap at 1080p for web optimization
    let scale_filter = if info.height > 1080 {
        "scale=-2:1080"
    } else if info.width > 1920 {
        "scale=1920:-2"
    } else {
        "scale=trunc(iw/2)*2:trunc(ih/2)*2"
    };

    emit_progress(app, id, 5.0, "converting");

    if use_nvenc {
        // NVENC single-pass encoding (faster, uses GPU)
        convert_video_nvenc(app, id, input_path, &output_str, &ffmpeg, &info, video_bitrate_k, scale_filter).await?;
    } else {
        // CPU two-pass encoding (slower, better quality per bit)
        convert_video_x264(app, id, input_path, &output_str, &ffmpeg, &info, video_bitrate_k, scale_filter).await?;
    }

    // Get output file size
    let output_size = fs::metadata(&output_path)
        .map(|m| m.len())
        .unwrap_or(0);

    emit_progress(app, id, 100.0, "completed");

    Ok(ConversionResult {
        success: true,
        output_path: Some(output_str),
        output_size: Some(output_size),
        error: None,
    })
}

async fn convert_video_nvenc(
    app: &tauri::AppHandle,
    id: &str,
    input_path: &str,
    output_str: &str,
    ffmpeg: &PathBuf,
    info: &crate::ffmpeg::VideoInfo,
    video_bitrate_k: u32,
    scale_filter: &str,
) -> Result<(), String> {
    let app_clone = app.clone();
    let id_clone = id.to_string();

    let bitrate_str = format!("{}k", video_bitrate_k);
    let maxrate_str = format!("{}k", (video_bitrate_k as f64 * 1.5) as u32);
    let bufsize_str = format!("{}k", video_bitrate_k * 2);

    // NVENC single-pass with high quality preset
    let args = vec![
        "-y",
        "-i", input_path,
        "-c:v", "h264_nvenc",
        "-preset", "p7",           // Slowest/best quality NVENC preset
        "-tune", "hq",             // High quality tuning
        "-rc", "vbr",              // Variable bitrate
        "-b:v", &bitrate_str,
        "-maxrate", &maxrate_str,
        "-bufsize", &bufsize_str,
        "-profile:v", "high",
        "-vf", scale_filter,
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        output_str,
    ];

    run_ffmpeg_with_progress(ffmpeg, args, info.duration, |progress| {
        emit_progress(&app_clone, &id_clone, 5.0 + progress * 0.95, "converting");
    })
    .await
}

async fn convert_video_x264(
    app: &tauri::AppHandle,
    id: &str,
    input_path: &str,
    output_str: &str,
    ffmpeg: &PathBuf,
    info: &crate::ffmpeg::VideoInfo,
    video_bitrate_k: u32,
    scale_filter: &str,
) -> Result<(), String> {
    let bitrate_str = format!("{}k", video_bitrate_k);
    let maxrate_str = format!("{}k", (video_bitrate_k as f64 * 1.5) as u32);
    let bufsize_str = format!("{}k", video_bitrate_k * 2);

    #[cfg(target_os = "windows")]
    let null_output = "NUL";
    #[cfg(not(target_os = "windows"))]
    let null_output = "/dev/null";

    // Pass 1
    let app_clone = app.clone();
    let id_clone = id.to_string();

    let pass1_args = vec![
        "-y",
        "-i", input_path,
        "-c:v", "libx264",
        "-preset", "slow",
        "-b:v", &bitrate_str,
        "-maxrate", &maxrate_str,
        "-bufsize", &bufsize_str,
        "-vf", scale_filter,
        "-pass", "1",
        "-passlogfile", output_str,
        "-an",
        "-f", "null",
        null_output,
    ];

    run_ffmpeg_with_progress(ffmpeg, pass1_args, info.duration, |progress| {
        emit_progress(&app_clone, &id_clone, 5.0 + progress * 0.45, "converting");
    })
    .await?;

    // Pass 2
    let app_clone = app.clone();
    let id_clone = id.to_string();

    let pass2_args = vec![
        "-y",
        "-i", input_path,
        "-c:v", "libx264",
        "-preset", "slow",
        "-b:v", &bitrate_str,
        "-maxrate", &maxrate_str,
        "-bufsize", &bufsize_str,
        "-vf", scale_filter,
        "-pass", "2",
        "-passlogfile", output_str,
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        output_str,
    ];

    run_ffmpeg_with_progress(ffmpeg, pass2_args, info.duration, |progress| {
        emit_progress(&app_clone, &id_clone, 50.0 + progress * 0.50, "converting");
    })
    .await?;

    // Clean up pass log files
    let _ = fs::remove_file(format!("{}-0.log", output_str));
    let _ = fs::remove_file(format!("{}-0.log.mbtree", output_str));

    Ok(())
}

async fn convert_to_webp(
    app: &tauri::AppHandle,
    id: &str,
    input_path: &str,
    target_bytes: u64,
    trim_start: Option<f64>,
    trim_duration: Option<f64>,
) -> Result<ConversionResult, String> {
    let ffmpeg = get_ffmpeg_path(app);
    let ffprobe = get_ffprobe_path(app);

    emit_progress(app, id, 0.0, "analyzing");

    let info = get_video_info(&ffprobe, input_path).await?;

    // Use trimmed duration if provided, otherwise use full video duration
    let effective_duration = trim_duration.unwrap_or(info.duration);

    // Build output path
    let input_pathbuf = PathBuf::from(input_path);
    let stem = input_pathbuf
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let parent = input_pathbuf.parent().unwrap_or(&input_pathbuf);
    let output_path = parent.join(format!("{}.webp", stem));
    let output_str = output_path.to_string_lossy().to_string();

    // Quality tiers: (max_dimension, fps, quality)
    // Start high quality, progressively reduce size/fps to hit target
    // Never go below 20fps
    let tiers: &[(u32, u32, u32)] = &[
        (600, 30, 70),
        (600, 24, 65),
        (500, 20, 60),
        (400, 20, 55),
        (350, 20, 50),
        (300, 20, 45),
    ];

    let mut final_size = 0u64;

    for (i, &(max_dim, fps, quality)) in tiers.iter().enumerate() {
        let progress_base = (i as f64 / tiers.len() as f64) * 90.0;
        let progress_chunk = 90.0 / tiers.len() as f64;

        emit_progress(app, id, progress_base, "converting");

        let _ = fs::remove_file(&output_path);

        // Build filter: scale to fit within max_dim x max_dim, ensure even dimensions, set fps
        let vf_filter = format!(
            "scale='min({0},iw)':'min({0},ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,fps={1}",
            max_dim, fps
        );
        let quality_str = quality.to_string();

        let app_clone = app.clone();
        let id_clone = id.to_string();

        // Build args with optional trim parameters using hybrid seeking for frame-accuracy
        // Hybrid seeking: fast seek (whole seconds) BEFORE -i, accurate seek (fraction) AFTER -i
        let trim_duration_str = trim_duration.map(|d| format!("{:.3}", d));

        // Split trim_start into fast seek (whole seconds) and accurate seek (fractional part)
        let (fast_seek_str, accurate_seek_str) = if let Some(start) = trim_start {
            let fast = start.floor();
            let accurate = start - fast;
            (
                Some(format!("{:.0}", fast)),
                if accurate > 0.001 { Some(format!("{:.3}", accurate)) } else { None }
            )
        } else {
            (None, None)
        };

        let mut args: Vec<&str> = vec!["-y"];

        // Fast seek BEFORE input (seeks to nearest keyframe - fast but approximate)
        if let Some(ref fast) = fast_seek_str {
            args.extend(["-ss", fast.as_str()]);
        }

        args.extend(["-i", input_path]);

        // Accurate seek AFTER input (decodes frames for exact positioning)
        if let Some(ref accurate) = accurate_seek_str {
            args.extend(["-ss", accurate.as_str()]);
        }

        // Add duration AFTER input
        if let Some(ref duration) = trim_duration_str {
            args.extend(["-t", duration.as_str()]);
        }

        args.extend([
            "-vf", &vf_filter,
            "-vcodec", "libwebp",
            "-lossless", "0",
            "-compression_level", "4",
            "-quality", &quality_str,
            "-loop", "0",
            "-an",
            &output_str,
        ]);

        run_ffmpeg_with_progress(&ffmpeg, args, effective_duration, move |progress| {
            emit_progress(&app_clone, &id_clone, progress_base + (progress / 100.0) * progress_chunk, "converting");
        })
        .await?;

        final_size = fs::metadata(&output_path).map(|m| m.len()).unwrap_or(0);

        // If within target (or 10% over), we're done
        if final_size <= target_bytes * 11 / 10 {
            break;
        }
    }

    emit_progress(app, id, 100.0, "completed");

    Ok(ConversionResult {
        success: true,
        output_path: Some(output_str),
        output_size: Some(final_size),
        error: None,
    })
}

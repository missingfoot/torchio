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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Marker {
    pub id: u32,
    pub time: f64,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct ProgressPayload {
    id: String,
    progress: f64,
    status: String,
}

// Cache for NVENC availability checks
static NVENC_H264_AVAILABLE: OnceLock<bool> = OnceLock::new();
static NVENC_HEVC_AVAILABLE: OnceLock<bool> = OnceLock::new();

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

async fn check_nvenc_h264_available(ffmpeg_path: &PathBuf) -> bool {
    if let Some(&available) = NVENC_H264_AVAILABLE.get() {
        return available;
    }

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

    let _ = NVENC_H264_AVAILABLE.set(available);
    available
}

async fn check_nvenc_hevc_available(ffmpeg_path: &PathBuf) -> bool {
    if let Some(&available) = NVENC_HEVC_AVAILABLE.get() {
        return available;
    }

    let output = Command::new(ffmpeg_path)
        .args(["-hide_banner", "-encoders"])
        .output()
        .await;

    let available = match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            stdout.contains("hevc_nvenc")
        }
        Err(_) => false,
    };

    let _ = NVENC_HEVC_AVAILABLE.set(available);
    available
}

/// Generate FFmetadata file content for MKV chapters
/// Markers should be relative to the output video (already adjusted for trim_start)
fn generate_chapter_metadata(markers: &[Marker], total_duration: f64) -> String {
    if markers.is_empty() {
        return String::new();
    }

    let mut sorted_markers: Vec<&Marker> = markers.iter().collect();
    sorted_markers.sort_by(|a, b| a.time.partial_cmp(&b.time).unwrap_or(std::cmp::Ordering::Equal));

    let mut content = String::from(";FFMETADATA1\n");

    for (i, marker) in sorted_markers.iter().enumerate() {
        // Start time in milliseconds
        let start_ms = (marker.time * 1000.0) as u64;

        // End time is either the next marker's time or total duration
        let end_ms = if i + 1 < sorted_markers.len() {
            (sorted_markers[i + 1].time * 1000.0) as u64
        } else {
            (total_duration * 1000.0) as u64
        };

        // Chapter title - use marker name or default to "Chapter N"
        let title = marker.name.clone().unwrap_or_else(|| format!("Chapter {}", i + 1));

        content.push_str("[CHAPTER]\n");
        content.push_str("TIMEBASE=1/1000\n");
        content.push_str(&format!("START={}\n", start_ms));
        content.push_str(&format!("END={}\n", end_ms));
        content.push_str(&format!("title={}\n\n", title));
    }

    content
}

/// Adjust markers relative to trim start (for chapters in trimmed video)
fn adjust_markers_for_trim(markers: &[Marker], trim_start: Option<f64>, trim_duration: Option<f64>) -> Vec<Marker> {
    let start = trim_start.unwrap_or(0.0);
    let end = trim_start.unwrap_or(0.0) + trim_duration.unwrap_or(f64::MAX);

    markers
        .iter()
        .filter(|m| m.time >= start && m.time <= end)
        .map(|m| Marker {
            id: m.id,
            time: m.time - start, // Adjust to be relative to trim start
            name: m.name.clone(),
        })
        .collect()
}

pub async fn convert_file_impl(
    app: tauri::AppHandle,
    id: String,
    input_path: String,
    output_name: String,
    target_bytes: u64,
    conversion_type: String,
    trim_start: Option<f64>,
    trim_duration: Option<f64>,
    markers: Option<Vec<Marker>>,
) -> Result<ConversionResult, String> {
    let result = match conversion_type.as_str() {
        // Video formats - H.264
        "mp4" | "mov" => convert_video_h264(&app, &id, &input_path, &output_name, target_bytes, trim_start, trim_duration, None).await,
        // MKV with optional chapters
        "mkv" => convert_video_h264(&app, &id, &input_path, &output_name, target_bytes, trim_start, trim_duration, markers).await,
        // Video format - H.265/HEVC
        "mp4_hevc" => convert_video_hevc(&app, &id, &input_path, &output_name, target_bytes, trim_start, trim_duration).await,
        // Animated image formats
        "webp" => convert_to_webp(&app, &id, &input_path, &output_name, target_bytes, trim_start, trim_duration).await,
        "gif" => convert_to_gif(&app, &id, &input_path, &output_name, target_bytes, trim_start, trim_duration).await,
        _ => Err(format!("Unknown conversion type: {}", conversion_type)),
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

async fn convert_video_h264(
    app: &tauri::AppHandle,
    id: &str,
    input_path: &str,
    output_name: &str,
    target_bytes: u64,
    trim_start: Option<f64>,
    trim_duration: Option<f64>,
    markers: Option<Vec<Marker>>,
) -> Result<ConversionResult, String> {
    let ffmpeg = get_ffmpeg_path(app);
    let ffprobe = get_ffprobe_path(app);

    emit_progress(app, id, 0.0, "analyzing");

    // Get video info
    let info = get_video_info(&ffprobe, input_path).await?;

    // Use trim duration if provided, otherwise use full video duration
    let effective_duration = trim_duration.unwrap_or(info.duration);

    // Check for NVENC H.264 support
    let use_nvenc = check_nvenc_h264_available(&ffmpeg).await;

    // Calculate target bitrate based on effective duration
    let audio_bitrate = 128_000.0; // 128 kbps for audio
    let total_bitrate = (target_bytes as f64 * 8.0) / effective_duration;
    let video_bitrate = (total_bitrate - audio_bitrate).max(100_000.0);

    // Convert to kbps for ffmpeg
    let video_bitrate_k = (video_bitrate / 1000.0) as u32;

    // Build output path using the provided output_name
    let input_pathbuf = PathBuf::from(input_path);
    let parent = input_pathbuf.parent().unwrap_or(&input_pathbuf);
    let output_path = parent.join(output_name);
    let output_str = output_path.to_string_lossy().to_string();

    // Determine scaling - cap at 1080p for web optimization
    let scale_filter = if info.height > 1080 {
        "scale=-2:1080"
    } else if info.width > 1920 {
        "scale=1920:-2"
    } else {
        "scale=trunc(iw/2)*2:trunc(ih/2)*2"
    };

    // Prepare chapter metadata for MKV if markers provided
    let metadata_path = if let Some(ref mkrs) = markers {
        if !mkrs.is_empty() && output_name.ends_with(".mkv") {
            // Adjust markers for trim and generate metadata
            let adjusted = adjust_markers_for_trim(mkrs, trim_start, trim_duration);
            if !adjusted.is_empty() {
                let metadata = generate_chapter_metadata(&adjusted, effective_duration);
                let temp_dir = std::env::temp_dir();
                let meta_file = temp_dir.join(format!("chapters_{}.txt", id));
                fs::write(&meta_file, &metadata).map_err(|e| format!("Failed to write chapter metadata: {}", e))?;
                Some(meta_file)
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    emit_progress(app, id, 5.0, "converting");

    if use_nvenc {
        // NVENC single-pass encoding (faster, uses GPU)
        convert_video_nvenc(app, id, input_path, &output_str, &ffmpeg, effective_duration, video_bitrate_k, scale_filter, trim_start, trim_duration, metadata_path.as_ref()).await?;
    } else {
        // CPU two-pass encoding (slower, better quality per bit)
        convert_video_x264(app, id, input_path, &output_str, &ffmpeg, effective_duration, video_bitrate_k, scale_filter, trim_start, trim_duration, metadata_path.as_ref()).await?;
    }

    // Clean up temp metadata file
    if let Some(ref meta_file) = metadata_path {
        let _ = fs::remove_file(meta_file);
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

async fn convert_video_hevc(
    app: &tauri::AppHandle,
    id: &str,
    input_path: &str,
    output_name: &str,
    target_bytes: u64,
    trim_start: Option<f64>,
    trim_duration: Option<f64>,
) -> Result<ConversionResult, String> {
    let ffmpeg = get_ffmpeg_path(app);
    let ffprobe = get_ffprobe_path(app);

    emit_progress(app, id, 0.0, "analyzing");

    let info = get_video_info(&ffprobe, input_path).await?;
    let effective_duration = trim_duration.unwrap_or(info.duration);

    // Check for NVENC HEVC support
    let use_nvenc = check_nvenc_hevc_available(&ffmpeg).await;

    // Calculate target bitrate - HEVC is ~25% more efficient
    let audio_bitrate = 128_000.0;
    let total_bitrate = (target_bytes as f64 * 8.0) / effective_duration;
    let video_bitrate = (total_bitrate - audio_bitrate).max(100_000.0);
    let video_bitrate_k = (video_bitrate / 1000.0) as u32;

    let input_pathbuf = PathBuf::from(input_path);
    let parent = input_pathbuf.parent().unwrap_or(&input_pathbuf);
    let output_path = parent.join(output_name);
    let output_str = output_path.to_string_lossy().to_string();

    let scale_filter = if info.height > 1080 {
        "scale=-2:1080"
    } else if info.width > 1920 {
        "scale=1920:-2"
    } else {
        "scale=trunc(iw/2)*2:trunc(ih/2)*2"
    };

    emit_progress(app, id, 5.0, "converting");

    if use_nvenc {
        convert_video_nvenc_hevc(app, id, input_path, &output_str, &ffmpeg, effective_duration, video_bitrate_k, scale_filter, trim_start, trim_duration).await?;
    } else {
        convert_video_x265(app, id, input_path, &output_str, &ffmpeg, effective_duration, video_bitrate_k, scale_filter, trim_start, trim_duration).await?;
    }

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
    effective_duration: f64,
    video_bitrate_k: u32,
    scale_filter: &str,
    trim_start: Option<f64>,
    trim_duration: Option<f64>,
    metadata_path: Option<&PathBuf>,
) -> Result<(), String> {
    let app_clone = app.clone();
    let id_clone = id.to_string();

    let bitrate_str = format!("{}k", video_bitrate_k);
    let maxrate_str = format!("{}k", (video_bitrate_k as f64 * 1.5) as u32);
    let bufsize_str = format!("{}k", video_bitrate_k * 2);

    // Build args with optional trim parameters
    let mut args: Vec<String> = vec!["-y".to_string()];

    // Add trim start (seek) before input for fast seeking
    if let Some(start) = trim_start {
        args.push("-ss".to_string());
        args.push(format!("{:.3}", start));
    }

    args.push("-i".to_string());
    args.push(input_path.to_string());

    // Add chapter metadata file as second input (for MKV)
    if let Some(meta_path) = metadata_path {
        args.push("-i".to_string());
        args.push(meta_path.to_string_lossy().to_string());
    }

    // Add trim duration after input
    if let Some(duration) = trim_duration {
        args.push("-t".to_string());
        args.push(format!("{:.3}", duration));
    }

    // NVENC single-pass with high quality preset
    args.extend([
        "-c:v".to_string(), "h264_nvenc".to_string(),
        "-preset".to_string(), "p7".to_string(),
        "-tune".to_string(), "hq".to_string(),
        "-rc".to_string(), "vbr".to_string(),
        "-b:v".to_string(), bitrate_str,
        "-maxrate".to_string(), maxrate_str,
        "-bufsize".to_string(), bufsize_str,
        "-profile:v".to_string(), "high".to_string(),
        "-vf".to_string(), scale_filter.to_string(),
        "-c:a".to_string(), "aac".to_string(),
        "-b:a".to_string(), "128k".to_string(),
    ]);

    // Map metadata from chapter file if provided
    if metadata_path.is_some() {
        args.extend([
            "-map".to_string(), "0".to_string(),          // Map all streams from first input (video)
            "-map_metadata".to_string(), "1".to_string(), // Map metadata from second input (chapters)
        ]);
    } else {
        args.extend(["-movflags".to_string(), "+faststart".to_string()]);
    }

    args.push(output_str.to_string());

    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    run_ffmpeg_with_progress(ffmpeg, args_refs, effective_duration, |progress| {
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
    effective_duration: f64,
    video_bitrate_k: u32,
    scale_filter: &str,
    trim_start: Option<f64>,
    trim_duration: Option<f64>,
    metadata_path: Option<&PathBuf>,
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

    // Build args with optional trim parameters
    let mut pass1_args: Vec<String> = vec!["-y".to_string()];

    // Add trim start (seek) before input for fast seeking
    if let Some(start) = trim_start {
        pass1_args.push("-ss".to_string());
        pass1_args.push(format!("{:.3}", start));
    }

    pass1_args.push("-i".to_string());
    pass1_args.push(input_path.to_string());

    // Add trim duration after input
    if let Some(duration) = trim_duration {
        pass1_args.push("-t".to_string());
        pass1_args.push(format!("{:.3}", duration));
    }

    pass1_args.extend([
        "-c:v".to_string(), "libx264".to_string(),
        "-preset".to_string(), "slow".to_string(),
        "-b:v".to_string(), bitrate_str.clone(),
        "-maxrate".to_string(), maxrate_str.clone(),
        "-bufsize".to_string(), bufsize_str.clone(),
        "-vf".to_string(), scale_filter.to_string(),
        "-pass".to_string(), "1".to_string(),
        "-passlogfile".to_string(), output_str.to_string(),
        "-an".to_string(),
        "-f".to_string(), "null".to_string(),
        null_output.to_string(),
    ]);

    let pass1_refs: Vec<&str> = pass1_args.iter().map(|s| s.as_str()).collect();

    run_ffmpeg_with_progress(ffmpeg, pass1_refs, effective_duration, |progress| {
        emit_progress(&app_clone, &id_clone, 5.0 + progress * 0.45, "converting");
    })
    .await?;

    // Pass 2
    let app_clone = app.clone();
    let id_clone = id.to_string();

    let mut pass2_args: Vec<String> = vec!["-y".to_string()];

    // Add trim start (seek) before input for fast seeking
    if let Some(start) = trim_start {
        pass2_args.push("-ss".to_string());
        pass2_args.push(format!("{:.3}", start));
    }

    pass2_args.push("-i".to_string());
    pass2_args.push(input_path.to_string());

    // Add chapter metadata file as second input (for MKV)
    if let Some(meta_path) = metadata_path {
        pass2_args.push("-i".to_string());
        pass2_args.push(meta_path.to_string_lossy().to_string());
    }

    // Add trim duration after input
    if let Some(duration) = trim_duration {
        pass2_args.push("-t".to_string());
        pass2_args.push(format!("{:.3}", duration));
    }

    pass2_args.extend([
        "-c:v".to_string(), "libx264".to_string(),
        "-preset".to_string(), "slow".to_string(),
        "-b:v".to_string(), bitrate_str,
        "-maxrate".to_string(), maxrate_str,
        "-bufsize".to_string(), bufsize_str,
        "-vf".to_string(), scale_filter.to_string(),
        "-pass".to_string(), "2".to_string(),
        "-passlogfile".to_string(), output_str.to_string(),
        "-c:a".to_string(), "aac".to_string(),
        "-b:a".to_string(), "128k".to_string(),
    ]);

    // Map metadata from chapter file if provided
    if metadata_path.is_some() {
        pass2_args.extend([
            "-map".to_string(), "0".to_string(),          // Map all streams from first input (video)
            "-map_metadata".to_string(), "1".to_string(), // Map metadata from second input (chapters)
        ]);
    } else {
        pass2_args.extend(["-movflags".to_string(), "+faststart".to_string()]);
    }

    pass2_args.push(output_str.to_string());

    let pass2_refs: Vec<&str> = pass2_args.iter().map(|s| s.as_str()).collect();

    run_ffmpeg_with_progress(ffmpeg, pass2_refs, effective_duration, |progress| {
        emit_progress(&app_clone, &id_clone, 50.0 + progress * 0.50, "converting");
    })
    .await?;

    // Clean up pass log files
    let _ = fs::remove_file(format!("{}-0.log", output_str));
    let _ = fs::remove_file(format!("{}-0.log.mbtree", output_str));

    Ok(())
}

async fn convert_video_nvenc_hevc(
    app: &tauri::AppHandle,
    id: &str,
    input_path: &str,
    output_str: &str,
    ffmpeg: &PathBuf,
    effective_duration: f64,
    video_bitrate_k: u32,
    scale_filter: &str,
    trim_start: Option<f64>,
    trim_duration: Option<f64>,
) -> Result<(), String> {
    let app_clone = app.clone();
    let id_clone = id.to_string();

    let bitrate_str = format!("{}k", video_bitrate_k);
    let maxrate_str = format!("{}k", (video_bitrate_k as f64 * 1.5) as u32);
    let bufsize_str = format!("{}k", video_bitrate_k * 2);

    let mut args: Vec<String> = vec!["-y".to_string()];

    if let Some(start) = trim_start {
        args.push("-ss".to_string());
        args.push(format!("{:.3}", start));
    }

    args.push("-i".to_string());
    args.push(input_path.to_string());

    if let Some(duration) = trim_duration {
        args.push("-t".to_string());
        args.push(format!("{:.3}", duration));
    }

    // NVENC HEVC encoding
    args.extend([
        "-c:v".to_string(), "hevc_nvenc".to_string(),
        "-preset".to_string(), "p7".to_string(),
        "-tune".to_string(), "hq".to_string(),
        "-rc".to_string(), "vbr".to_string(),
        "-b:v".to_string(), bitrate_str,
        "-maxrate".to_string(), maxrate_str,
        "-bufsize".to_string(), bufsize_str,
        "-profile:v".to_string(), "main".to_string(),
        "-vf".to_string(), scale_filter.to_string(),
        "-c:a".to_string(), "aac".to_string(),
        "-b:a".to_string(), "128k".to_string(),
        "-movflags".to_string(), "+faststart".to_string(),
        "-tag:v".to_string(), "hvc1".to_string(), // Better Apple compatibility
        output_str.to_string(),
    ]);

    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    run_ffmpeg_with_progress(ffmpeg, args_refs, effective_duration, |progress| {
        emit_progress(&app_clone, &id_clone, 5.0 + progress * 0.95, "converting");
    })
    .await
}

async fn convert_video_x265(
    app: &tauri::AppHandle,
    id: &str,
    input_path: &str,
    output_str: &str,
    ffmpeg: &PathBuf,
    effective_duration: f64,
    video_bitrate_k: u32,
    scale_filter: &str,
    trim_start: Option<f64>,
    trim_duration: Option<f64>,
) -> Result<(), String> {
    let app_clone = app.clone();
    let id_clone = id.to_string();

    let bitrate_str = format!("{}k", video_bitrate_k);
    let maxrate_str = format!("{}k", (video_bitrate_k as f64 * 1.5) as u32);
    let bufsize_str = format!("{}k", video_bitrate_k * 2);

    let mut args: Vec<String> = vec!["-y".to_string()];

    if let Some(start) = trim_start {
        args.push("-ss".to_string());
        args.push(format!("{:.3}", start));
    }

    args.push("-i".to_string());
    args.push(input_path.to_string());

    if let Some(duration) = trim_duration {
        args.push("-t".to_string());
        args.push(format!("{:.3}", duration));
    }

    // CPU x265 encoding (single pass for speed, still good quality)
    args.extend([
        "-c:v".to_string(), "libx265".to_string(),
        "-preset".to_string(), "medium".to_string(),
        "-b:v".to_string(), bitrate_str,
        "-maxrate".to_string(), maxrate_str,
        "-bufsize".to_string(), bufsize_str,
        "-vf".to_string(), scale_filter.to_string(),
        "-c:a".to_string(), "aac".to_string(),
        "-b:a".to_string(), "128k".to_string(),
        "-movflags".to_string(), "+faststart".to_string(),
        "-tag:v".to_string(), "hvc1".to_string(),
        output_str.to_string(),
    ]);

    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    run_ffmpeg_with_progress(ffmpeg, args_refs, effective_duration, |progress| {
        emit_progress(&app_clone, &id_clone, 5.0 + progress * 0.95, "converting");
    })
    .await
}

async fn convert_to_webp(
    app: &tauri::AppHandle,
    id: &str,
    input_path: &str,
    output_name: &str,
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

    // Build output path using the provided output_name
    let input_pathbuf = PathBuf::from(input_path);
    let parent = input_pathbuf.parent().unwrap_or(&input_pathbuf);
    let output_path = parent.join(output_name);
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

async fn convert_to_gif(
    app: &tauri::AppHandle,
    id: &str,
    input_path: &str,
    output_name: &str,
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

    // Build output path using the provided output_name
    let input_pathbuf = PathBuf::from(input_path);
    let parent = input_pathbuf.parent().unwrap_or(&input_pathbuf);
    let output_path = parent.join(output_name);
    let output_str = output_path.to_string_lossy().to_string();

    // Quality tiers for GIF: (max_dimension, fps)
    // GIF files get large quickly, so we're more aggressive with scaling
    let tiers: &[(u32, u32)] = &[
        (480, 15),
        (400, 12),
        (320, 10),
        (280, 10),
        (240, 8),
        (200, 8),
    ];

    let mut final_size = 0u64;

    for (i, &(max_dim, fps)) in tiers.iter().enumerate() {
        let progress_base = (i as f64 / tiers.len() as f64) * 90.0;
        let progress_chunk = 90.0 / tiers.len() as f64;

        emit_progress(app, id, progress_base, "converting");

        let _ = fs::remove_file(&output_path);

        // Build filter for scaling and fps
        // GIF requires palette generation for good quality
        let scale_filter = format!(
            "scale='min({0},iw)':'min({0},ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,fps={1}",
            max_dim, fps
        );

        // For GIF, we use the split/palettegen/paletteuse filter for better quality
        let vf_filter = format!(
            "{},split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5",
            scale_filter
        );

        let app_clone = app.clone();
        let id_clone = id.to_string();

        // Build args with optional trim parameters
        let trim_duration_str = trim_duration.map(|d| format!("{:.3}", d));

        // Split trim_start into fast seek and accurate seek
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

        // Fast seek BEFORE input
        if let Some(ref fast) = fast_seek_str {
            args.extend(["-ss", fast.as_str()]);
        }

        args.extend(["-i", input_path]);

        // Accurate seek AFTER input
        if let Some(ref accurate) = accurate_seek_str {
            args.extend(["-ss", accurate.as_str()]);
        }

        // Add duration AFTER input
        if let Some(ref duration) = trim_duration_str {
            args.extend(["-t", duration.as_str()]);
        }

        args.extend([
            "-vf", &vf_filter,
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

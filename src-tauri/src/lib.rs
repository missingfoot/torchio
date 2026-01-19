#![allow(unused_imports)]

mod converter;
mod ffmpeg;

use converter::{convert_file_impl, ConversionResult, Marker};
use ffmpeg::{get_ffmpeg_path, get_ffprobe_path, get_video_info, get_media_metadata, MediaMetadata};
use std::fs;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

#[tauri::command]
async fn get_file_size(path: String) -> Result<u64, String> {
    fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct VideoInfoResult {
    duration: f64,
    width: u32,
    height: u32,
}

#[tauri::command]
async fn get_video_duration(app: tauri::AppHandle, path: String) -> Result<f64, String> {
    let ffprobe = get_ffprobe_path(&app);
    let info = get_video_info(&ffprobe, &path).await?;
    Ok(info.duration)
}

#[tauri::command]
async fn get_video_info_cmd(app: tauri::AppHandle, path: String) -> Result<VideoInfoResult, String> {
    let ffprobe = get_ffprobe_path(&app);
    let info = get_video_info(&ffprobe, &path).await?;
    Ok(VideoInfoResult {
        duration: info.duration,
        width: info.width,
        height: info.height,
    })
}

#[tauri::command]
async fn get_media_metadata_cmd(app: tauri::AppHandle, path: String) -> Result<MediaMetadata, String> {
    let ffprobe = get_ffprobe_path(&app);
    get_media_metadata(&ffprobe, &path).await
}

#[tauri::command]
async fn extract_frame(app: tauri::AppHandle, path: String, timestamp: f64) -> Result<String, String> {
    let ffmpeg = get_ffmpeg_path(&app);

    // Create temp file for the frame with unique name (timestamp + random)
    let temp_dir = std::env::temp_dir();
    let unique_id = format!("{}_{}", std::process::id(), std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos());
    let frame_path = temp_dir.join(format!("frame_{}.jpg", unique_id));
    let frame_str = frame_path.to_string_lossy().to_string();

    // Extract frame using ffmpeg
    let timestamp_str = format!("{:.3}", timestamp);

    let mut cmd = tokio::process::Command::new(&ffmpeg);
    cmd.args([
        "-ss", &timestamp_str,
        "-i", &path,
        "-vframes", "1",
        "-q:v", "5",
        "-y",
        &frame_str,
    ]);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let output = cmd.output().await.map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

    if !output.status.success() {
        return Err("Failed to extract frame".to_string());
    }

    // Read the frame and convert to base64
    let frame_data = fs::read(&frame_path).map_err(|e| format!("Failed to read frame: {}", e))?;
    let _ = fs::remove_file(&frame_path);

    let base64_data = BASE64.encode(&frame_data);
    Ok(format!("data:image/jpeg;base64,{}", base64_data))
}

#[tauri::command]
async fn extract_filmstrip(app: tauri::AppHandle, path: String, duration: f64, count: u32) -> Result<Vec<String>, String> {
    let mut frames = Vec::new();
    let interval = duration / count as f64;

    for i in 0..count {
        let timestamp = i as f64 * interval;
        match extract_frame(app.clone(), path.clone(), timestamp).await {
            Ok(frame) => frames.push(frame),
            Err(_) => frames.push(String::new()), // Empty string for failed frames
        }
    }

    Ok(frames)
}

#[tauri::command]
async fn detect_scenes(app: tauri::AppHandle, path: String, threshold: Option<f64>) -> Result<Vec<f64>, String> {
    let ffmpeg = get_ffmpeg_path(&app);
    let threshold = threshold.unwrap_or(0.3);

    // Build the scene detection filter
    let filter = format!("select='gt(scene,{})',showinfo", threshold);

    let mut cmd = tokio::process::Command::new(&ffmpeg);
    cmd.args([
        "-i", &path,
        "-vf", &filter,
        "-f", "null",
        "-"
    ]);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let output = cmd.output().await.map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

    // Parse stderr for pts_time values from showinfo output
    // Lines look like: [Parsed_showinfo_1 @ 0x...] n:   0 pts:  12012 pts_time:0.500417 ...
    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut timestamps: Vec<f64> = Vec::new();

    for line in stderr.lines() {
        if line.contains("pts_time:") {
            // Extract pts_time value
            if let Some(pts_start) = line.find("pts_time:") {
                let after_pts = &line[pts_start + 9..];
                // Find the end of the number (space or end of string)
                let end = after_pts.find(|c: char| c.is_whitespace()).unwrap_or(after_pts.len());
                if let Ok(time) = after_pts[..end].parse::<f64>() {
                    // Skip times very close to 0 (first frame is often detected)
                    if time > 0.1 {
                        timestamps.push(time);
                    }
                }
            }
        }
    }

    Ok(timestamps)
}

#[tauri::command]
async fn convert_file(
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
    convert_file_impl(app, id, input_path, output_name, target_bytes, conversion_type, trim_start, trim_duration, markers).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![get_file_size, get_video_duration, get_video_info_cmd, get_media_metadata_cmd, extract_frame, extract_filmstrip, detect_scenes, convert_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

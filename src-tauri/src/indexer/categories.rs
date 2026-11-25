pub fn classify_entry(is_dir: bool, extension: &str) -> &'static str {
    if is_dir {
        return "folder";
    }

    let ext = extension.trim().trim_start_matches('.').to_ascii_lowercase();
    match ext.as_str() {
        "mp4" | "mkv" | "mov" | "avi" | "wmv" | "webm" | "flv" | "m4v" | "ts" | "mpg"
        | "mpeg" | "3gp" => "video",
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "svg" | "raw" | "cr2" | "nef"
        | "psd" | "tiff" | "heic" => "image",
        "mp3" | "flac" | "wav" | "ogg" | "aac" | "m4a" | "wma" | "opus" | "alac" => "audio",
        "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "txt" | "csv" | "md"
        | "odt" | "epub" => "document",
        "zip" | "rar" | "7z" | "tar" | "gz" | "iso" | "img" => "archive",
        _ => "other",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_folders_regardless_of_extension() {
        assert_eq!(classify_entry(true, ""), "folder");
        assert_eq!(classify_entry(true, "mp4"), "folder");
    }

    #[test]
    fn classifies_known_extensions_case_insensitively() {
        assert_eq!(classify_entry(false, "MP4"), "video");
        assert_eq!(classify_entry(false, ".mkv"), "video");
        assert_eq!(classify_entry(false, "3GP"), "video");
        assert_eq!(classify_entry(false, "heic"), "image");
        assert_eq!(classify_entry(false, "FLAC"), "audio");
        assert_eq!(classify_entry(false, "docx"), "document");
        assert_eq!(classify_entry(false, "7z"), "archive");
        assert_eq!(classify_entry(false, "exe"), "other");
        assert_eq!(classify_entry(false, ""), "other");
    }
}

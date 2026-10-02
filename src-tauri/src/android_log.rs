//! Routes `tracing` output to logcat on Android, where nothing reads stdout.

#![allow(unsafe_code)]

use std::ffi::{CString, c_char};
use std::io;

use tracing_subscriber::fmt::MakeWriter;

#[link(name = "log")]
unsafe extern "C" {
    fn __android_log_write(prio: i32, tag: *const c_char, text: *const c_char) -> i32;
}

const ANDROID_LOG_INFO: i32 = 4;
const TAG: &str = "git-notes";

/// `MakeWriter` that emits one logcat line per tracing event.
#[derive(Debug, Default, Clone, Copy)]
pub struct Logcat;

#[derive(Debug, Default)]
pub struct LogcatLine(Vec<u8>);

impl io::Write for LogcatLine {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        if self.0.is_empty() {
            return Ok(());
        }
        let text = String::from_utf8_lossy(&self.0)
            .trim_end()
            .replace('\0', " ");
        self.0.clear();
        if let (Ok(tag), Ok(message)) = (CString::new(TAG), CString::new(text)) {
            // SAFETY: liblog is always present on Android; both pointers are valid
            // NUL-terminated strings that outlive the call.
            unsafe {
                __android_log_write(ANDROID_LOG_INFO, tag.as_ptr(), message.as_ptr());
            }
        }
        Ok(())
    }
}

impl Drop for LogcatLine {
    fn drop(&mut self) {
        let _ = io::Write::flush(self);
    }
}

impl<'a> MakeWriter<'a> for Logcat {
    type Writer = LogcatLine;

    fn make_writer(&'a self) -> Self::Writer {
        LogcatLine::default()
    }
}

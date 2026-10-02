//! Trusted roots for HTTPS on Android.
//!
//! The vendored OpenSSL is built with `no-stdio` on Android, so libgit2 cannot load a CA
//! bundle *file*. Instead every system certificate is parsed from memory and handed to
//! libgit2 one by one via `GIT_OPT_ADD_SSL_X509_CERT`.

#![allow(unsafe_code)]

use std::ffi::c_int;
use std::ptr;

/// Android 14+ keeps the roots in the Conscrypt APEX; older images under `/system`.
const CERT_DIRS: [&str; 2] = [
    "/apex/com.android.conscrypt/cacerts",
    "/system/etc/security/cacerts",
];

/// Adds every system CA certificate to libgit2's TLS store. Returns how many were added.
pub fn install_system_roots() -> usize {
    let mut added = 0;
    for dir in CERT_DIRS {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            if let Ok(pem) = std::fs::read(entry.path()) {
                added += add_pem_certificates(&pem);
            }
        }
    }
    added
}

/// Parses all `-----BEGIN CERTIFICATE-----` blocks in `pem` and adds them to libgit2.
fn add_pem_certificates(pem: &[u8]) -> usize {
    let Ok(len) = c_int::try_from(pem.len()) else {
        return 0;
    };
    let mut added = 0;
    // SAFETY: the memory BIO only reads from `pem`, which outlives it. Each certificate
    // returned by `PEM_read_bio_X509` is owned by us and freed after libgit2 has added it to
    // its store (`X509_STORE_add_cert` takes its own reference). All pointers are checked.
    unsafe {
        let bio = openssl_sys::BIO_new_mem_buf(pem.as_ptr().cast(), len);
        if bio.is_null() {
            return 0;
        }
        loop {
            let cert = openssl_sys::PEM_read_bio_X509(bio, ptr::null_mut(), None, ptr::null_mut());
            if cert.is_null() {
                // Either the end of the buffer or trailing non-PEM text (Android appends a
                // human-readable dump after each certificate); both end the loop.
                openssl_sys::ERR_clear_error();
                break;
            }
            let rc = libgit2_sys::git_libgit2_opts(
                libgit2_sys::GIT_OPT_ADD_SSL_X509_CERT as c_int,
                cert,
            );
            if rc == 0 {
                added += 1;
            } else {
                tracing::debug!(rc, "libgit2 rejected a system certificate");
            }
            openssl_sys::X509_free(cert);
        }
        openssl_sys::BIO_free_all(bio);
    }
    added
}

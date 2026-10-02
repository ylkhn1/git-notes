//! Minimal remote URL parsing: enough to pick credentials and classify transport errors.

/// Transport implied by a remote URL.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transport {
    Ssh,
    Https,
    /// Plain `http://` (works, but tokens would travel unencrypted).
    Http,
    /// `file://` or a bare filesystem path.
    Local,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteUrl {
    pub transport: Transport,
    /// Lower-case host name without port; empty for local paths.
    pub host: String,
    pub user: Option<String>,
}

impl RemoteUrl {
    /// Parses `scheme://[user@]host[:port]/path`, scp-like `user@host:path`, `file://…`
    /// and plain paths. Never fails: unrecognised input is `Transport::Unknown`.
    pub fn parse(url: &str) -> Self {
        let url = url.trim();
        if url.starts_with('/')
            || url.starts_with("./")
            || url.starts_with("../")
            || is_windows_path(url)
        {
            return Self::local();
        }
        if let Some((scheme, rest)) = url.split_once("://") {
            let transport = match scheme.to_ascii_lowercase().as_str() {
                "ssh" | "git+ssh" | "ssh+git" => Transport::Ssh,
                "https" => Transport::Https,
                "http" => Transport::Http,
                "file" => return Self::local(),
                _ => Transport::Unknown,
            };
            let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
            let (user, hostport) = match authority.rsplit_once('@') {
                Some((user, hostport)) => (Some(user.to_owned()), hostport),
                None => (None, authority),
            };
            return Self {
                transport,
                host: strip_port(hostport),
                user,
            };
        }
        // scp-like: [user@]host:path (no scheme, a colon before any slash)
        if let Some((authority, _path)) = url.split_once(':')
            && !authority.contains('/')
            && !authority.is_empty()
        {
            let (user, host) = match authority.rsplit_once('@') {
                Some((user, host)) => (Some(user.to_owned()), host),
                None => (None, authority),
            };
            return Self {
                transport: Transport::Ssh,
                host: host.to_ascii_lowercase(),
                user,
            };
        }
        Self {
            transport: Transport::Unknown,
            host: String::new(),
            user: None,
        }
    }

    fn local() -> Self {
        Self {
            transport: Transport::Local,
            host: String::new(),
            user: None,
        }
    }

    pub fn is_local(&self) -> bool {
        self.transport == Transport::Local
    }

    /// Repository name guessed from the last path segment (`repo.git` → `repo`).
    pub fn repo_name(url: &str) -> Option<String> {
        let trimmed = url.trim().trim_end_matches('/');
        let last = trimmed.rsplit(['/', ':']).next()?;
        let name = last.strip_suffix(".git").unwrap_or(last).trim();
        (!name.is_empty() && name != "." && name != "..").then(|| name.to_owned())
    }
}

fn strip_port(hostport: &str) -> String {
    // IPv6 literal: [::1]:22
    if let Some(end) = hostport.strip_prefix('[').and_then(|s| s.find(']')) {
        return hostport[1..=end].to_ascii_lowercase();
    }
    hostport
        .split(':')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn is_windows_path(url: &str) -> bool {
    let bytes = url.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ssh_variants() {
        let scp = RemoteUrl::parse("git@github.com:ylkhn1/notes.git");
        assert_eq!(scp.transport, Transport::Ssh);
        assert_eq!(scp.host, "github.com");
        assert_eq!(scp.user.as_deref(), Some("git"));

        let full = RemoteUrl::parse("ssh://git@Gitea.Example.org:2222/me/notes.git");
        assert_eq!(full.transport, Transport::Ssh);
        assert_eq!(full.host, "gitea.example.org");
        assert_eq!(full.user.as_deref(), Some("git"));
    }

    #[test]
    fn parses_https_and_local() {
        let https = RemoteUrl::parse("https://github.com/ylkhn1/notes.git");
        assert_eq!(https.transport, Transport::Https);
        assert_eq!(https.host, "github.com");
        assert_eq!(https.user, None);

        assert!(RemoteUrl::parse("/srv/git/notes.git").is_local());
        assert!(RemoteUrl::parse("file:///srv/git/notes.git").is_local());
        assert!(RemoteUrl::parse(r"C:\git\notes").is_local());
        assert_eq!(RemoteUrl::parse("nonsense").transport, Transport::Unknown);
    }

    #[test]
    fn guesses_repo_name() {
        assert_eq!(
            RemoteUrl::repo_name("git@github.com:me/My-Notes.git").as_deref(),
            Some("My-Notes")
        );
        assert_eq!(
            RemoteUrl::repo_name("https://host/me/notes/").as_deref(),
            Some("notes")
        );
        assert_eq!(RemoteUrl::repo_name(""), None);
    }
}

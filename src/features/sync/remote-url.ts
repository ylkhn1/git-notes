/** Mirror of the Rust `RemoteUrl` parser, for hints in the remote dialog. */

export type Transport = "ssh" | "https" | "http" | "local" | "unknown";

export interface RemoteUrlInfo {
  transport: Transport;
  /** Lower-case host without port; empty for local paths. */
  host: string;
}

export function parseRemoteUrl(input: string): RemoteUrlInfo {
  const url = input.trim();
  if (url === "") return { transport: "unknown", host: "" };
  if (/^(\/|\.\.?\/|[A-Za-z]:[\\/])/.test(url)) return { transport: "local", host: "" };

  const scheme = /^([a-z+]+):\/\/(.*)$/i.exec(url);
  if (scheme) {
    const name = scheme[1]?.toLowerCase() ?? "";
    const rest = scheme[2] ?? "";
    const authority = rest.split(/[/?#]/)[0] ?? "";
    const hostPort = authority.includes("@")
      ? authority.slice(authority.lastIndexOf("@") + 1)
      : authority;
    const host = stripPort(hostPort);
    if (name === "ssh" || name === "git+ssh" || name === "ssh+git")
      return { transport: "ssh", host };
    if (name === "https") return { transport: "https", host };
    if (name === "http") return { transport: "http", host };
    if (name === "file") return { transport: "local", host: "" };
    return { transport: "unknown", host };
  }

  // scp-like: [user@]host:path
  const colon = url.indexOf(":");
  if (colon > 0) {
    const authority = url.slice(0, colon);
    if (!authority.includes("/")) {
      const host = authority.includes("@")
        ? authority.slice(authority.lastIndexOf("@") + 1)
        : authority;
      return { transport: "ssh", host: host.toLowerCase() };
    }
  }
  return { transport: "unknown", host: "" };
}

function stripPort(hostPort: string): string {
  if (hostPort.startsWith("[")) {
    const end = hostPort.indexOf("]");
    return (end > 0 ? hostPort.slice(1, end) : hostPort).toLowerCase();
  }
  return (hostPort.split(":")[0] ?? "").toLowerCase();
}

/** `repo.git` → `repo`, like the Rust side does for the clone dialog. */
export function repoNameFromUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  const last = trimmed.split(/[/:]/).pop() ?? "";
  const name = last.replace(/\.git$/i, "").trim();
  return name === "." || name === ".." ? "" : name;
}

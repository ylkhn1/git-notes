import type { TreeNode } from "@/lib/bindings";

/** Rejects names the tree cannot show or the backend would refuse; null means OK. */
export function validateName(name: string): string | null {
  if (name.includes("/") || name.includes("\\"))
    return "Use the folder menu to create nested paths";
  if (name === "." || name === "..") return "That name is reserved";
  if (name.startsWith(".")) return "Hidden names (starting with a dot) are not shown in the tree";
  return null;
}

/** Every folder path in the tree, depth-first. */
export function collectFolders(nodes: TreeNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.kind === "dir") {
      out.push(node.path);
      collectFolders(node.children, out);
    }
  }
  return out;
}

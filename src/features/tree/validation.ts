import type { TreeNode } from "@/lib/bindings";
import { t } from "@/lib/i18n";

/** Rejects names the tree cannot show or the backend would refuse; null means OK. */
export function validateName(name: string): string | null {
  if (name.includes("/") || name.includes("\\")) return t("tree.nestedPathsNotAllowed");
  if (name === "." || name === "..") return t("tree.reservedName");
  if (name.startsWith(".")) return t("tree.hiddenName");
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

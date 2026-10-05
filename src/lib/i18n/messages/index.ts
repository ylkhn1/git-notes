/**
 * Every message namespace. Keys are `"<namespace>.<name>"`; adding a namespace here makes its
 * keys available to `t()`. Each file holds the English source next to its Russian translation.
 */

import app from "./app";
import clone from "./clone";
import commands from "./commands";
import common from "./common";
import conflicts from "./conflicts";
import credentials from "./credentials";
import editor from "./editor";
import history from "./history";
import links from "./links";
import notebooks from "./notebooks";
import onboarding from "./onboarding";
import palette from "./palette";
import remote from "./remote";
import settings from "./settings";
import share from "./share";
import shell from "./shell";
import shortcuts from "./shortcuts";
import sync from "./sync";
import time from "./time";
import tree from "./tree";
import updates from "./updates";

export const namespaces = {
  app,
  clone,
  commands,
  common,
  conflicts,
  credentials,
  editor,
  history,
  links,
  notebooks,
  onboarding,
  palette,
  remote,
  settings,
  share,
  shell,
  shortcuts,
  sync,
  time,
  tree,
  updates,
};

export type Namespaces = typeof namespaces;

/** `"settings.theme"`, `"sync.upToDate"`, … — checked against the English source. */
export type MessageKey = {
  [N in keyof Namespaces]: `${N}.${keyof Namespaces[N]["en"] & string}`;
}[keyof Namespaces];

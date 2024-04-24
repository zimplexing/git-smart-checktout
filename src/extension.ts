// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import checkoutCommand from "./command/checkout";

const commands = [
  {
    commandId: checkoutCommand.commandId,
    execute: checkoutCommand.execute,
    initialize: checkoutCommand.initialize,
  },
  {
    commandId: "git-smart-checkout.show.branches",
    execute: checkoutCommand.execute,
    initialize: () => {},
  },
];

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  for (const { commandId, execute, initialize } of commands) {
    const disposable = vscode.commands.registerCommand(commandId, execute);
    initialize();
    context.subscriptions.push(disposable);
  }
}

// This method is called when your extension is deactivated
export function deactivate() {}

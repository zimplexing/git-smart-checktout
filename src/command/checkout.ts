import * as vscode from "vscode";
import * as gitUtils from "../utils/git";
import { Repository, RefType, Branch } from "../git";

const RE_SYNC_INTERVAL = 1000 * 60 * 10;

const BaseQuickItems: vscode.QuickPickItem[] = [
  {
    label: "Refresh",
    description: "Refresh the list of branches",
    iconPath: new vscode.ThemeIcon("extensions-refresh"),
  },
  {
    label: "Create new branch...",
    iconPath: new vscode.ThemeIcon("keybindings-add"),
  },
  {
    label: "Create new branch from...",
    iconPath: new vscode.ThemeIcon("keybindings-add"),
  },
  { kind: vscode.QuickPickItemKind.Separator, label: "" },
];

let quickItems: vscode.QuickPickItem[] = [];

const statusBarItem = vscode.window.createStatusBarItem(
  vscode.StatusBarAlignment.Left,
  10
);
const quickPick = vscode.window.createQuickPick();

statusBarItem.command = "git-smart-checkout.show.branches";

let syncTimer: undefined | NodeJS.Timeout = undefined;

async function execute(): Promise<void> {
  showQuickPick(quickPick);
}

const getCurrentRepo = () => {
  const { repos } = gitUtils.listRefNames();
  const currentRepo = repos.pop();
  if (!currentRepo) {
    vscode.window.showErrorMessage("No repositories found");
    return;
  }
  return currentRepo;
};

const initQuickPick = async () => {
  const currentRepo = getCurrentRepo();
  if (!currentRepo) {
    return;
  }
  quickPick.placeholder = "Select a branch to checkout";
  quickPick.onDidChangeSelection(async (selectItem) => {
    quickPick.hide();
    await execSelectItem(selectItem[0], currentRepo).catch(console.error);
    statusBarItem.text = `$(source-control-view-icon)${currentRepo.state.HEAD?.name}`;
  });
  quickPick.onDidTriggerItemButton(async (button) => {
    quickPick.hide();
    await execSelectItemButton(button, currentRepo).catch(console.error);
    statusBarItem.text = `$(source-control-view-icon)${currentRepo.state.HEAD?.name}`;
  });
};

const showQuickPick = async (
  quickPick: vscode.QuickPick<vscode.QuickPickItem>
) => {
  quickPick.items = quickItems;
  quickPick.show();
};

const initialize = async () => {
  initQuickPick();
  initQuickItems();
};

const execSelectItem = async (item: vscode.QuickPickItem, repo: Repository) => {
  switch (item.label) {
    case "Refresh":
      await initQuickItems();
      await execute();
      return;
    case "Create new branch...":
      const branchName = await vscode.window.showInputBox({
        prompt: "Enter new branch name",
      });
      if (!branchName) {
        return;
      }
      const commit = repo.state.HEAD?.commit;
      await repo.createBranch(branchName, true);
      const { message } = commit
        ? await repo.getCommit(commit)
        : { message: "" };
      quickItems.splice(4, 0, {
        label: branchName,
        description: commit?.substring(0, 8),
        detail: message,
        iconPath: new vscode.ThemeIcon("source-control-view-icon"),
        buttons: [
          { iconPath: new vscode.ThemeIcon("notebook-edit") },
          { iconPath: new vscode.ThemeIcon("notebook-delete-cell") },
        ],
      });
      return;
    case "Create new branch from...":
      const selectItem = await vscode.window.showQuickPick(quickItems.slice(4));
      if (!selectItem) {
        return;
      }
      const selectedBranchName = await vscode.window.showInputBox({
        prompt: "Enter new branch name",
        value: selectItem!.label,
        valueSelection: [0, selectItem!.label.length],
      });
      if (!selectedBranchName) {
        return;
      }
      await repo.createBranch(selectedBranchName, true, selectItem.description);
      quickItems.splice(4, 0, {
        label: selectedBranchName,
        description: selectItem.description,
        detail: selectItem.detail,
        iconPath: new vscode.ThemeIcon("source-control-view-icon"),
        buttons: [
          { iconPath: new vscode.ThemeIcon("notebook-edit") },
          { iconPath: new vscode.ThemeIcon("notebook-delete-cell") },
        ],
      });
      return;
    default:
      await repo.checkout(item!.label);
      return;
  }
};

const execSelectItemButton = async (
  selectedItem: vscode.QuickPickItemButtonEvent<vscode.QuickPickItem>,
  repo: Repository
) => {
  const item = selectedItem.item;
  switch ((selectedItem.button.iconPath as vscode.ThemeIcon).id) {
    case "notebook-edit":
      const branchName = await vscode.window.showInputBox({
        prompt: "Enter new branch name",
        value: item.label,
        valueSelection: [0, item.label.length],
      });
      if (!branchName) {
        return;
      }
      await repo.repository.renameBranch(branchName);
      quickItems.splice(
        quickItems.findIndex((i) => i.label === item.label),
        1,
        {
          label: branchName,
          description: item.description,
          detail: item.detail,
          iconPath: item.iconPath,
          buttons: item.buttons,
        }
      );
      return;
    case "notebook-delete-cell":
      const response = await vscode.window.showInformationMessage(
        `Are you sure you delete ${item.label}`,
        "Yes",
        "No"
      );
      if (response === "Yes") {
        try {
          await repo.deleteBranch(item.label, true);
          quickItems.splice(
            quickItems.findIndex((i) => i.label === item.label),
            1
          );
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to delete branch ${item.label}`
          );
        }
      }
      return;
    default:
      return;
  }
};

const setLoading = (title: string) => {
  const loadingAnimation = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let animationIndex = 0;
  statusBarItem.text = `${loadingAnimation[animationIndex]} ${title}`;
  statusBarItem.show();
  const timer = setInterval(() => {
    animationIndex = (animationIndex + 1) % loadingAnimation.length;
    statusBarItem.text = `${loadingAnimation[animationIndex]} ${title}`;
  }, 100);
  return () => {
    clearInterval(timer);
    statusBarItem.text = `$(source-control-view-icon)${title}`;
  };
};

const initQuickItems = async () => {
  clearTimeout(syncTimer);
  quickItems = [...BaseQuickItems];
  const currentRepo = getCurrentRepo();
  if (!currentRepo) {
    return;
  }
  const stopLoading = setLoading(
    currentRepo.state.HEAD?.name ?? "Loading branches"
  );
  const refs = await currentRepo.getRefs({ sort: "committerdate" });
  const localBranches = refs.filter((branch) => branch.type === RefType.Head);
  const remoteBranches = refs.filter(
    (branch) => branch.type === RefType.RemoteHead
  );
  quickItems.push(
    ...(await generateBranchItems(
      currentRepo,
      localBranches,
      new vscode.ThemeIcon("source-control-view-icon")
    ))
  );
  quickItems.push({ kind: vscode.QuickPickItemKind.Separator, label: "" });
  quickItems.push(
    ...(await generateBranchItems(
      currentRepo,
      remoteBranches,
      new vscode.ThemeIcon("extensions-install-local-in-remote")
    ))
  );
  stopLoading();
  syncTimer = setTimeout(initQuickItems, RE_SYNC_INTERVAL);
};

const generateBranchItems = async (
  repo: Repository,
  branches: Branch[],
  icon: vscode.ThemeIcon
): Promise<vscode.QuickPickItem[]> => {
  const items: vscode.QuickPickItem[] = [];
  for (const [index, branch] of branches.entries()) {
    const { message } =
      branch.commit && branch.type === RefType.Head && index < 10
        ? await repo.getCommit(branch.commit)
        : { message: "" };
    items.push({
      label: branch.name ?? "",
      description: branch.commit?.substring(0, 8),
      detail: message,
      iconPath: icon,
      buttons: [
        { iconPath: new vscode.ThemeIcon("notebook-edit") },
        { iconPath: new vscode.ThemeIcon("notebook-delete-cell") },
      ],
    });
  }
  return items;
};

export default {
  commandId: "git-smart-checkout.checkout",
  execute,
  initialize,
};

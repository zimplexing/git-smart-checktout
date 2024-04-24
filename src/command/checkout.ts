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

class CheckoutCommand {
  private quickItems: vscode.QuickPickItem[] = [];
  private statusBarItem: vscode.StatusBarItem;
  private quickPick: vscode.QuickPick<vscode.QuickPickItem>;
  private syncTimer: NodeJS.Timeout | undefined;
  public commandId = "git-smart-checkout.checkout";

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      10
    );
    this.quickPick = vscode.window.createQuickPick();
    this.statusBarItem.command = "git-smart-checkout.show.branches";
  }

  public execute = async () => {
    this.showQuickPick();
  };

  private getCurrentRepo(): Repository | undefined {
    const { repos } = gitUtils.listRefNames();
    const currentRepo = repos.pop();
    if (!currentRepo) {
      vscode.window.showErrorMessage("No repositories found");
      return undefined;
    }
    return currentRepo;
  }

  private async initQuickPick(): Promise<void> {
    const currentRepo = this.getCurrentRepo();
    if (!currentRepo) {
      return;
    }
    this.quickPick.placeholder = "Select a branch to checkout";
    this.quickPick.onDidChangeSelection(async (selectItem) => {
      this.quickPick.hide();
      await this.execSelectItem(selectItem[0], currentRepo).catch(
        console.error
      );
      this.statusBarItem.text = `$(source-control-view-icon)${currentRepo.state.HEAD?.name}`;
    });
    this.quickPick.onDidTriggerItemButton(async (button) => {
      this.quickPick.hide();
      await this.execSelectItemButton(button, currentRepo).catch(console.error);
      this.statusBarItem.text = `$(source-control-view-icon)${currentRepo.state.HEAD?.name}`;
    });
  }

  private async showQuickPick(): Promise<void> {
    this.quickPick.items = this.quickItems;
    this.quickPick.show();
  }

  public initialize = async () => {
    await this.initQuickPick();
    await this.initQuickItems();
  };

  private async execSelectItem(
    item: vscode.QuickPickItem,
    repo: Repository
  ): Promise<void> {
    switch (item.label) {
      case "Refresh":
        await this.initQuickItems();
        await this.execute();
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
        this.quickItems.splice(4, 0, {
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
        const selectItem = await vscode.window.showQuickPick(
          this.quickItems.slice(4)
        );
        if (!selectItem) {
          return;
        }
        const selectedBranchName = await vscode.window.showInputBox({
          prompt: "Enter new branch name",
          value: selectItem.label,
          valueSelection: [0, selectItem.label.length],
        });
        if (!selectedBranchName) {
          return;
        }
        await repo.createBranch(
          selectedBranchName,
          true,
          selectItem.description
        );
        const selectItemCommit = !selectItem.detail
          ? await repo.getCommit(selectItem.description!)
          : { message: selectItem.detail };
        this.quickItems.splice(4, 0, {
          label: selectedBranchName,
          description: selectItem.description,
          detail: selectItemCommit.message,
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
  }

  private async execSelectItemButton(
    selectedItem: vscode.QuickPickItemButtonEvent<vscode.QuickPickItem>,
    repo: Repository
  ): Promise<void> {
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
        this.quickItems.splice(
          this.quickItems.findIndex((i) => i.label === item.label),
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
            this.quickItems.splice(
              this.quickItems.findIndex((i) => i.label === item.label),
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
  }

  private setLoading(title: string): () => void {
    const loadingAnimation = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let animationIndex = 0;
    this.statusBarItem.text = `${loadingAnimation[animationIndex]} ${title}`;
    this.statusBarItem.show();
    const timer = setInterval(() => {
      animationIndex = (animationIndex + 1) % loadingAnimation.length;
      this.statusBarItem.text = `${loadingAnimation[animationIndex]} ${title}`;
    }, 100);
    return () => {
      clearInterval(timer);
      this.statusBarItem.text = `$(source-control-view-icon)${title}`;
    };
  }

  private async initQuickItems(): Promise<void> {
    clearTimeout(this.syncTimer);
    this.quickItems = [...BaseQuickItems];
    const currentRepo = this.getCurrentRepo();
    if (!currentRepo) {
      return;
    }
    const stopLoading = this.setLoading(
      currentRepo.state.HEAD?.name ?? "Loading branches"
    );
    const refs = await currentRepo.getRefs({ sort: "committerdate" });
    const localBranches = refs.filter((branch) => branch.type === RefType.Head);
    const remoteBranches = refs.filter(
      (branch) => branch.type === RefType.RemoteHead
    );
    this.quickItems.push(
      ...(await this.generateBranchItems(
        currentRepo,
        localBranches,
        new vscode.ThemeIcon("source-control-view-icon")
      ))
    );
    this.quickItems.push({
      kind: vscode.QuickPickItemKind.Separator,
      label: "",
    });
    this.quickItems.push(
      ...(await this.generateBranchItems(
        currentRepo,
        remoteBranches,
        new vscode.ThemeIcon("extensions-install-local-in-remote")
      ))
    );
    stopLoading();
    this.syncTimer = setTimeout(() => this.initQuickItems(), RE_SYNC_INTERVAL);
  }

  private async generateBranchItems(
    repo: Repository,
    branches: Branch[],
    icon: vscode.ThemeIcon
  ): Promise<vscode.QuickPickItem[]> {
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
  }
}

export default new CheckoutCommand();

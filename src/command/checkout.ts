import * as vscode from 'vscode';
import * as gitUtils from '../utils/git';
import { Repository, RefType, Branch } from '../git';

// open gitlab url

const QuickItems: vscode.QuickPickItem[] = [
  {
    label: 'Refresh',
    description: 'Refresh the list of branches',
    iconPath: new vscode.ThemeIcon('extensions-refresh'),
  },
  {
    label: 'Create new branch...',
    iconPath: new vscode.ThemeIcon('keybindings-add'),
  },
  {
    label: 'Create new branch from...',
    iconPath: new vscode.ThemeIcon('keybindings-add'),
  },
  { kind: vscode.QuickPickItemKind.Separator, label: '' },
];

let syncTimer: undefined | NodeJS.Timeout = undefined;

async function execute(): Promise<void> {
  const { repos } = gitUtils.listRefNames();
  const currentRepo = repos.pop();
  if (!currentRepo) {
    vscode.window.showErrorMessage('No repositories found');
    return;
  }
  const quickPick = vscode.window.createQuickPick();
  quickPick.items = QuickItems;
  quickPick.placeholder = 'Select a branch to checkout';
  quickPick.show();
  quickPick.onDidChangeSelection(async selectItem => {
    quickPick.hide();
    await execSelectItem(selectItem[0], currentRepo).catch(console.error);
  });
  quickPick.onDidTriggerItemButton(async button => {
    quickPick.hide();
    await execSelectItemButton(button, currentRepo).catch(console.error);
  });
}

const execSelectItem = async (item: vscode.QuickPickItem, repo: Repository) => {
  switch (item.label) {
    case 'Refresh':
      await initQuickItems();
      await execute();
      return;
    case 'Create new branch...':
      const branchName = await vscode.window.showInputBox({ prompt: 'Enter new branch name' });
      if (!branchName) {
        return;
      }
      const commit = repo.state.HEAD?.commit;
      await repo.createBranch(branchName, true);
      const { message } = commit ? await repo.getCommit(commit) : { message: '' };
      QuickItems.splice(4, 0, {
        label: branchName,
        description: commit?.substring(0, 8),
        detail: message,
        iconPath: new vscode.ThemeIcon('source-control-view-icon'),
        buttons: [
          { iconPath: new vscode.ThemeIcon('notebook-edit') },
          { iconPath: new vscode.ThemeIcon('notebook-delete-cell') },
        ],
      });
      return;
    case 'Create new branch from...':
      const selectItem = await vscode.window.showQuickPick(QuickItems.slice(4));
      if (!selectItem) {
        return;
      }
      const selectedBranchName = await vscode.window.showInputBox({
        prompt: 'Enter new branch name',
        value: selectItem!.label,
        valueSelection: [0, selectItem!.label.length],
      });
      if (!selectedBranchName) {
        return;
      }
      await repo.createBranch(selectedBranchName, true, selectItem.description);
      QuickItems.splice(4, 0, {
        label: selectedBranchName,
        description: selectItem.description,
        detail: selectItem.detail,
        iconPath: new vscode.ThemeIcon('source-control-view-icon'),
        buttons: [
          { iconPath: new vscode.ThemeIcon('notebook-edit') },
          { iconPath: new vscode.ThemeIcon('notebook-delete-cell') },
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
    case 'notebook-edit':
      const branchName = await vscode.window.showInputBox({
        prompt: 'Enter new branch name',
        value: item.label,
        valueSelection: [0, item.label.length],
      });
      if (!branchName) {
        return;
      }
      await repo.repository.renameBranch(branchName);
      QuickItems.splice(
        QuickItems.findIndex(i => i.label === item.label),
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
    case 'notebook-delete-cell':
      const response = await vscode.window.showInformationMessage(`Are you sure you delete ${item.label}`, 'Yes', 'No');
      if (response === 'Yes') {
        try {
          await repo.deleteBranch(item.label, true);
          QuickItems.splice(
            QuickItems.findIndex(i => i.label === item.label),
            1
          );
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to delete branch ${item.label}`);
        }
      }
      return;
    default:
      return;
  }
};

const initQuickItems = async () => {
  clearTimeout(syncTimer);
  const { repos } = gitUtils.listRefNames();
  const currentRepo = repos.pop();
  if (!currentRepo) {
    vscode.window.showErrorMessage('No repositories found');
    return;
  }
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  statusBarItem.text = 'Fetch branch list ...';
  statusBarItem.show();
  const refs = await currentRepo.getRefs({ sort: 'committerdate' });
  const localBranches = refs.filter(branch => branch.type === RefType.Head);
  const remoteBranches = refs.filter(branch => branch.type === RefType.RemoteHead);
  QuickItems.push(
    ...(await generateBranchItems(currentRepo, localBranches, new vscode.ThemeIcon('source-control-view-icon')))
  );
  QuickItems.push({ kind: vscode.QuickPickItemKind.Separator, label: '' });
  QuickItems.push(
    ...(await generateBranchItems(
      currentRepo,
      remoteBranches,
      new vscode.ThemeIcon('extensions-install-local-in-remote')
    ))
  );
  statusBarItem.hide();
  syncTimer = setTimeout(initQuickItems, 1000 * 60 * 5);
};

const generateBranchItems = async (
  repo: Repository,
  branches: Branch[],
  icon: vscode.ThemeIcon
): Promise<vscode.QuickPickItem[]> => {
  const items: vscode.QuickPickItem[] = [];
  for (const branch of branches) {
    const { message } = branch.commit && branch.type === RefType.Head ? await repo.getCommit(branch.commit) : { message: '' };
    items.push({
      label: branch.name ?? '',
      description: branch.commit?.substring(0, 8),
      detail: message,
      iconPath: icon,
      buttons: [
        { iconPath: new vscode.ThemeIcon('notebook-edit') },
        { iconPath: new vscode.ThemeIcon('notebook-delete-cell') },
      ],
    });
  }
  return items;
};

export default { commandId: 'git-smart-checkout.checkout', execute, initQuickItems };

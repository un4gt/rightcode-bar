import * as vscode from 'vscode';

type RightCodeSubscription = {
	id: number;
	name: string;
	userId?: number;
	itemId?: number;
	tierId?: number;
	totalQuota: number;
	remainingQuota: number;
	durationHours?: number;
	expiredAt?: string;
	lastResetAt?: string | null;
	createdAt?: string;
	updatedAt?: string;
	resetToday?: boolean;
};

type SubscriptionListResult = {
	total: number;
	subscriptions: RightCodeSubscription[];
};

const RIGHTCODE_SUBSCRIPTIONS_URL = 'https://right.codes/subscriptions/list';
const RIGHTCODE_REFERER = 'https://right.codes/dashboard';
const DEFAULT_USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:146.0) Gecko/20100101 Firefox/146.0';
const STATUS_TEXT_ERROR = '获取订阅失败，更新token或者cookie';
const SECRET_KEY_TOKEN = 'rightcodeBar.token';
const SECRET_KEY_COOKIE = 'rightcodeBar.cookie';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function parseFiniteNumber(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return undefined;
}

function parseString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function parseBoolean(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}

function normalizeTokenInput(value: string): string {
	let normalized = value.trim();
	normalized = normalized.replace(/^authorization\s*:\s*/i, '');
	normalized = normalized.replace(/^bearer\s+/i, '');
	normalized = normalized.trim();
	if (
		(normalized.startsWith('"') && normalized.endsWith('"')) ||
		(normalized.startsWith("'") && normalized.endsWith("'"))
	) {
		normalized = normalized.slice(1, -1).trim();
	}
	return normalized;
}

function normalizeCookieInput(value: string): string {
	let normalized = value.trim();
	normalized = normalized.replace(/^cookie\s*:\s*/i, '').trim();
	if (
		(normalized.startsWith('"') && normalized.endsWith('"')) ||
		(normalized.startsWith("'") && normalized.endsWith("'"))
	) {
		normalized = normalized.slice(1, -1).trim();
	}
	return normalized;
}

function escapeTableCell(value: string): string {
	return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function formatQuota(value: number): string {
	return value.toFixed(2);
}

function formatDateYmd(dateTime: string | undefined): string {
	if (!dateTime) {
		return '-';
	}

	const datePart = dateTime.split('T')[0] ?? '';
	const [year, month, day] = datePart.split('-');
	if (!year || !month || !day) {
		return escapeTableCell(datePart || dateTime);
	}
	return `${year}/${month}/${day}`;
}

function formatDateMd(dateTime: string | undefined): string {
	if (!dateTime) {
		return '-';
	}

	const datePart = dateTime.split('T')[0] ?? '';
	const [, month, day] = datePart.split('-');
	if (!month || !day) {
		return escapeTableCell(datePart || dateTime);
	}
	return `${month}/${day}`;
}

function formatBooleanYesNo(value: boolean | undefined): string {
	if (value === undefined) {
		return '-';
	}
	return value ? '是' : '否';
}

function usedQuota(subscription: RightCodeSubscription): number {
	const used = subscription.totalQuota - subscription.remainingQuota;
	return used < 0 && used > -1e-8 ? 0 : used;
}

function pickDisplaySubscription(subscriptions: RightCodeSubscription[]): RightCodeSubscription | undefined {
	return [...subscriptions].sort((a, b) => usedQuota(a) - usedQuota(b))[0];
}

function parseSubscription(raw: unknown): RightCodeSubscription | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}

	const id = parseFiniteNumber(raw.id);
	const name = parseString(raw.name);
	const totalQuota = parseFiniteNumber(raw.total_quota);
	const remainingQuota = parseFiniteNumber(raw.remaining_quota);
	if (id === undefined || name === undefined || totalQuota === undefined || remainingQuota === undefined) {
		return undefined;
	}

	const lastResetAtRaw = raw.last_reset_at;
	const lastResetAt =
		lastResetAtRaw === null ? null : lastResetAtRaw === undefined ? undefined : parseString(lastResetAtRaw);

	return {
		id,
		name,
		userId: parseFiniteNumber(raw.user_id),
		itemId: parseFiniteNumber(raw.item_id),
		tierId: parseFiniteNumber(raw.tier_id),
		totalQuota,
		remainingQuota,
		durationHours: parseFiniteNumber(raw.duration_hours),
		expiredAt: parseString(raw.expired_at),
		lastResetAt,
		createdAt: parseString(raw.created_at),
		updatedAt: parseString(raw.updated_at),
		resetToday: parseBoolean(raw.reset_today),
	};
}

function parseSubscriptionListResult(raw: unknown): SubscriptionListResult {
	if (!isRecord(raw)) {
		throw new Error('Unexpected response: not an object');
	}

	const total = parseFiniteNumber(raw.total) ?? 0;
	const subscriptionsRaw = raw.subscriptions;
	const subscriptions = Array.isArray(subscriptionsRaw)
		? subscriptionsRaw.map(parseSubscription).filter((value): value is RightCodeSubscription => value !== undefined)
		: [];

	return { total, subscriptions };
}

async function fetchSubscriptionList(params: {
	token: string;
	cookie: string;
	requestTimeoutMs: number;
	output: vscode.OutputChannel;
}): Promise<SubscriptionListResult> {
	const controller = new AbortController();
	const timeoutHandle = setTimeout(() => controller.abort(), params.requestTimeoutMs);

	try {
		const response = await fetch(RIGHTCODE_SUBSCRIPTIONS_URL, {
			method: 'GET',
			headers: {
				Accept: '*/*',
				'Accept-Language': 'zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2',
				'Accept-Encoding': 'gzip, deflate, br',
				'Content-Type': 'application/json',
				'User-Agent': DEFAULT_USER_AGENT,
				Referer: RIGHTCODE_REFERER,
				Authorization: `Bearer ${params.token}`,
				Cookie: params.cookie,
				'Sec-GPC': '1',
			},
			signal: controller.signal,
		});

		const responseText = await response.text();
		if (!response.ok) {
			params.output.appendLine(
				`HTTP ${response.status} ${response.statusText} from ${RIGHTCODE_SUBSCRIPTIONS_URL}: ${responseText.slice(0, 200)}`,
			);
			throw new Error(`Request failed: HTTP ${response.status}`);
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(responseText) as unknown;
		} catch {
			params.output.appendLine(
				`Failed to parse JSON from ${RIGHTCODE_SUBSCRIPTIONS_URL}: ${responseText.slice(0, 200)}`,
			);
			throw new Error('Request failed: invalid JSON response');
		}

		return parseSubscriptionListResult(parsed);
	} finally {
		clearTimeout(timeoutHandle);
	}
}

function buildSuccessTooltip(params: {
	selected: RightCodeSubscription;
	all: RightCodeSubscription[];
	refreshedAt: Date;
}): vscode.MarkdownString {
	const tooltip = new vscode.MarkdownString(undefined, true);
	tooltip.appendMarkdown(`**RightCode 订阅**\n\n`);
	tooltip.appendMarkdown(`| 名称 | 剩余 | 总额 | 已用 | 到期 | 上次重置 | 今日重置 |\n`);
	tooltip.appendMarkdown(`|---|---:|---:|---:|:---:|:---:|:---:|\n`);

	const rows = [...params.all].sort((a, b) => usedQuota(a) - usedQuota(b));
	for (const subscription of rows) {
		const isSelected = subscription.id === params.selected.id;
		const nameCell = isSelected
			? `**${escapeTableCell(subscription.name)}**`
			: escapeTableCell(subscription.name);
		tooltip.appendMarkdown(
			`| ${nameCell} | ${formatQuota(subscription.remainingQuota)} | ${formatQuota(subscription.totalQuota)} | ${formatQuota(usedQuota(subscription))} | ${formatDateYmd(subscription.expiredAt)} | ${formatDateMd(subscription.lastResetAt ?? undefined)} | ${formatBooleanYesNo(subscription.resetToday)} |`,
		);
		tooltip.appendMarkdown(`\n`);
	}

	tooltip.appendMarkdown(`\n最后刷新：${params.refreshedAt.toLocaleString()}\n`);
	tooltip.appendMarkdown(`\n单击状态栏可刷新。\n`);
	return tooltip;
}

function buildMissingConfigTooltip(): vscode.MarkdownString {
	const tooltip = new vscode.MarkdownString(undefined, true);
	tooltip.appendMarkdown(`**RightCode 订阅**\n\n`);
	tooltip.appendMarkdown(`未配置认证信息：\n\n`);
	tooltip.appendMarkdown(`- 推荐：命令面板执行 \`RightCode: Set Token (Secure)\` / \`RightCode: Set Cookie (Secure)\`（存入系统密钥链）\n`);
	tooltip.appendMarkdown(`- 或者：在用户设置中填写 \`rightcodeBar.token\` / \`rightcodeBar.cookie\`（不推荐，会明文写入 settings.json）\n\n`);
	tooltip.appendMarkdown(`命令面板：\`RightCode: Open Settings\`。\n`);
	return tooltip;
}

function buildErrorTooltip(message: string): vscode.MarkdownString {
	const tooltip = new vscode.MarkdownString(undefined, true);
	tooltip.appendMarkdown(`**RightCode 订阅**\n\n`);
	tooltip.appendMarkdown(`${STATUS_TEXT_ERROR}\n\n`);
	tooltip.appendMarkdown(`错误信息：\`${escapeTableCell(message)}\`\n`);
	return tooltip;
}

function buildNoSubscriptionTooltip(refreshedAt: Date): vscode.MarkdownString {
	const tooltip = new vscode.MarkdownString(undefined, true);
	tooltip.appendMarkdown(`**RightCode 订阅**\n\n`);
	tooltip.appendMarkdown(`当前暂无订阅。\n\n`);
	tooltip.appendMarkdown(`最后刷新：${refreshedAt.toLocaleString()}\n`);
	return tooltip;
}

function getConfig(): {
	token: string;
	cookie: string;
	refreshIntervalSeconds: number;
	requestTimeoutMs: number;
} {
	const config = vscode.workspace.getConfiguration('rightcodeBar');
	const token = (config.get<string>('token') ?? '').trim();
	const cookie = (config.get<string>('cookie') ?? '').trim();
	const refreshIntervalSeconds = config.get<number>('refreshIntervalSeconds') ?? 300;
	const requestTimeoutMs = config.get<number>('requestTimeoutMs') ?? 15000;
	return { token, cookie, refreshIntervalSeconds, requestTimeoutMs };
}

export function activate(context: vscode.ExtensionContext) {
	const output = vscode.window.createOutputChannel('RightCode Bar');
	context.subscriptions.push(output);

	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.name = 'RightCode Subscription';
	statusBarItem.command = 'rightcode-bar.refresh';
	statusBarItem.text = '加载中...';
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

	let refreshTimer: NodeJS.Timeout | undefined;
	let refreshInProgress = false;
	let warnedTokenFromSettings = false;
	let warnedCookieFromSettings = false;

	const getAuth = async (): Promise<{ token: string; cookie: string }> => {
		const { token: tokenFromSettings, cookie: cookieFromSettings } = getConfig();
		const tokenFromSecret = (await context.secrets.get(SECRET_KEY_TOKEN))?.trim() ?? '';
		const cookieFromSecret = (await context.secrets.get(SECRET_KEY_COOKIE))?.trim() ?? '';

		if (!tokenFromSecret && tokenFromSettings && !warnedTokenFromSettings) {
			output.appendLine(
				'[warn] rightcodeBar.token is read from settings.json (plain text). Prefer "RightCode: Set Token (Secure)".',
			);
			warnedTokenFromSettings = true;
		}
		if (!cookieFromSecret && cookieFromSettings && !warnedCookieFromSettings) {
			output.appendLine(
				'[warn] rightcodeBar.cookie is read from settings.json (plain text). Prefer "RightCode: Set Cookie (Secure)".',
			);
			warnedCookieFromSettings = true;
		}

		const token = normalizeTokenInput(tokenFromSecret || tokenFromSettings);
		const cookie = normalizeCookieInput(cookieFromSecret || cookieFromSettings);
		return { token, cookie };
	};

	const refresh = async (): Promise<void> => {
		if (refreshInProgress) {
			return;
		}
		refreshInProgress = true;

		const refreshedAt = new Date();
		try {
			const { requestTimeoutMs } = getConfig();
			const { token, cookie } = await getAuth();
			if (!token || !cookie) {
				statusBarItem.text = STATUS_TEXT_ERROR;
				statusBarItem.tooltip = buildMissingConfigTooltip();
				return;
			}

			const result = await fetchSubscriptionList({ token, cookie, requestTimeoutMs, output });
			if (result.total <= 0 || result.subscriptions.length === 0) {
				statusBarItem.text = '当前暂无订阅';
				statusBarItem.tooltip = buildNoSubscriptionTooltip(refreshedAt);
				return;
			}

			const selected = pickDisplaySubscription(result.subscriptions);
			if (!selected) {
				statusBarItem.text = '当前暂无订阅';
				statusBarItem.tooltip = buildNoSubscriptionTooltip(refreshedAt);
				return;
			}

			statusBarItem.text = `${selected.name} 剩余 ${formatQuota(selected.remainingQuota)}`;
			statusBarItem.tooltip = buildSuccessTooltip({
				selected,
				all: result.subscriptions,
				refreshedAt,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			statusBarItem.text = STATUS_TEXT_ERROR;
			statusBarItem.tooltip = buildErrorTooltip(message);
			output.appendLine(`[error] ${message}`);
		} finally {
			refreshInProgress = false;
		}
	};

	const updateTimer = (): void => {
		if (refreshTimer) {
			clearInterval(refreshTimer);
			refreshTimer = undefined;
		}

		const { refreshIntervalSeconds } = getConfig();
		if (refreshIntervalSeconds > 0) {
			refreshTimer = setInterval(() => void refresh(), refreshIntervalSeconds * 1000);
		}
	};

	context.subscriptions.push(
		vscode.commands.registerCommand('rightcode-bar.refresh', async () => {
			await refresh();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('rightcode-bar.setToken', async () => {
			const token = await vscode.window.showInputBox({
				title: 'RightCode Token',
				prompt: 'Paste your RightCode token (can include "Bearer " prefix). Stored securely in OS keychain.',
				password: true,
				ignoreFocusOut: true,
				validateInput: (value) => (normalizeTokenInput(value) ? undefined : 'Token 不能为空'),
			});
			if (token === undefined) {
				return;
			}
			await context.secrets.store(SECRET_KEY_TOKEN, normalizeTokenInput(token));
			vscode.window.showInformationMessage('RightCode token 已安全保存');
			void refresh();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('rightcode-bar.setCookie', async () => {
			const cookie = await vscode.window.showInputBox({
				title: 'RightCode Cookie',
				prompt: 'Paste Cookie header value (e.g. "cf_clearance=..."). Stored securely in OS keychain.',
				password: true,
				ignoreFocusOut: true,
				validateInput: (value) => (normalizeCookieInput(value) ? undefined : 'Cookie 不能为空'),
			});
			if (cookie === undefined) {
				return;
			}
			await context.secrets.store(SECRET_KEY_COOKIE, normalizeCookieInput(cookie));
			vscode.window.showInformationMessage('RightCode cookie 已安全保存');
			void refresh();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('rightcode-bar.clearAuth', async () => {
			const choice = await vscode.window.showWarningMessage(
				'Clear saved RightCode token/cookie from OS keychain?',
				{ modal: true },
				'Clear',
			);
			if (choice !== 'Clear') {
				return;
			}
			await context.secrets.delete(SECRET_KEY_TOKEN);
			await context.secrets.delete(SECRET_KEY_COOKIE);
			vscode.window.showInformationMessage('RightCode token/cookie 已清除');
			void refresh();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('rightcode-bar.openSettings', async () => {
			await vscode.commands.executeCommand('workbench.action.openSettings', 'rightcodeBar');
		}),
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('rightcodeBar')) {
				updateTimer();
				void refresh();
			}
		}),
	);

	updateTimer();
	void refresh();
}

export function deactivate() {}
